-- ============================================================
-- 009_YIELD SYSTEM  (time-based dividend)
--
-- Occupying a slot now accrues REAL, WITHDRAWABLE TON in proportion
-- to the time the slot is held. Holding for the full window (24h)
-- pays out the maximum (1 TON). Yield is credited to BOTH `wallet`
-- and `withdrawable_balance`, so — unlike welcome/referral bonuses —
-- it is immediately withdrawable with no strings attached.
--
-- The platform intentionally runs this at a loss: the operator funds
-- the custody wallet manually to cover payouts.
--
-- ⚠️ ADDITIVE ONLY.  This migration deliberately does NOT run
-- `create or replace function place_bid` / `request_withdrawal`.
-- The live database has hand-edited versions of those (bonus /
-- referral / withdrawable_balance logic) that are AHEAD of the repo
-- migrations — re-defining them here would silently roll that back.
-- Everything below is new columns, new tables, new functions, and a
-- trigger, none of which clobber existing logic.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Safety: make sure the withdrawable_balance column exists.
--    (The live DB already has it; this is a no-op there.)
-- ------------------------------------------------------------
alter table users
  add column if not exists withdrawable_balance numeric(18,4) not null default 0;

-- ------------------------------------------------------------
-- 1. Per-occupancy yield bookkeeping.
--    yield_claimed  = high-water mark of TON already paid out for
--                     this occupancy (prevents double payment).
--    yield_settled  = true once the occupancy has ended AND its final
--                     yield has been paid, so the sweep can skip it.
--    ended_at       = the instant is_active flipped to false, stamped
--                     by a trigger so accrual stops exactly there even
--                     when place_bid (which we don't touch) does the flip.
-- ------------------------------------------------------------
alter table occupancies
  add column if not exists yield_claimed numeric(18,9) not null default 0;
alter table occupancies
  add column if not exists yield_settled boolean not null default false;
alter table occupancies
  add column if not exists ended_at timestamptz;

-- Sweep index: ended-but-unsettled occupancies the cron still owes.
create index if not exists occupancies_yield_settle
  on occupancies (user_id)
  where is_active = false and yield_settled = false;

-- ------------------------------------------------------------
-- 2. Trigger: stamp ended_at when an occupancy is deactivated.
--    Works for BOTH the expiry sweep and place_bid displacement,
--    without editing place_bid.
-- ------------------------------------------------------------
create or replace function kh_stamp_occupancy_ended() returns trigger as $$
begin
  if old.is_active = true and new.is_active = false and new.ended_at is null then
    new.ended_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_stamp_occupancy_ended on occupancies;
create trigger trg_stamp_occupancy_ended
  before update on occupancies
  for each row execute function kh_stamp_occupancy_ended();

-- ------------------------------------------------------------
-- 3. Audit trail: one row per payout.
-- ------------------------------------------------------------
create table if not exists yield_payouts (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references users(id),
  occupancy_id uuid not null references occupancies(id),
  amount_ton   numeric(18,9) not null,
  created_at   timestamptz default now()
);
create index if not exists yield_payouts_user on yield_payouts(user_id, created_at desc);

-- ------------------------------------------------------------
-- 4. Tunable config, centralised so the rate is one edit away.
--    max_ton        = TON paid for a full-window hold  (1 TON)
--    window_seconds = time to reach max_ton            (24h)
-- ------------------------------------------------------------
create or replace function kh_yield_config()
  returns table(max_ton numeric, window_seconds numeric)
  language sql immutable as $$
  select 1.0::numeric, 86400::numeric;   -- 1 TON over 24 hours
$$;

-- ------------------------------------------------------------
-- 5. Total yield ONE occupancy has accrued up to its effective end.
--    Effective end = earliest of (displacement/expiry stamp,
--    scheduled expiry, now) so nobody earns for time not held.
--    Capped at window_seconds → hard ceiling of max_ton per occupancy.
-- ------------------------------------------------------------
create or replace function kh_occupancy_accrued(
  p_created_at timestamptz,
  p_expires_at timestamptz,
  p_ended_at   timestamptz
) returns numeric language plpgsql stable as $$
declare
  v_max     numeric;
  v_window  numeric;
  v_end     timestamptz;
  v_elapsed numeric;
begin
  select max_ton, window_seconds into v_max, v_window from kh_yield_config();
  v_end := least(coalesce(p_ended_at, now()), p_expires_at);
  v_elapsed := extract(epoch from (v_end - p_created_at));
  if v_elapsed <= 0 then return 0; end if;
  if v_elapsed > v_window then v_elapsed := v_window; end if;
  return round((v_elapsed / v_window) * v_max, 9);
end;
$$;

-- ------------------------------------------------------------
-- 6. Read-only: how much a user can claim right now (+ per-slot breakdown).
-- ------------------------------------------------------------
create or replace function get_claimable_yield(p_user_id uuid)
  returns jsonb language plpgsql stable security definer as $$
declare
  o          occupancies;
  v_accrued  numeric;
  v_claimable numeric;
  v_total    numeric := 0;
  v_items    jsonb := '[]'::jsonb;
begin
  for o in
    select * from occupancies
    where user_id = p_user_id
      and (is_active = true or yield_settled = false)
  loop
    v_accrued   := kh_occupancy_accrued(o.created_at, o.expires_at, o.ended_at);
    v_claimable := round(greatest(0, v_accrued - o.yield_claimed), 9);
    if v_claimable > 0 then
      v_total := v_total + v_claimable;
      v_items := v_items || jsonb_build_object(
        'occupancy_id', o.id,
        'slot_id',      o.slot_id,
        'claimable',    v_claimable,
        'accrued',      v_accrued,
        'is_active',    o.is_active
      );
    end if;
  end loop;

  return jsonb_build_object(
    'success',   true,
    'claimable', round(v_total, 9),
    'items',     v_items
  );
end;
$$;

-- ------------------------------------------------------------
-- 7. Claim: pay out everything the user has accrued but not yet been
--    paid, crediting wallet + withdrawable_balance (real, withdrawable
--    TON). Idempotent via the yield_claimed high-water mark, so double
--    taps or a retry never double-pay.
-- ------------------------------------------------------------
create or replace function claim_yield(p_user_id uuid)
  returns jsonb language plpgsql security definer as $$
declare
  o           occupancies;
  v_accrued   numeric;
  v_claimable numeric;
  v_total     numeric := 0;
  v_new_bal   numeric;
begin
  perform 1 from users where id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  for o in
    select * from occupancies
    where user_id = p_user_id
      and (is_active = true or yield_settled = false)
    for update
  loop
    v_accrued   := kh_occupancy_accrued(o.created_at, o.expires_at, o.ended_at);
    v_claimable := round(greatest(0, v_accrued - o.yield_claimed), 9);

    if v_claimable > 0 then
      v_total := v_total + v_claimable;
      update occupancies set
        yield_claimed = v_accrued,
        yield_settled = (not is_active)   -- fully settled only once it has ended
      where id = o.id;

      insert into yield_payouts (user_id, occupancy_id, amount_ton)
      values (p_user_id, o.id, v_claimable);
    elsif not o.is_active then
      -- ended with nothing left owed: stop scanning it
      update occupancies set yield_settled = true where id = o.id;
    end if;
  end loop;

  if v_total > 0 then
    update users set
      wallet               = wallet + v_total,
      withdrawable_balance = withdrawable_balance + v_total,
      total_earned         = total_earned + v_total,
      updated_at           = now()
    where id = p_user_id
    returning wallet into v_new_bal;

    insert into wallet_transactions (user_id, type, amount, balance_after, description)
    values (
      p_user_id, 'yield', v_total, v_new_bal,
      format('Slot yield claimed: +%s TON (withdrawable)', round(v_total, 4))
    );
  end if;

  return jsonb_build_object('success', true, 'claimed', round(v_total, 9));
end;
$$;

-- ------------------------------------------------------------
-- 8. Cron settlement: pay out the final yield owed on occupancies that
--    have ENDED (expired or been displaced) but were never claimed, so
--    a user who closed the app still gets paid. Skips rows already
--    locked by a concurrent claim. Returns how many it settled.
-- ------------------------------------------------------------
create or replace function settle_ended_yield()
  returns int language plpgsql security definer as $$
declare
  o           occupancies;
  v_accrued   numeric;
  v_claimable numeric;
  v_new_bal   numeric;
  v_count     int := 0;
begin
  for o in
    select * from occupancies
    where is_active = false and yield_settled = false
    for update skip locked
  loop
    v_accrued   := kh_occupancy_accrued(o.created_at, o.expires_at, o.ended_at);
    v_claimable := round(greatest(0, v_accrued - o.yield_claimed), 9);

    if v_claimable > 0 then
      update users set
        wallet               = wallet + v_claimable,
        withdrawable_balance = withdrawable_balance + v_claimable,
        total_earned         = total_earned + v_claimable,
        updated_at           = now()
      where id = o.user_id
      returning wallet into v_new_bal;

      insert into wallet_transactions (user_id, type, amount, balance_after, reference_id, description)
      values (
        o.user_id, 'yield', v_claimable, v_new_bal, o.id,
        format('Slot yield settled: +%s TON (withdrawable)', round(v_claimable, 4))
      );

      insert into yield_payouts (user_id, occupancy_id, amount_ton)
      values (o.user_id, o.id, v_claimable);
    end if;

    update occupancies set yield_claimed = v_accrued, yield_settled = true where id = o.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ------------------------------------------------------------
-- 9. Rebase existing rows so the launch of this feature does NOT
--    retroactively pay out yield for time already elapsed before it
--    existed. Set each row's high-water mark to its current accrued
--    value (nothing owed yet) and mark already-ended rows settled.
--    Active slots therefore start earning fresh from now.
-- ------------------------------------------------------------
update occupancies o set
  yield_claimed = kh_occupancy_accrued(o.created_at, o.expires_at, o.ended_at),
  yield_settled = (o.is_active = false);

-- ------------------------------------------------------------
-- 10. RLS for the new audit table.
-- ------------------------------------------------------------
alter table yield_payouts enable row level security;
create policy "Service full access yield"  on yield_payouts for all    using (auth.role() = 'service_role');
create policy "Public read yield payouts"  on yield_payouts for select using (true);
