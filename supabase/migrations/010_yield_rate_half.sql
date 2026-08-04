-- ============================================================
-- 010_YIELD_RATE_HALF
--
-- Lower the slot-yield ceiling from 1 TON / 24h to 0.5 TON / 24h.
--
-- Why not just `create or replace function kh_yield_config()`?
-- kh_occupancy_accrued() always recomputes an occupancy's total
-- earned amount from its ORIGINAL created_at using whatever config
-- is active *right now*. If we lowered the cap without settling
-- first, every currently-held slot's already-accrued-but-unclaimed
-- yield (computed under the old 1 TON rate) would silently shrink
-- the instant the rate changed, because the same elapsed time now
-- earns less. Users would lose backlog yield they'd already earned,
-- with no payout and no record of it.
--
-- So this migration:
--   1. Pays out (settles) every user's currently accrued-but-unclaimed
--      yield RIGHT NOW, while the rate is still 1 TON — exactly like
--      claim_yield(), just run for everyone in one pass, before the
--      rate changes. This is real TON credited to wallet +
--      withdrawable_balance, same as any other claim.
--   2. Only then swaps kh_yield_config() to the new 0.5 TON cap.
--
-- Net effect: nobody's already-earned yield disappears. Going
-- forward, holding a slot earns at the new, lower 0.5 TON/24h rate.
-- For an occupancy that was already paid up to some amount under the
-- old rate, its claimable will read 0 again until further holding
-- time (under the new rate) exceeds what was already paid — that's
-- the expected, fair consequence of a rate cut, not a bug.
--
-- ⚠️ ADDITIVE / SAFE TO RE-RUN. Settling twice is harmless — the
-- second pass simply finds nothing left to pay (yield_claimed already
-- at the current accrued value) and claim_yield's normal idempotency
-- handles it.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Settle every user's outstanding yield at the CURRENT (still
--    1 TON) rate before we touch the config.
-- ------------------------------------------------------------
do $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select distinct user_id from occupancies
    where is_active = true or yield_settled = false
  loop
    perform claim_yield(v_user_id);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2. Lower the cap: 0.5 TON for a full 24h hold (unchanged window).
-- ------------------------------------------------------------
create or replace function kh_yield_config()
  returns table(max_ton numeric, window_seconds numeric)
  language sql immutable as $$
  select 0.5::numeric, 86400::numeric;   -- 0.5 TON over 24 hours
$$;
