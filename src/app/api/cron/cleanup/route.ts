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
 *   - expire_occupancies(): resets slots whose time ran out (this also
 *     runs on every /api/slots read, but the cron sweep guarantees it
 *     happens even if nobody has the app open)
 *   - cleanup_rate_limits(): drops rate-limit window rows older than
 *     1 hour so that table doesn't grow unbounded
 *   - stale 'unmatched' deposits and stuck 'processing' withdrawals get
 *     logged for manual admin reconciliation
 */
export const GET = withApiHandler('cron-cleanup', async (req: NextRequest) => {
  requireCronSecret(req);

  const supabase = createServiceClient() as any;

  const [{ data: expiredCount }, { data: rateLimitCleaned }] = await Promise.all([
    supabase.rpc('expire_occupancies'),
    supabase.rpc('cleanup_rate_limits'),
  ]);

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

  return NextResponse.json({
    expiredOccupancies: expiredCount,
    rateLimitRowsCleaned: rateLimitCleaned,
    staleUnmatchedDeposits: staleUnmatched?.length ?? 0,
    stuckWithdrawals: stuckWithdrawals?.length ?? 0,
  });
});
