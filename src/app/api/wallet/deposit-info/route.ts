/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler, requireUuid, ApiError } from '@/lib/api-helpers';
import { getMasterWalletAddress } from '@/lib/ton-wallet';

export const dynamic = 'force-dynamic';

export const GET = withApiHandler('deposit-info', async (req: NextRequest) => {
  const userId = requireUuid(req.nextUrl.searchParams.get('userId'), 'userId');

  const supabase = createServiceClient() as any;

  const { data: memoResult, error } = await supabase.rpc('ensure_deposit_memo', { p_user_id: userId });
  if (error) throw new ApiError('Failed to generate deposit memo', 500);

  let masterAddress: string;
  try {
    masterAddress = await getMasterWalletAddress();
  } catch {
    throw new ApiError('Deposits are temporarily unavailable. Please try again later.', 503);
  }

  return NextResponse.json({
    depositAddress: masterAddress,
    memo: memoResult as string,
    instructions: 'Send TON to this address with the memo as the comment/message. Credited automatically within a few minutes.',
  });
});
