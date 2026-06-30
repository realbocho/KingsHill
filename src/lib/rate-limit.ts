import { createServiceClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';

interface RateLimitConfig {
  /** Unique key per limited identity, e.g. `bid:${telegramId}` */
  key: string;
  /** Window size in seconds */
  windowSeconds: number;
  /** Max requests allowed within the window */
  limit: number;
}

interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

/**
 * Postgres-backed fixed-window rate limiter. Safe across concurrent
 * serverless invocations because the increment happens atomically in
 * the database (see rate_limit_hit() in migration 003).
 */
export async function checkRateLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  try {
    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any;

    const { data, error } = await client.rpc('rate_limit_hit', {
      p_bucket_key: config.key,
      p_window_seconds: config.windowSeconds,
    });

    if (error) {
      // Fail open: if the limiter itself breaks, don't block real users —
      // log it loudly so it gets fixed, but let the request through.
      logger.error('rate_limit_check_failed', { key: config.key, error: error.message });
      return { allowed: true, count: 0, limit: config.limit };
    }

    const count = data as number;
    return { allowed: count <= config.limit, count, limit: config.limit };
  } catch (err) {
    logger.error('rate_limit_check_exception', { key: config.key, error: String(err) });
    return { allowed: true, count: 0, limit: config.limit };
  }
}

/** Common presets used across API routes. */
export const RATE_LIMITS = {
  bid:           { windowSeconds: 60,   limit: 10 },  // 10 bids / minute / user
  report:        { windowSeconds: 60,   limit: 5 },   // 5 reports / minute / user
  auth:          { windowSeconds: 60,   limit: 20 },  // 20 auth calls / minute / telegram id
  imageUpload:   { windowSeconds: 60,   limit: 10 },  // 10 uploads / minute / user
  withdrawal:    { windowSeconds: 3600, limit: 5 },   // 5 withdrawal requests / hour / user
  adminAction:   { windowSeconds: 60,   limit: 60 },  // generous, admins are trusted
} as const;
