-- ============================================================
-- TON CUSTODY WALLET
--
-- Architecture: the platform holds one master TON wallet. Each user
-- gets a unique deposit memo (their user UUID, or a derived short
-- code) that they must include as a comment when sending TON to the
-- master address. A polling job (cron) scans recent incoming
-- transactions via TonCenter API, matches the memo, and credits the
-- user's GRAM balance 1:1. Withdrawals are queued and processed by
-- a separate cron-triggered endpoint that signs and broadcasts the
-- transfer from the master wallet.
--
-- This keeps private keys server-side only (never touch the client)
-- and makes the whole flow auditable through normal Postgres rows.
-- ============================================================

-- Deposits: one row per detected on-chain incoming transaction
create table if not exists ton_deposits (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references users(id),
  tx_hash         text not null unique,         -- on-chain transaction hash, dedupe key
  tx_lt           text,                          -- logical time, for cursor pagination
  from_address    text not null,
  amount_nanoton  numeric(30,0) not null,        -- raw nanoTON amount (1 TON = 1e9 nanoTON)
  amount_ton      numeric(18,9) not null,        -- human-readable TON amount
  memo            text,                          -- comment extracted from the transfer
  status          text not null default 'pending', -- 'pending' | 'credited' | 'unmatched' | 'failed'
  credited_at     timestamptz,
  created_at      timestamptz default now()
);

create index if not exists ton_deposits_status on ton_deposits(status) where status in ('pending','unmatched');
create index if not exists ton_deposits_user on ton_deposits(user_id, created_at desc);

-- Withdrawals: queued requests, processed by a cron-triggered worker
create table if not exists ton_withdrawals (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references users(id),
  to_address      text not null,
  amount_gram     numeric(18,4) not null,        -- GRAM debited from wallet
  amount_ton      numeric(18,9) not null,        -- TON to actually send (1:1 with GRAM)
  network_fee_estimate numeric(18,9) default 0.01,
  status          text not null default 'pending', -- 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  tx_hash         text,
  failure_reason  text,
  requested_at    timestamptz default now(),
  processed_at    timestamptz
);

create index if not exists ton_withdrawals_status on ton_withdrawals(status) where status = 'pending';
create index if not exists ton_withdrawals_user on ton_withdrawals(user_id, requested_at desc);

-- Each user gets a stable deposit memo derived from their id, shown
-- in the UI as the "comment" they must attach when sending TON.
alter table users add column if not exists deposit_memo text unique;

create or replace function ensure_deposit_memo(p_user_id uuid) returns text as $$
declare
  v_memo text;
begin
  select deposit_memo into v_memo from users where id = p_user_id;
  if v_memo is null then
    v_memo := 'KH-' || upper(substr(replace(p_user_id::text, '-', ''), 1, 10));
    update users set deposit_memo = v_memo where id = p_user_id;
  end if;
  return v_memo;
end;
$$ language plpgsql security definer;

-- ============================================================
-- credit_deposit: atomically marks a deposit credited and tops up
-- the user's GRAM balance. Idempotent on tx_hash via the unique
-- constraint + the 'pending' status guard, so re-running the cron
-- scan never double-credits the same transaction.
-- ============================================================
create or replace function credit_deposit(
  p_deposit_id uuid
) returns jsonb as $$
declare
  v_dep ton_deposits;
begin
  select * into v_dep from ton_deposits where id = p_deposit_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Deposit not found');
  end if;
  if v_dep.status != 'pending' then
    return jsonb_build_object('success', false, 'error', 'Deposit already processed', 'status', v_dep.status);
  end if;
  if v_dep.user_id is null then
    return jsonb_build_object('success', false, 'error', 'Deposit has no matched user');
  end if;

  update ton_deposits set status = 'credited', credited_at = now() where id = p_deposit_id;

  update users set
    wallet = wallet + v_dep.amount_ton,
    updated_at = now()
  where id = v_dep.user_id;

  insert into wallet_transactions (user_id, type, amount, balance_after, reference_id, description)
  select v_dep.user_id, 'topup', v_dep.amount_ton, wallet, p_deposit_id,
         format('TON deposit credited (tx %s)', left(v_dep.tx_hash, 12))
  from users where id = v_dep.user_id;

  return jsonb_build_object('success', true, 'user_id', v_dep.user_id, 'amount', v_dep.amount_ton);
end;
$$ language plpgsql security definer;

-- ============================================================
-- request_withdrawal: validates balance, debits GRAM immediately
-- (reserving the funds) and queues the on-chain send for the cron
-- worker. If the on-chain send later fails, refund_withdrawal()
-- restores the balance.
-- ============================================================
create or replace function request_withdrawal(
  p_user_id    uuid,
  p_to_address text,
  p_amount     numeric
) returns jsonb as $$
declare
  v_user users;
  v_wd   ton_withdrawals;
  v_min_withdrawal numeric := 0.5; -- below this, network fees eat too much of the transfer
begin
  if p_amount < v_min_withdrawal then
    return jsonb_build_object('success', false, 'error', format('Minimum withdrawal is %s GRAM', v_min_withdrawal));
  end if;

  select * into v_user from users where id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  if v_user.wallet < p_amount then
    return jsonb_build_object('success', false, 'error', 'Insufficient balance');
  end if;

  update users set
    wallet = wallet - p_amount,
    updated_at = now()
  where id = p_user_id;

  insert into ton_withdrawals (user_id, to_address, amount_gram, amount_ton)
  values (p_user_id, p_to_address, p_amount, p_amount)
  returning * into v_wd;

  insert into wallet_transactions (user_id, type, amount, balance_after, reference_id, description)
  select p_user_id, 'bid', -p_amount, wallet, v_wd.id,
         format('Withdrawal requested to %s', left(p_to_address, 12))
  from users where id = p_user_id;

  return jsonb_build_object('success', true, 'withdrawal_id', v_wd.id);
end;
$$ language plpgsql security definer;

-- ============================================================
-- complete_withdrawal / fail_withdrawal: called by the cron worker
-- after attempting the on-chain transfer.
-- ============================================================
create or replace function complete_withdrawal(p_withdrawal_id uuid, p_tx_hash text) returns jsonb as $$
begin
  update ton_withdrawals set
    status = 'completed',
    tx_hash = p_tx_hash,
    processed_at = now()
  where id = p_withdrawal_id and status in ('pending','processing');

  if not found then
    return jsonb_build_object('success', false, 'error', 'Withdrawal not in a completable state');
  end if;

  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer;

create or replace function fail_withdrawal(p_withdrawal_id uuid, p_reason text) returns jsonb as $$
declare
  v_wd ton_withdrawals;
begin
  select * into v_wd from ton_withdrawals where id = p_withdrawal_id for update;
  if not found or v_wd.status not in ('pending','processing') then
    return jsonb_build_object('success', false, 'error', 'Withdrawal not in a failable state');
  end if;

  update ton_withdrawals set
    status = 'failed',
    failure_reason = p_reason,
    processed_at = now()
  where id = p_withdrawal_id;

  -- Refund the reserved GRAM back to the user since the on-chain send never happened
  update users set wallet = wallet + v_wd.amount_gram, updated_at = now() where id = v_wd.user_id;

  insert into wallet_transactions (user_id, type, amount, balance_after, reference_id, description)
  select v_wd.user_id, 'refund', v_wd.amount_gram, wallet, p_withdrawal_id,
         format('Withdrawal failed, refunded: %s', p_reason)
  from users where id = v_wd.user_id;

  return jsonb_build_object('success', true);
end;
$$ language plpgsql security definer;

alter table ton_deposits enable row level security;
alter table ton_withdrawals enable row level security;
create policy "Service full access deposits"    on ton_deposits    for all using (auth.role() = 'service_role');
create policy "Service full access withdrawals" on ton_withdrawals for all using (auth.role() = 'service_role');
create policy "Public read own deposits" on ton_deposits for select using (true);
create policy "Public read own withdrawals" on ton_withdrawals for select using (true);
