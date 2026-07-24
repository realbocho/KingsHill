/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler } from '@/lib/api-helpers';
import { requireCronSecret } from '@/lib/cron-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Intended trigger: cron-job.org, every 5 minutes, hitting
 *   GET https://your-app.vercel.app/api/cron/cleanup?secret=YOUR_CRON_SECRET
 *
 * Housekeeping that keeps the app correct and the database lean:
 *   - expire_occupancies(): resets slots whose time ran out. /api/slots
 *     also runs this, but throttled to once a minute per warm instance
 *     and only when someone has the app open — this sweep is what keeps
 *     the board correct on an idle app. Note /api/slots additionally
 *     filters expired rows at read time, so a failure here degrades
 *     is_active accuracy, not what users see.
 *   - cleanup_rate_limits(): drops rate-limit window rows older than
 *     1 hour so that table doesn't grow unbounded
 *   - stale 'unmatched' deposits and stuck 'processing' withdrawals get
 *     logged for manual admin reconciliation
 */
export const GET = withApiHandler('cron-cleanup', async (req: NextRequest) => {
  requireCronSecret(req);

  const supabase = createServiceClient() as any;

  // These RPC errors used to be discarded, so a sweep that never ran —
  // missing function, permissions, migrations not applied — still logged
  // 'cron_cleanup_completed' and returned HTTP 200 with a null count.
  // The cron dashboard showed green while nothing expired. Surface it.
  const [expireRes, rateLimitRes] = await Promise.all([
    supabase.rpc('expire_occupancies'),
    supabase.rpc('cleanup_rate_limits'),
  ]);

  if (expireRes.error) {
    logger.error('expire_occupancies_failed', { message: expireRes.error.message });
  }
  if (rateLimitRes.error) {
    logger.error('cleanup_rate_limits_failed', { message: rateLimitRes.error.message });
  }

  const expiredCount     = expireRes.data;
  const rateLimitCleaned = rateLimitRes.data;

  const { data: staleUnmatched } = await supabase
    .from('ton_deposits')
    .select('id, tx_hash, amount_ton, created_at')
    .eq('status', 'unmatched')
    .lt('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());

  if (staleUnmatched && staleUnmatched.length > 0) {
    logger.warn('stale_unmatched_deposits', { count: staleUnmatched.length, ids: staleUnmatched.map((d: any) => d.id) });
  }

  // Stuck withdrawals: anything left in 'processing' for over 10 minutes
  // likely means the cron run that started it crashed mid-flight or the
  // confirmation timed out. Flag for manual review rather than silently
  // retrying (retrying a send we're unsure landed risks double-paying).
  const { data: stuckWithdrawals } = await supabase
    .from('ton_withdrawals')
    .select('id, user_id, amount_ton, requested_at')
    .eq('status', 'processing')
    .lt('requested_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());

  if (stuckWithdrawals && stuckWithdrawals.length > 0) {
    logger.error('stuck_withdrawals_need_review', { count: stuckWithdrawals.length, ids: stuckWithdrawals.map((w: any) => w.id) });
  }

  logger.info('cron_cleanup_completed', {
    expiredOccupancies: expiredCount,
    rateLimitRowsCleaned: rateLimitCleaned,
    staleUnmatchedDeposits: staleUnmatched?.length ?? 0,
    stuckWithdrawals: stuckWithdrawals?.length ?? 0,
  });

  return NextResponse.json(
    {
      ok: !expireRes.error && !rateLimitRes.error,
      expiredOccupancies: expiredCount,
      expireError: expireRes.error?.message ?? null,
      rateLimitRowsCleaned: rateLimitCleaned,
      staleUnmatchedDeposits: staleUnmatched?.length ?? 0,
      stuckWithdrawals: stuckWithdrawals?.length ?? 0,
    },
    // Non-2xx so cron-job.org's dashboard actually flags a broken sweep
    // instead of showing a green run that did nothing.
    { status: expireRes.error ? 500 : 200 }
  );
});
