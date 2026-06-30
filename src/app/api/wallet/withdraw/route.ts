/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler, requireUuid, requireValidAmount, requireField, tooManyRequests, ApiError } from '@/lib/api-helpers';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isValidTonAddress } from '@/lib/ton-wallet';
import { logger } from '@/lib/logger';

export const POST = withApiHandler('withdraw', async (req: NextRequest) => {
  const body = await req.json();

  const userId    = requireUuid(body.userId, 'userId');
  const toAddress = requireField(body.toAddress, 'toAddress');
  const amount    = requireValidAmount(body.amount, 'amount', 100000);

  if (typeof toAddress !== 'string' || !isValidTonAddress(toAddress)) {
    throw new ApiError('Invalid TON address', 400);
  }

  const supabase = createServiceClient() as any;

  const { data: userRow } = await supabase.from('users').select('telegram_id').eq('id', userId).single();
  if (!userRow) throw new ApiError('User not found', 404);

  const rl = await checkRateLimit({ key: `withdraw:${userRow.telegram_id}`, ...RATE_LIMITS.withdrawal });
  if (!rl.allowed) {
    logger.warn('withdrawal_rate_limited', { userId, count: rl.count });
    tooManyRequests(rl.limit);
  }

  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_user_id: userId,
    p_to_address: toAddress,
    p_amount: amount,
  });

  if (error) {
    logger.error('withdrawal_request_db_error', { userId, message: error.message });
    throw new ApiError('Failed to queue withdrawal', 500);
  }

  const result = data as { success: boolean; error?: string; withdrawal_id?: string };
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  logger.info('withdrawal_requested', { userId, amount, toAddress: toAddress.slice(0, 10) });

  return NextResponse.json({
    success: true,
    withdrawalId: result.withdrawal_id,
    message: 'Withdrawal queued. It will be processed within a few minutes.',
  });
});
