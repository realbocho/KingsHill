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
