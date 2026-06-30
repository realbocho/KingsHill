-- ============================================================
-- IMAGE UPLOAD SUPPORT
-- ============================================================
alter table occupancies add column if not exists ad_image_path text;
alter table bid_history  add column if not exists ad_image_path text;

-- ============================================================
-- UPDATED place_bid: accepts an image path, returns displaced_user_id
-- so the API layer can fire a push notification without an extra query.
-- ============================================================
create or replace function place_bid(
  p_slot_id        uuid,
  p_user_id        uuid,
  p_bid_amount     numeric,
  p_duration_hours int,
  p_ad_text        text,
  p_ad_url         text,
  p_ad_emoji       text,
  p_ad_color       text,
  p_ad_image_path  text default null
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
  select * into v_slot from ad_slots where id = p_slot_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Slot not found');
  end if;

  select * into v_user from users where id = p_user_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  select * into v_current_occ
  from occupancies
  where slot_id = p_slot_id and is_active = true
  order by created_at desc limit 1;

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

  if v_user.wallet < p_bid_amount then
    return jsonb_build_object('success', false, 'error', 'Insufficient balance');
  end if;

  if v_current_occ.id is not null then
    v_premium      := p_bid_amount - v_current_occ.bid_amount;
    v_platform_fee := v_premium * 0.20;
    v_refund       := v_current_occ.bid_amount + (v_premium * 0.80);
  else
    v_premium      := 0;
    v_platform_fee := p_bid_amount * 0.05;
    v_refund       := 0;
  end if;

  update users set
    wallet      = wallet - p_bid_amount,
    total_spent = total_spent + p_bid_amount,
    updated_at  = now()
  where id = p_user_id;

  insert into wallet_transactions (user_id, type, amount, balance_after, description)
  values (
    p_user_id, 'bid', -p_bid_amount,
    v_user.wallet - p_bid_amount,
    format('Bid on %s', v_slot.name)
  );

  if v_current_occ.id is not null then
    update occupancies set is_active = false where id = v_current_occ.id;

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

  insert into occupancies (slot_id, user_id, bid_amount, ad_text, ad_url, ad_emoji, ad_color, ad_image_path, expires_at)
  values (
    p_slot_id, p_user_id, p_bid_amount,
    p_ad_text, p_ad_url, p_ad_emoji, p_ad_color, p_ad_image_path,
    now() + (p_duration_hours || ' hours')::interval
  )
  returning * into v_new_occ;

  insert into bid_history (slot_id, bidder_id, displaced_id, bid_amount, premium_paid, platform_fee, refund_amount, ad_text, ad_url, ad_emoji, ad_color, ad_image_path)
  values (p_slot_id, p_user_id, v_current_occ.user_id, p_bid_amount, v_premium, v_platform_fee, v_refund, p_ad_text, p_ad_url, p_ad_emoji, p_ad_color, p_ad_image_path)
  returning * into v_bid_rec;

  update platform_stats set
    total_bids    = total_bids + 1,
    total_volume  = total_volume + p_bid_amount,
    total_fees_collected = total_fees_collected + v_platform_fee,
    updated_at    = now();

  return jsonb_build_object(
    'success',           true,
    'occupancy_id',      v_new_occ.id,
    'bid_id',            v_bid_rec.id,
    'premium_paid',      v_premium,
    'platform_fee',      v_platform_fee,
    'refund_issued',     v_refund,
    'displaced_user_id', v_current_occ.user_id
  );
end;
$$ language plpgsql security definer;
