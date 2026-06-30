/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler, requireField, requireUuid, tooManyRequests, ApiError } from '@/lib/api-helpers';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { notifyContentRemoved } from '@/lib/notify';

export const POST = withApiHandler('admin-remove', async (req: NextRequest) => {
  const body = await req.json();

  const telegramId  = requireField(body.telegramId, 'telegramId');
  const occupancyId = requireUuid(body.occupancyId, 'occupancyId');
  const reasonRaw   = requireField(body.reason, 'reason');
  const reason = typeof reasonRaw === 'string' ? reasonRaw.slice(0, 500) : '';
  if (!reason.trim()) throw new ApiError('Reason cannot be empty', 400);

  const refundAmount = typeof body.refundAmount === 'number' && body.refundAmount > 0 ? body.refundAmount : 0;
  const reportId = body.reportId ? requireUuid(body.reportId, 'reportId') : null;

  const supabase = createServiceClient() as any;

  const { data: admin } = await supabase
    .from('admins')
    .select('id')
    .eq('telegram_id', Number(telegramId))
    .single();
  if (!admin) throw new ApiError('Not an admin', 403);

  const rl = await checkRateLimit({ key: `admin:${telegramId}`, ...RATE_LIMITS.adminAction });
  if (!rl.allowed) tooManyRequests(rl.limit);

  // Fetch occupancy details first so we can notify the affected user
  // and log the slot name, even after the row is flagged inactive.
  const { data: occBefore } = await supabase
    .from('occupancies')
    .select('user_id, slot_id, ad_slots(name)')
    .eq('id', occupancyId)
    .single();

  const { data, error } = await supabase.rpc('admin_remove_occupancy', {
    p_occupancy_id:  occupancyId,
    p_admin_id:      admin.id,
    p_reason:        reason.trim(),
    p_refund_amount: refundAmount,
  });

  if (error) {
    logger.error('admin_remove_db_error', { occupancyId, message: error.message });
    throw new ApiError('Failed to remove content', 500);
  }

  const result = data as { success: boolean; error?: string };
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (reportId) {
    await supabase.from('reports').update({ status: 'reviewed' }).eq('id', reportId);
  }

  logger.info('admin_content_removed', { occupancyId, adminTelegramId: telegramId, reason: reason.trim(), refundAmount });

  if (occBefore?.user_id) {
    notifyContentRemoved(
      occBefore.user_id,
      occBefore.ad_slots?.name ?? 'a slot',
      reason.trim(),
      refundAmount
    ).catch((err: unknown) => logger.error('notify_content_removed_failed', { error: String(err) }));
  }

  return NextResponse.json({ success: true });
});
