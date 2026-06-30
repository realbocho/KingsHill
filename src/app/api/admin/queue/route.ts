/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const telegramId = req.nextUrl.searchParams.get('telegramId');
  if (!telegramId) return NextResponse.json({ error: 'Missing telegramId' }, { status: 400 });

  const supabase = createServiceClient() as any;

  const { data: admin } = await supabase
    .from('admins')
    .select('id')
    .eq('telegram_id', Number(telegramId))
    .single();
  if (!admin) return NextResponse.json({ error: 'Not an admin' }, { status: 403 });

  // All currently live ads (admin can remove any of them)
  const { data: liveOccupancies } = await supabase
    .from('occupancies')
    .select(`
      id, slot_id, bid_amount, ad_text, ad_url, ad_emoji, ad_color, expires_at, created_at,
      users(id, telegram_id, username, first_name),
      ad_slots(name, tier)
    `)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  // Pending user reports, joined with the occupancy + reporter
  const { data: pendingReports } = await supabase
    .from('reports')
    .select(`
      id, reason, status, created_at,
      occupancies(id, ad_text, ad_emoji, ad_color, is_active, users(username, first_name)),
      reporter:reporter_id(username, first_name)
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  return NextResponse.json({ liveOccupancies, pendingReports });
}
