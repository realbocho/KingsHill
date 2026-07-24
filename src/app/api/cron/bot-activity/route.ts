/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler } from '@/lib/api-helpers';
import { requireCronSecret } from '@/lib/cron-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const BOT_ADS = [
  { text: '🚀 Join KingsHill — Bid & Earn!',    emoji: '🚀', color: '#FFD700', url: null },
  { text: '💎 TON to the moon — KingsHill',      emoji: '💎', color: '#06B6D4', url: null },
  { text: '⚡ Fast gains on KingsHill',           emoji: '⚡', color: '#F59E0B', url: null },
  { text: '👑 Kings earn here. Do you?',          emoji: '👑', color: '#8B5CF6', url: null },
  { text: '🔥 Hot crypto auctions live now',      emoji: '🔥', color: '#EF4444', url: null },
  { text: '💰 Advertise & profit on TON',         emoji: '💰', color: '#10B981', url: null },
  { text: '🎯 Your brand, your slot, your TON',   emoji: '🎯', color: '#EC4899', url: null },
  { text: '🌟 Earn while you advertise',           emoji: '🌟', color: '#F97316', url: null },
];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randBetween(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

// Slots bots must never fill or displace — reserved for real users only.
const BOT_EXCLUDED_SLOT_NAMES = new Set([
  'Alpha Row A1',
  'Alpha Row A2',
  'Alpha Row A3',
  'Corner West',
]);

export const GET = withApiHandler('cron-bot-activity', async (req: NextRequest) => {
  requireCronSecret(req);

  const supabase = createServiceClient() as any;

  const { data: bots } = await supabase
    .from('users')
    .select('id, telegram_id, wallet')
    .eq('is_bot', true);

  if (!bots || bots.length === 0) {
    return NextResponse.json({ message: 'No bots found' });
  }

  for (const bot of bots) {
    if (Number(bot.wallet) < 50) {
      await supabase.from('users').update({ wallet: 200 }).eq('id', bot.id);
    }
  }

  const { data: slots } = await supabase
    .from('ad_slots')
    .select('id, name, tier, base_price, min_increment_pct')
    .eq('is_retired', false);

  // Same expiry predicate the board uses — otherwise a slot whose ad has
  // expired but hasn't been swept looks occupied to the bots, so they
  // never refill it and it sits dead until the cleanup cron runs.
  const { data: activeOccs } = await supabase
    .from('occupancies')
    .select('id, slot_id, user_id, bid_amount')
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString());

  const occBySlot: Record<string, any> = {};
  for (const occ of activeOccs ?? []) {
    occBySlot[occ.slot_id] = occ;
  }

  const { data: realUsers } = await supabase
    .from('users')
    .select('id')
    .eq('is_bot', false)
    .neq('telegram_id', -1);
  const realUserIds = new Set((realUsers ?? []).map((u: any) => u.id));

  let filled = 0;
  let displaced = 0;

  for (const slot of slots ?? []) {
    if (BOT_EXCLUDED_SLOT_NAMES.has(slot.name)) continue;

    const occ = occBySlot[slot.id];

    if (!occ) {
      // Empty slot — 30% chance bot fills it
      if (Math.random() > 0.30) continue;

      const bot = rand(bots) as any;
      const bidAmount = randBetween(slot.base_price, slot.base_price * 1.3);
      const ad = rand(BOT_ADS);
      const durationHours = rand([1, 6, 12, 24]);

      const { data: result } = await supabase.rpc('place_bid', {
        p_slot_id: slot.id, p_user_id: bot.id, p_bid_amount: bidAmount,
        p_duration_hours: durationHours, p_ad_text: ad.text, p_ad_url: ad.url,
        p_ad_emoji: ad.emoji, p_ad_color: ad.color, p_ad_image_path: null,
      });

      if (result?.success) {
        filled++;
        logger.info('bot_filled_slot', { slotId: slot.id, botId: bot.id, amount: bidAmount });
      }

    } else if (!realUserIds.has(occ.user_id)) {
      // Bot-occupied slot — 10% chance another bot displaces
      if (Math.random() > 0.10) continue;

      const minBid = Number(occ.bid_amount) * (1 + slot.min_increment_pct / 100);

      // Cap bot bids at 3x base_price to prevent runaway prices
      const maxBotBid = slot.base_price * 3;
      if (minBid > maxBotBid) continue;

      const bidAmount = randBetween(minBid, Math.min(minBid * 1.1, maxBotBid));
      const otherBots = bots.filter((b: any) => b.id !== occ.user_id);
      if (otherBots.length === 0) continue;

      const bot = rand(otherBots) as any;
      const ad = rand(BOT_ADS);
      const durationHours = rand([1, 6, 12, 24]);

      const { data: result } = await supabase.rpc('place_bid', {
        p_slot_id: slot.id, p_user_id: bot.id, p_bid_amount: bidAmount,
        p_duration_hours: durationHours, p_ad_text: ad.text, p_ad_url: ad.url,
        p_ad_emoji: ad.emoji, p_ad_color: ad.color, p_ad_image_path: null,
      });

      if (result?.success) {
        displaced++;
        logger.info('bot_displaced_bot', { slotId: slot.id, botId: bot.id, amount: bidAmount });
      }
    }
  }

  return NextResponse.json({ filled, displaced, bots: bots.length });
});
