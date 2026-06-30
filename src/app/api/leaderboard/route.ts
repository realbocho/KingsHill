/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Reserved system account (created in migration 008) that holds
// platform fee revenue. It lives in the `users` table so it can reuse
// the normal wallet/withdrawal machinery, but it isn't a real player
// and must never appear in player-facing rankings or activity feeds.
const TREASURY_TELEGRAM_ID = -1;

export async function GET() {
  const supabase = createServiceClient();

  const [{ data: topEarners }, { data: topSpenders }, { data: stats }, { data: recentBids }] = await Promise.all([
    supabase
      .from('users')
      .select('id, telegram_id, username, first_name, photo_url, total_earned, wallet')
      .neq('telegram_id', TREASURY_TELEGRAM_ID)
      .order('total_earned', { ascending: false })
      .limit(10),
    supabase
      .from('users')
      .select('id, telegram_id, username, first_name, photo_url, total_spent')
      .neq('telegram_id', TREASURY_TELEGRAM_ID)
      .order('total_spent', { ascending: false })
      .limit(10),
    supabase.from('platform_stats').select('*').single(),
    supabase
      .from('bid_history')
      .select(`
        id, bid_amount, premium_paid, ad_text, ad_emoji, ad_color, created_at,
        users!bid_history_bidder_id_fkey(username, first_name, telegram_id),
        ad_slots(name, tier)
      `)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  // bid_history can't easily filter the joined user's telegram_id in
  // the query above without a second round trip, so filter client-side
  // here — the treasury account is never the bidder on a real auction
  // anyway, but this keeps the feed clean even if that ever changes.
  const filteredRecentBids = (recentBids ?? []).filter(
    (b: any) => b.users?.telegram_id !== TREASURY_TELEGRAM_ID
  );

  return NextResponse.json({ topEarners, topSpenders, stats, recentBids: filteredRecentBids });
}
