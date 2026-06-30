-- ============================================================
-- MODERATION: admin takedown support
-- ============================================================

-- Add moderation columns to occupancies
alter table occupancies add column if not exists removed_by_admin boolean not null default false;
alter table occupancies add column if not exists removal_reason    text;
alter table occupancies add column if not exists removed_at        timestamptz;
alter table occupancies add column if not exists removed_by        uuid references users(id);

-- Add moderation columns to bid_history (audit trail keeps a record even after removal)
alter table bid_history add column if not exists removed_by_admin boolean not null default false;
alter table bid_history add column if not exists removal_reason    text;

-- Admins table — telegram_id allowlist
create table if not exists admins (
  id           uuid primary key default uuid_generate_v4(),
  telegram_id  bigint unique not null,
  label        text,
  created_at   timestamptz default now()
);

alter table admins enable row level security;
create policy "Service full access admins" on admins for all using (auth.role() = 'service_role');

-- Reports table — users can flag content; feeds the admin queue
create table if not exists reports (
  id            uuid primary key default uuid_generate_v4(),
  occupancy_id  uuid not null references occupancies(id) on delete cascade,
  reporter_id   uuid references users(id),
  reason        text not null,
  status        text not null default 'pending', -- 'pending' | 'reviewed' | 'dismissed'
  created_at    timestamptz default now()
);

create index if not exists reports_occupancy on reports(occupancy_id);
create index if not exists reports_status on reports(status) where status = 'pending';

alter table reports enable row level security;
create policy "Public insert reports" on reports for insert with check (true);
create policy "Service full access reports" on reports for all using (auth.role() = 'service_role');

-- ============================================================
-- FUNCTION: admin_remove_occupancy
-- Forcibly takes down a slot's content. No refund is issued by
-- default for the removed content (it violated the rules), but the
-- platform may issue a discretionary partial refund via p_refund_amount.
-- ============================================================
create or replace function admin_remove_occupancy(
  p_occupancy_id uuid,
  p_admin_id     uuid,
  p_reason       text,
  p_refund_amount numeric default 0
) returns jsonb as $$
declare
  v_occ occupancies;
begin
  select * into v_occ from occupancies where id = p_occupancy_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Occupancy not found');
  end if;

  if not v_occ.is_active then
    return jsonb_build_object('success', false, 'error', 'Occupancy already inactive');
  end if;

  update occupancies set
    is_active        = false,
    removed_by_admin  = true,
    removal_reason    = p_reason,
    removed_at        = now(),
    removed_by        = p_admin_id
  where id = p_occupancy_id;

  update bid_history set
    removed_by_admin = true,
    removal_reason   = p_reason
  where slot_id = v_occ.slot_id and bidder_id = v_occ.user_id and bid_amount = v_occ.bid_amount
  order by created_at desc limit 1;

  -- Optional discretionary refund (default 0 — violating content forfeits the stake)
  if p_refund_amount > 0 then
    update users set
      wallet = wallet + p_refund_amount,
      updated_at = now()
    where id = v_occ.user_id;

    insert into wallet_transactions (user_id, type, amount, balance_after, reference_id, description)
    select v_occ.user_id, 'refund', p_refund_amount, wallet, p_occupancy_id,
           format('Partial refund after content removal: %s', p_reason)
    from users where id = v_occ.user_id;
  end if;

  insert into wallet_transactions (user_id, type, amount, balance_after, reference_id, description)
  select v_occ.user_id, 'fee', 0, wallet, p_occupancy_id,
         format('Content removed by admin: %s', p_reason)
  from users where id = v_occ.user_id;

  return jsonb_build_object('success', true, 'slot_id', v_occ.slot_id);
end;
$$ language plpgsql security definer;

-- Helper: check if a telegram_id is an admin
create or replace function is_admin(p_telegram_id bigint) returns boolean as $$
begin
  return exists(select 1 from admins where telegram_id = p_telegram_id);
end;
$$ language plpgsql security definer;

-- Seed: add your own Telegram numeric ID here after deploy, e.g.:
-- insert into admins (telegram_id, label) values (123456789, 'Founder');
