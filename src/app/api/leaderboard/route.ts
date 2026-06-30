import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServiceClient();

  const [{ data: topEarners }, { data: topSpenders }, { data: stats }, { data: recentBids }] = await Promise.all([
    supabase
      .from('users')
      .select('id, telegram_id, username, first_name, photo_url, total_earned, wallet')
      .order('total_earned', { ascending: false })
      .limit(10),
    supabase
      .from('users')
      .select('id, telegram_id, username, first_name, photo_url, total_spent')
      .order('total_spent', { ascending: false })
      .limit(10),
    supabase.from('platform_stats').select('*').single(),
    supabase
      .from('bid_history')
      .select(`
        id, bid_amount, premium_paid, ad_text, ad_emoji, ad_color, created_at,
        users!bid_history_bidder_id_fkey(username, first_name),
        ad_slots(name, tier)
      `)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({ topEarners, topSpenders, stats, recentBids });
}
