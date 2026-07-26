/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler, requireUuid, tooManyRequests, ApiError } from '@/lib/api-helpers';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

// Claim accrued slot yield into the user's withdrawable balance.
// The heavy lifting (idempotency, per-occupancy high-water marks,
// crediting wallet + withdrawable_balance) all happens inside the
// claim_yield() SQL function so it's atomic.
export const POST = withApiHandler('yield-claim', async (req: NextRequest) => {
  const body   = await req.json();
  const userId = requireUuid(body.userId, 'userId');

  const supabase = createServiceClient() as any;

  const { data: userRow } = await supabase.from('users').select('telegram_id').eq('id', userId).single();
  if (!userRow) throw new ApiError('User not found', 404);

  // Reuse the bid limiter shape — claiming is cheap but shouldn't be spammable.
  const rl = await checkRateLimit({ key: `yield:${userRow.telegram_id}`, ...RATE_LIMITS.bid });
  if (!rl.allowed) {
    logger.warn('yield_claim_rate_limited', { userId, count: rl.count });
    tooManyRequests(rl.limit);
  }

  const { data, error } = await supabase.rpc('claim_yield', { p_user_id: userId });
  if (error) {
    logger.error('claim_yield_db_error', { userId, message: error.message });
    throw new ApiError('Failed to claim yield', 500);
  }

  const result = data as { success: boolean; error?: string; claimed?: number };
  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Claim failed' }, { status: 400 });
  }

  logger.info('yield_claimed', { userId, claimed: result.claimed });

  const { data: user } = await supabase
    .from('users')
    .select('wallet, withdrawable_balance, total_earned, total_spent')
    .eq('id', userId)
    .single();

  return NextResponse.json({
    success: true,
    claimed: result.claimed ?? 0,
    user,
    message:
      (result.claimed ?? 0) > 0
        ? `Claimed ${(result.claimed ?? 0).toFixed(4)} TON — added to your withdrawable balance.`
        : 'No yield to claim yet.',
  });
});
