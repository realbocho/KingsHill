import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

  const supabase = createServiceClient();

  const [{ data: txs }, { data: user }] = await Promise.all([
    supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('users')
      .select('wallet, total_earned, total_spent')
      .eq('id', userId)
      .single(),
  ]);

  return NextResponse.json({ transactions: txs, user });
}
