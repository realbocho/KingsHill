/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServiceClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Sends a message to a user via the Telegram Bot API. This works
 * without any separate bot server/process — it's a plain HTTPS POST
 * that can be called from any Vercel serverless function. The bot
 * must have been started by the user at least once (Telegram requires
 * this before a bot can message a user proactively).
 */
async function sendTelegramMessage(telegramId: number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn('telegram_notify_skipped_no_token', { telegramId });
    return false;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      // 403 means the user blocked the bot or never started it — not a real error, just log at info level.
      if (res.status === 403) {
        logger.info('telegram_notify_blocked', { telegramId });
      } else {
        logger.warn('telegram_notify_failed', { telegramId, status: res.status, body });
      }
      return false;
    }
    return true;
  } catch (err) {
    logger.error('telegram_notify_exception', { telegramId, error: String(err) });
    return false;
  }
}

/** Notify a user that they were displaced from a slot (lost the auction, got refunded). */
export async function notifyDisplaced(displacedUserId: string, slotId: string, newBidAmount: number) {
  const supabase = createServiceClient() as any;

  const [{ data: user }, { data: slot }] = await Promise.all([
    supabase.from('users').select('telegram_id, wallet').eq('id', displacedUserId).single(),
    supabase.from('ad_slots').select('name').eq('id', slotId).single(),
  ]);

  if (!user) return;

  const text =
    `⚔️ <b>You've been displaced!</b>\n\n` +
    `Someone outbid you on <b>${slot?.name ?? 'a slot'}</b> with ${newBidAmount.toFixed(4)} GRAM.\n` +
    `Your stake plus profit has been refunded to your wallet.\n\n` +
    `💰 New balance: <b>${Number(user.wallet).toFixed(2)} GRAM</b>\n\n` +
    `Open KingsHill to claim a new spot 👑`;

  await sendTelegramMessage(user.telegram_id, text);
}

/** Notify a user that their content was removed by an admin. */
export async function notifyContentRemoved(userId: string, slotName: string, reason: string, refundAmount: number) {
  const supabase = createServiceClient() as any;
  const { data: user } = await supabase.from('users').select('telegram_id').eq('id', userId).single();
  if (!user) return;

  const refundLine = refundAmount > 0
    ? `A partial refund of ${refundAmount.toFixed(4)} GRAM was issued.`
    : `No refund was issued — the stake was forfeited per our content policy.`;

  const text =
    `🛡 <b>Your ad on "${slotName}" was removed</b>\n\n` +
    `Reason: ${reason}\n\n${refundLine}\n\n` +
    `Repeated violations may result in further action on your account.`;

  await sendTelegramMessage(user.telegram_id, text);
}

/** Notify a user their TON withdrawal was processed. */
export async function notifyWithdrawalProcessed(userId: string, amountTon: number, txHash: string | null, status: 'completed' | 'failed') {
  const supabase = createServiceClient() as any;
  const { data: user } = await supabase.from('users').select('telegram_id').eq('id', userId).single();
  if (!user) return;

  const text = status === 'completed'
    ? `✅ <b>Withdrawal sent</b>\n\n${amountTon.toFixed(4)} TON has been sent to your wallet.\n${txHash ? `Tx: <code>${txHash}</code>` : ''}`
    : `❌ <b>Withdrawal failed</b>\n\nYour withdrawal of ${amountTon.toFixed(4)} TON could not be processed. Your GRAM balance has been restored. Please try again or contact support.`;

  await sendTelegramMessage(user.telegram_id, text);
}

/** Notify a user a deposit was credited. */
export async function notifyDepositCredited(userId: string, amountTon: number) {
  const supabase = createServiceClient() as any;
  const { data: user } = await supabase.from('users').select('telegram_id').eq('id', userId).single();
  if (!user) return;

  const text =
    `🎁 <b>Deposit received</b>\n\n` +
    `${amountTon.toFixed(4)} TON has been converted to ${amountTon.toFixed(4)} GRAM and credited to your wallet.`;

  await sendTelegramMessage(user.telegram_id, text);
}

/**
 * Broadcast: a new ad just went live on a slot. Sends an engagement,
 * profit-focused promo to every OTHER real user who has started the
 * bot. Fire-and-forget and throttled to respect Telegram's bulk-send
 * limits.
 *
 * The hook (its caller in /api/bid) does not await this, so a slow or
 * failing broadcast never delays the bid response.
 *
 * NOTE: this messages users on every new ad. It drives engagement but
 * can get spammy at scale — consider a per-user opt-out toggle or a
 * per-slot cooldown before high volume. Bot/seed accounts are excluded
 * so we never message the random real Telegram IDs they may hold.
 */
export async function notifyNewAd(
  bidderId: string,
  slotId: string,
  bidAmount: number,
  adText: string | null,
  adEmoji: string | null,
) {
  const supabase = createServiceClient() as any;

  const [{ data: slot }, { data: recipients }] = await Promise.all([
    supabase.from('ad_slots').select('name, min_increment_pct').eq('id', slotId).single(),
    supabase
      .from('users')
      .select('telegram_id')
      .neq('id', bidderId)
      .neq('is_bot', true)          // never message seeded/bot accounts
      .order('updated_at', { ascending: false })
      .limit(2000),                 // cap the blast radius per event
  ]);

  if (!recipients || recipients.length === 0) return;

  const slotName = slot?.name ?? 'a prime slot';
  const incPct   = Number(slot?.min_increment_pct ?? 10);
  const nextBid  = bidAmount * (1 + incPct / 100);
  const preview  = adText ? `${adEmoji ?? '🔥'} ${adText.slice(0, 40)}` : 'a new campaign';

  const text =
    `🔔 <b>New ad just claimed ${slotName}!</b>\n\n` +
    `${preview}\n\n` +
    `💥 <b>Seize it and get paid.</b> Take the spot for as little as <b>${nextBid.toFixed(4)} GRAM</b>.\n` +
    `💧 Every second you hold it earns <b>real TON</b> — up to <b>0.5 TON / 24h</b>, withdrawable instantly, no strings.\n` +
    `💰 And if someone later outbids YOU, you pocket your stake back <b>+ 80% of their premium</b>.\n\n` +
    `👑 Tap in and take the hill before someone else does.`;

  // Throttle: Telegram allows roughly 30 messages/second in bulk.
  const BATCH = 25;
  for (let i = 0; i < recipients.length; i += BATCH) {
    const chunk = recipients.slice(i, i + BATCH);
    await Promise.all(chunk.map((r: any) => sendTelegramMessage(r.telegram_id, text)));
    if (i + BATCH < recipients.length) {
      await new Promise(res => setTimeout(res, 1100));
    }
  }

  logger.info('new_ad_broadcast', { slotId, recipients: recipients.length });
}
