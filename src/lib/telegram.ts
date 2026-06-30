import crypto from 'crypto';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface TelegramInitData {
  user?: TelegramUser;
  query_id?: string;
  auth_date: number;
  hash: string;
  start_param?: string;
}

/**
 * Validate Telegram WebApp initData on the server side.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initDataRaw: string, botToken: string): TelegramInitData | null {
  try {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');

    // Sort keys and build check string
    const checkString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // HMAC-SHA256 using "WebAppData" secret
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

    if (computedHash !== hash) return null;

    // Check auth_date not too old (1 hour)
    const authDate = parseInt(params.get('auth_date') || '0');
    if (Date.now() / 1000 - authDate > 3600) return null;

    const result: TelegramInitData = {
      auth_date: authDate,
      hash,
    };

    const userStr = params.get('user');
    if (userStr) result.user = JSON.parse(userStr);
    if (params.get('query_id')) result.query_id = params.get('query_id')!;
    if (params.get('start_param')) result.start_param = params.get('start_param')!;

    return result;
  } catch {
    return null;
  }
}

export function formatGrams(amount: number): string {
  if (amount >= 1000) return `${(amount / 1000).toFixed(2)}K GRAM`;
  return `${amount.toFixed(4)} GRAM`;
}

export function formatGramsShort(amount: number): string {
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  if (amount >= 1) return amount.toFixed(2);
  return amount.toFixed(4);
}

export function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function timeLeft(expires: string): string {
  const ms = new Date(expires).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

/** Builds the public Supabase Storage URL for an uploaded ad image path. */
export function adImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/ad-images/${path}`;
}

/**
 * Lightweight client-side shape check for TON addresses — just enough
 * to give immediate UI feedback before the form is submitted. The
 * authoritative check happens server-side via @ton/ton's Address.parse.
 */
export function isLikelyTonAddress(address: string): boolean {
  if (!address) return false;
  // Friendly-format addresses (base64url, 48 chars, often prefixed UQ/EQ/kQ/0Q)
  if (/^[A-Za-z0-9_-]{48}$/.test(address)) return true;
  // Raw format: workchain:hex64
  if (/^-?\d+:[0-9a-fA-F]{64}$/.test(address)) return true;
  return false;
}
