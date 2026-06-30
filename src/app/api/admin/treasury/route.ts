/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler, requireField, requireValidAmount, ApiError } from '@/lib/api-helpers';
import { isValidTonAddress } from '@/lib/ton-wallet';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * The platform fee account is a reserved system user (telegram_id = -1,
 * created by migration 008) that actually receives every platform_fee
 * credited during place_bid(). This endpoint lets an admin check that
 * balance and withdraw it through the normal withdrawal flow — same
 * custody wallet, same TON send logic, just gated to admins only.
 */

async function requireAdmin(supabase: any, telegramId: unknown) {
  const { data: admin } = await supabase
    .from('admins')
    .select('id')
    .eq('telegram_id', Number(telegramId))
    .single();
  if (!admin) throw new ApiError('Not an admin', 403);
}

export const GET = withApiHandler('admin-treasury-balance', async (req: NextRequest) => {
  const telegramId = req.nextUrl.searchParams.get('telegramId');
  if (!telegramId) throw new ApiError('Missing telegramId', 400);

  const supabase = createServiceClient() as any;
  await requireAdmin(supabase, telegramId);

  const { data: treasury } = await supabase
    .from('users')
    .select('id, wallet')
    .eq('telegram_id', -1)
    .single();

  if (!treasury) throw new ApiError('Treasury account not found — run migration 008', 500);

  const { data: recentFees } = await supabase
    .from('wallet_transactions')
    .select('amount, description, created_at')
    .eq('user_id', treasury.id)
    .eq('type', 'fee')
    .order('created_at', { ascending: false })
    .limit(20);

  return NextResponse.json({ balance: treasury.wallet, recentFees: recentFees ?? [] });
});

export const POST = withApiHandler('admin-treasury-withdraw', async (req: NextRequest) => {
  const body = await req.json();
  const telegramId = requireField(body.telegramId, 'telegramId');
  const toAddress   = requireField(body.toAddress, 'toAddress');
  const amount      = requireValidAmount(body.amount, 'amount', 100000);

  if (typeof toAddress !== 'string' || !isValidTonAddress(toAddress)) {
    throw new ApiError('Invalid TON address', 400);
  }

  const supabase = createServiceClient() as any;
  await requireAdmin(supabase, telegramId);

  const { data: treasury } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', -1)
    .single();

  if (!treasury) throw new ApiError('Treasury account not found', 500);

  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_user_id: treasury.id,
    p_to_address: toAddress,
    p_amount: amount,
  });

  if (error) {
    logger.error('treasury_withdrawal_db_error', { message: error.message });
    throw new ApiError('Failed to queue treasury withdrawal', 500);
  }

  const result = data as { success: boolean; error?: string; withdrawal_id?: string };
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  logger.info('treasury_withdrawal_requested', { adminTelegramId: telegramId, amount, toAddress: toAddress.slice(0, 10) });

  return NextResponse.json({
    success: true,
    withdrawalId: result.withdrawal_id,
    message: 'Treasury withdrawal queued. It will be processed by the next cron run.',
  });
});
