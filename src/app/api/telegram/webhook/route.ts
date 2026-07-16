import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Ownership-verification handshake required by the app directory before
 * the Mini App can be published: they DM the bot `/appss_verify` and
 * expect exactly VERIFY_CODE back, proving we control the bot token.
 */
const VERIFY_COMMAND = 'appss_verify';
const VERIFY_CODE = 'appss_5691b0';

interface TelegramUpdate {
  message?: {
    chat?: { id: number };
    text?: string;
  };
}

/** Plain-text reply. No parse_mode — the directory compares the body byte-for-byte. */
async function reply(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn('webhook_reply_skipped_no_token', { chatId });
    return;
  }

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!res.ok) {
    logger.warn('webhook_reply_failed', { chatId, status: res.status, body: await res.text() });
  }
}

/** `/appss_verify@KingsHillBot extra args` -> `appss_verify` */
function parseCommand(text: string): string | null {
  if (!text.startsWith('/')) return null;
  return text.split(/\s+/)[0].slice(1).split('@')[0].toLowerCase();
}

export const POST = withApiHandler('telegram-webhook', async (req: NextRequest) => {
  // Telegram echoes back the secret_token we passed to setWebhook. Without
  // this, anyone who guesses the URL could POST forged updates at us.
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && req.headers.get('x-telegram-bot-api-secret-token') !== expected) {
    logger.warn('webhook_bad_secret');
    return NextResponse.json({ ok: true });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  const text = update.message?.text;

  if (chatId && text && parseCommand(text) === VERIFY_COMMAND) {
    logger.info('appss_verify_received', { chatId });
    await reply(chatId, VERIFY_CODE);
  }

  // Always 200. Any non-2xx makes Telegram redeliver the same update in a loop.
  return NextResponse.json({ ok: true });
});
