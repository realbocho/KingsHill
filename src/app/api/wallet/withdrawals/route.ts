/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler, requireUuid } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export const GET = withApiHandler('withdrawals-list', async (req: NextRequest) => {
  const userId = requireUuid(req.nextUrl.searchParams.get('userId'), 'userId');
  const supabase = createServiceClient() as any;

  const [{ data: withdrawals }, { data: deposits }] = await Promise.all([
    supabase
      .from('ton_withdrawals')
      .select('id, to_address, amount_gram, status, tx_hash, failure_reason, requested_at, processed_at')
      .eq('user_id', userId)
      .order('requested_at', { ascending: false })
      .limit(20),
    supabase
      .from('ton_deposits')
      .select('id, amount_ton, status, tx_hash, credited_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({ withdrawals: withdrawals ?? [], deposits: deposits ?? [] });
});
