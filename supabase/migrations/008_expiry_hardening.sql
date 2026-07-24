-- ============================================================
-- EXPIRY HARDENING
--
-- Slots stopped expiring because expire_occupancies() was removed
-- from the /api/slots read path (commit a6edd01) and nothing else
-- reliably calls it: there is no Vercel cron, so the only caller is
-- an external cron-job.org job. If that job is missing, paused, or
-- sending the wrong secret, is_active never flips and every ad stays
-- on the board forever.
--
-- This migration is deliberately ADDITIVE ONLY. It does not touch
-- place_bid, because the live database has columns (withdrawable_balance,
-- is_bot, referred_by, is_retired) that do not appear in any migration
-- here — the deployed place_bid is hand-edited and ahead of 004.
-- Running `create or replace function place_bid` from this repo would
-- silently roll back that bonus/referral logic.
-- ============================================================

-- ------------------------------------------------------------
-- 1. is_retired — referenced by /api/slots and the bot-activity cron
--    but missing from every migration. No-op if it already exists.
-- ------------------------------------------------------------
alter table ad_slots add column if not exists is_retired boolean not null default false;

-- ------------------------------------------------------------
-- 2. Index for the expiry sweep. Without it, every sweep is a
--    sequential scan of occupancies.
-- ------------------------------------------------------------
create index if not exists occupancies_expiry_sweep
  on occupancies (expires_at)
  where is_active = true;

-- ------------------------------------------------------------
-- 3. expire_slot(uuid) — retire expired occupancies for ONE slot.
--
--    New function, not a replacement. The bid API calls this
--    immediately before place_bid so a stalled cleanup cron can
--    never let a dead occupancy (a) keep blocking the slot or
--    (b) inflate the minimum bid by min_increment_pct above a bid
--    whose time already ran out, or (c) collect a displacement
--    refund + 80% premium it is no longer entitled to.
-- ------------------------------------------------------------
create or replace function expire_slot(p_slot_id uuid) returns int as $$
declare
  v_count int;
begin
  update occupancies set is_active = false
  where slot_id = p_slot_id and is_active = true and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$ language plpgsql security definer;

-- ------------------------------------------------------------
-- 4. expire_occupancies() — unchanged behaviour, but <= instead of <
--    so it agrees exactly with expire_slot() and with the read-side
--    filter in /api/slots on the boundary second.
-- ------------------------------------------------------------
create or replace function expire_occupancies() returns int as $$
declare
  v_count int;
begin
  update occupancies set is_active = false
  where is_active = true and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$ language plpgsql security definer;

-- ------------------------------------------------------------
-- 5. One-off catch-up sweep for everything that should have expired
--    while the cron was not running.
-- ------------------------------------------------------------
select expire_occupancies();
