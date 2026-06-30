/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler, requireField, requireValidAmount, requireUuid, tooManyRequests, ApiError } from '@/lib/api-helpers';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { notifyDisplaced } from '@/lib/notify';

export const POST = withApiHandler('bid', async (req: NextRequest) => {
  const body = await req.json();

  const userId       = requireUuid(body.userId, 'userId');
  const slotId        = requireUuid(body.slotId, 'slotId');
  const amount         = requireValidAmount(body.bidAmount, 'bidAmount');
  const durationHours   = Math.min(Math.max(parseInt(body.durationHours ?? '1', 10) || 1, 1), 168);
  const adText           = typeof body.adText === 'string' ? body.adText.slice(0, 60) : null;
  requireField(adText, 'adText');
  const adUrl             = typeof body.adUrl === 'string' ? body.adUrl.slice(0, 300) : null;
  const adEmoji            = typeof body.adEmoji === 'string' ? body.adEmoji.slice(0, 8) : '🔥';
  const adColor             = typeof body.adColor === 'string' ? body.adColor.slice(0, 9) : '#FFD700';
  const adImagePath          = typeof body.adImagePath === 'string' ? body.adImagePath.slice(0, 500) : null;

  const supabase = createServiceClient() as any;

  const { data: userRow } = await supabase.from('users').select('telegram_id').eq('id', userId).single();
  const bucketId = userRow?.telegram_id ?? userId;

  const rl = await checkRateLimit({ key: `bid:${bucketId}`, ...RATE_LIMITS.bid });
  if (!rl.allowed) {
    logger.warn('bid_rate_limited', { userId, count: rl.count });
    tooManyRequests(rl.limit);
  }

  const { data, error } = await supabase.rpc('place_bid', {
    p_slot_id:        slotId,
    p_user_id:        userId,
    p_bid_amount:     amount,
    p_duration_hours: durationHours,
    p_ad_text:        adText,
    p_ad_url:         adUrl,
    p_ad_emoji:       adEmoji,
    p_ad_color:       adColor,
    p_ad_image_path:  adImagePath,
  });

  if (error) {
    logger.error('place_bid_db_error', { userId, slotId, message: error.message });
    throw new ApiError('Failed to place bid', 500);
  }

  const result = data as { success: boolean; error?: string; min_bid?: number; displaced_user_id?: string };

  if (!result.success) {
    return NextResponse.json({ error: result.error, min_bid: result.min_bid }, { status: 400 });
  }

  logger.info('bid_placed', { userId, slotId, amount });

  if (result.displaced_user_id) {
    notifyDisplaced(result.displaced_user_id, slotId, amount).catch(err =>
      logger.error('notify_displaced_failed', { error: String(err) })
    );
  }

  const { data: user } = await supabase
    .from('users')
    .select('wallet, withdrawable_balance, total_earned, total_spent')
    .eq('id', userId)
    .single();

  return NextResponse.json({ ...result, user });
});
