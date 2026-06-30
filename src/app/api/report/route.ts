/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler, requireUuid, requireField, tooManyRequests, ApiError } from '@/lib/api-helpers';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const POST = withApiHandler('report', async (req: NextRequest) => {
  const body = await req.json();

  const occupancyId = requireUuid(body.occupancyId, 'occupancyId');
  const reasonRaw = requireField(body.reason, 'reason');
  const reason = typeof reasonRaw === 'string' ? reasonRaw.slice(0, 300) : '';
  if (!reason.trim()) throw new ApiError('Reason cannot be empty', 400);

  // reporterId is optional (anonymous reports allowed) but if present must be a valid UUID
  const reporterId = body.reporterId ? requireUuid(body.reporterId, 'reporterId') : null;

  const supabase = createServiceClient() as any;

  // Rate limit by reporter when known, otherwise by occupancy (slows
  // down anonymous report-spam against a single target).
  const bucketKey = reporterId ? `report:${reporterId}` : `report-anon:${occupancyId}`;
  const rl = await checkRateLimit({ key: bucketKey, ...RATE_LIMITS.report });
  if (!rl.allowed) {
    logger.warn('report_rate_limited', { bucketKey, count: rl.count });
    tooManyRequests(rl.limit);
  }

  const { error } = await supabase.from('reports').insert({
    occupancy_id: occupancyId,
    reporter_id:  reporterId,
    reason:       reason.trim(),
  });

  if (error) {
    logger.error('report_insert_failed', { occupancyId, message: error.message });
    throw new ApiError('Failed to submit report', 500);
  }

  logger.info('report_submitted', { occupancyId, reporterId });

  return NextResponse.json({ success: true });
});
