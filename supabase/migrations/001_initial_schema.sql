-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS
-- ============================================================
create table if not exists users (
  id           uuid primary key default uuid_generate_v4(),
  telegram_id  bigint unique not null,
  username     text,
  first_name   text,
  last_name    text,
  photo_url    text,
  wallet       numeric(18,4) not null default 0,
  total_earned numeric(18,4) not null default 0,
  total_spent  numeric(18,4) not null default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists users_telegram_id_idx on users(telegram_id);

-- ============================================================
-- AD SLOTS (the board positions)
-- ============================================================
create table if not exists ad_slots (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,           -- e.g. "Prime A1", "Side B3"
  tier         text not null default 'standard',  -- 'prime' | 'standard' | 'corner'
  position     int not null,            -- display order
  width_units  int not null default 1,  -- visual grid cols
  height_units int not null default 1,  -- visual grid rows
  base_price   numeric(10,4) not null default 0.01,
  min_increment_pct numeric(5,2) not null default 10, -- minimum % above current bid
  created_at   timestamptz default now()
);

-- ============================================================
-- OCCUPANCIES (current state of each slot)
-- ============================================================
create table if not exists occupancies (
  id               uuid primary key default uuid_generate_v4(),
  slot_id          uuid not null references ad_slots(id) on delete cascade,
  user_id          uuid not null references users(id),
  bid_amount       numeric(14,4) not null,
  ad_text          text,
  ad_url           text,
  ad_emoji         text default '🔥',
  ad_color         text default '#FFD700',
  expires_at       timestamptz not null,
  is_active        boolean not null default true,
  created_at       timestamptz default now()
);

create index if not exists occupancies_slot_active on occupancies(slot_id) where is_active = true;
create index if not exists occupancies_user_id on occupancies(user_id);

-- ============================================================
-- BID HISTORY
-- ============================================================
create table if not exists bid_history (
  id            uuid primary key default uuid_generate_v4(),
  slot_id       uuid not null references ad_slots(id),
  bidder_id     uuid not null references users(id),
  displaced_id  uuid references users(id),   -- who got bumped
  bid_amount    numeric(14,4) not null,
  premium_paid  numeric(14,4) not null default 0,  -- amount above previous bid
  platform_fee  numeric(14,4) not null default 0,
  refund_amount numeric(14,4) not null default 0,  -- returned to displaced user
  ad_text       text,
  ad_url        text,
  ad_emoji      text,
  ad_color      text,
  created_at    timestamptz default now()
);

create index if not exists bid_history_slot on bid_history(slot_id, created_at desc);
create index if not exists bid_history_user on bid_history(bidder_id, created_at desc);

-- ============================================================
-- WALLET TRANSACTIONS
-- ============================================================
create table if not exists wallet_transactions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references users(id),
  type        text not null,   -- 'bid' | 'refund' | 'reward' | 'topup' | 'fee'
  amount      numeric(14,4) not null,  -- positive = credit, negative = debit
  balance_after numeric(14,4) not null,
  reference_id  uuid,         -- bid_history.id
  description   text,
  created_at    timestamptz default now()
);

create index if not exists wallet_tx_user on wallet_transactions(user_id, created_at desc);

-- ============================================================
-- PLATFORM STATS (for the ticker)
-- ============================================================
create table if not exists platform_stats (
  id                  uuid primary key default uuid_generate_v4(),
  total_bids          bigint not null default 0,
  total_volume        numeric(18,4) not null default 0,
  total_users         bigint not null default 0,
  total_fees_collected numeric(18,4) not null default 0,
  updated_at          timestamptz default now()
);

insert into platform_stats (id) values (uuid_generate_v4()) on conflict do nothing;

-- ============================================================
-- SEED AD SLOTS
-- ============================================================
insert into ad_slots (name, tier, position, width_units, height_units, base_price, min_increment_pct) values
  ('Prime Nexus',     'prime',    1,  3, 2, 1.00,  15),
  ('Alpha Row A1',    'standard', 2,  1, 1, 0.05,  10),
  ('Alpha Row A2',    'standard', 3,  1, 1, 0.05,  10),
  ('Alpha Row A3',    'standard', 4,  1, 1, 0.05,  10),
  ('Beta Row B1',     'standard', 5,  1, 1, 0.05,  10),
  ('Beta Row B2',     'standard', 6,  1, 1, 0.05,  10),
  ('Beta Row B3',     'standard', 7,  1, 1, 0.05,  10),
  ('Corner East',     'corner',   8,  1, 2, 0.25,  12),
  ('Corner West',     'corner',   9,  1, 2, 0.25,  12),
  ('Strip South',     'standard', 10, 3, 1, 0.10,  10)
on conflict do nothing;

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Get or create user from Telegram data
create or replace function upsert_telegram_user(
  p_telegram_id bigint,
  p_username    text,
  p_first_name  text,
  p_last_name   text,
  p_photo_url   text
) returns users as $$
declare
  v_user users;
begin
  insert into users (telegram_id, username, first_name, last_name, photo_url)
  values (p_telegram_id, p_username, p_first_name, p_last_name, p_photo_url)
  on conflict (telegram_id) do update set
    username   = coalesce(excluded.username, users.username),
    first_name = coalesce(excluded.first_name, users.first_name),
    last_name  = coalesce(excluded.last_name, users.last_name),
    photo_url  = coalesce(excluded.photo_url, users.photo_url),
    updated_at = now()
  returning * into v_user;
  return v_user;
end;
$$ language plpgsql security definer;

-- Place a bid on a slot
create or replace function place_bid(
  p_slot_id   uuid,
  p_user_id   uuid,
  p_bid_amount numeric,
  p_duration_hours int,  -- how many hours to occupy
  p_ad_text   text,
  p_ad_url    text,
  p_ad_emoji  text,
  p_ad_color  text
) returns jsonb as $$
declare
  v_slot         ad_slots;
  v_current_occ  occupancies;
  v_user         users;
  v_min_bid      numeric;
  v_premium      numeric;
  v_platform_fee numeric;
  v_refund       numeric;
  v_new_occ      occupancies;
  v_bid_rec      bid_history;
begin
  -- Lock the slot row
  select * into v_slot from ad_slots where id = p_slot_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Slot not found');
  end if;

  -- Get bidder
  select * into v_user from users where id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  -- Get current active occupancy (if any)
  select * into v_current_occ
  from occupancies
  where slot_id = p_slot_id and is_active = true
  order by created_at desc limit 1;

  -- Calculate minimum bid
  if v_current_occ.id is not null then
    v_min_bid := v_current_occ.bid_amount * (1 + v_slot.min_increment_pct / 100.0);
  else
    v_min_bid := v_slot.base_price;
  end if;

  if p_bid_amount < v_min_bid then
    return jsonb_build_object(
      'success', false,
      'error', format('Bid must be at least %s', v_min_bid),
      'min_bid', v_min_bid
    );
  end if;

  -- Check user balance
  if v_user.wallet < p_bid_amount then
    return jsonb_build_object('success', false, 'error', 'Insufficient balance');
  end if;

  -- Calculate fees
  if v_current_occ.id is not null then
    v_premium      := p_bid_amount - v_current_occ.bid_amount;
    v_platform_fee := v_premium * 0.20;  -- 20% of premium goes to platform
    v_refund       := v_current_occ.bid_amount + (v_premium * 0.80); -- 80% premium back to displaced
  else
    v_premium      := 0;
    v_platform_fee := p_bid_amount * 0.05;  -- 5% on new slot bids
    v_refund       := 0;
  end if;

  -- Deduct from bidder wallet
  update users set
    wallet      = wallet - p_bid_amount,
    total_spent = total_spent + p_bid_amount,
    updated_at  = now()
  where id = p_user_id;

  -- Log debit transaction
  insert into wallet_transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id, 'bid', -p_bid_amount,
    v_user.wallet - p_bid_amount,
    format('Bid on %s', v_slot.name)
  );

  -- Deactivate old occupancy and refund previous holder
  if v_current_occ.id is not null then
    update occupancies set is_active = false where id = v_current_occ.id;

    -- Refund displaced user
    update users set
      wallet       = wallet + v_refund,
      total_earned = total_earned + (v_refund - v_current_occ.bid_amount),
      updated_at   = now()
    where id = v_current_occ.user_id;

    insert into wallet_transactions (user_id, type, amount, balance_after, reference_id, description)
    select
      v_current_occ.user_id, 'refund', v_refund,
      wallet, null,
      format('Displaced from %s — earned +%s premium', v_slot.name, round(v_refund - v_current_occ.bid_amount, 4))
    from users where id = v_current_occ.user_id;
  end if;

  -- Create new occupancy
  insert into occupancies (slot_id, user_id, bid_amount, ad_text, ad_url, ad_emoji, ad_color, expires_at)
  values (
    p_slot_id, p_user_id, p_bid_amount,
    p_ad_text, p_ad_url, p_ad_emoji, p_ad_color,
    now() + (p_duration_hours || ' hours')::interval
  )
  returning * into v_new_occ;

  -- Record in bid history
  insert into bid_history (slot_id, bidder_id, displaced_id, bid_amount, premium_paid, platform_fee, refund_amount, ad_text, ad_url, ad_emoji, ad_color)
  values (p_slot_id, p_user_id, v_current_occ.user_id, p_bid_amount, v_premium, v_platform_fee, v_refund, p_ad_text, p_ad_url, p_ad_emoji, p_ad_color)
  returning * into v_bid_rec;

  -- Update platform stats
  update platform_stats set
    total_bids    = total_bids + 1,
    total_volume  = total_volume + p_bid_amount,
    total_fees_collected = total_fees_collected + v_platform_fee,
    updated_at    = now();

  return jsonb_build_object(
    'success',       true,
    'occupancy_id',  v_new_occ.id,
    'bid_id',        v_bid_rec.id,
    'premium_paid',  v_premium,
    'platform_fee',  v_platform_fee,
    'refund_issued', v_refund
  );
end;
$$ language plpgsql security definer;

-- Expire occupancies that have passed their time
create or replace function expire_occupancies() returns int as $$
declare
  v_count int;
begin
  update occupancies set is_active = false
  where is_active = true and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$ language plpgsql security definer;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table users enable row level security;
alter table occupancies enable row level security;
alter table bid_history enable row level security;
alter table wallet_transactions enable row level security;
alter table ad_slots enable row level security;
alter table platform_stats enable row level security;

-- Public read for display
create policy "Public read slots"      on ad_slots         for select using (true);
create policy "Public read occupancies" on occupancies      for select using (true);
create policy "Public read bid history" on bid_history      for select using (true);
create policy "Public read stats"      on platform_stats   for select using (true);
create policy "Public read users"      on users            for select using (true);
create policy "Public read wallet tx"  on wallet_transactions for select using (true);

-- Service role can do anything (used by API routes)
create policy "Service full access users"    on users               for all using (auth.role() = 'service_role');
create policy "Service full access occ"      on occupancies         for all using (auth.role() = 'service_role');
create policy "Service full access bids"     on bid_history         for all using (auth.role() = 'service_role');
create policy "Service full access wallet"   on wallet_transactions for all using (auth.role() = 'service_role');
create policy "Service full access stats"    on platform_stats      for all using (auth.role() = 'service_role');
create policy "Service full access slots"    on ad_slots            for all using (auth.role() = 'service_role');
