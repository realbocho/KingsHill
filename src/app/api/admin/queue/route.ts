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

  const { data: liveOccsRaw } = await supabase
    .from('occupancies')
    .select('id, slot_id, user_id, bid_amount, ad_text, ad_url, ad_emoji, ad_color, expires_at, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  const { data: allSlots } = await supabase
    .from('ad_slots')
    .select('id, name, tier');

  const slotsById: Record<string, any> = {};
  for (const s of allSlots ?? []) slotsById[s.id] = s;

  const liveUserIds = [...new Set((liveOccsRaw ?? []).map((o: any) => o.user_id).filter(Boolean))];
  const liveUsersById: Record<string, any> = {};
  if (liveUserIds.length > 0) {
    const { data: liveUsers } = await supabase
      .from('users')
      .select('id, telegram_id, username, first_name')
      .in('id', liveUserIds);
    for (const u of liveUsers ?? []) liveUsersById[u.id] = u;
  }

  const liveOccupancies = (liveOccsRaw ?? []).map((o: any) => ({
    ...o,
    users: liveUsersById[o.user_id] ?? null,
    ad_slots: slotsById[o.slot_id] ?? null,
  }));

  const { data: reportsRaw } = await supabase
    .from('reports')
    .select('id, reason, status, created_at, occupancy_id, reporter_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  const reportOccIds = [...new Set((reportsRaw ?? []).map((r: any) => r.occupancy_id).filter(Boolean))];
  const reportOccsById: Record<string, any> = {};
  if (reportOccIds.length > 0) {
    const { data: reportOccs } = await supabase
      .from('occupancies')
      .select('id, ad_text, ad_emoji, ad_color, is_active, user_id')
      .in('id', reportOccIds);

    const occUserIds = [...new Set((reportOccs ?? []).map((o: any) => o.user_id).filter(Boolean))];
    const occUsersById: Record<string, any> = {};
    if (occUserIds.length > 0) {
      const { data: occUsers } = await supabase
        .from('users')
        .select('id, username, first_name')
        .in('id', occUserIds);
      for (const u of occUsers ?? []) occUsersById[u.id] = u;
    }

    for (const o of reportOccs ?? []) {
      reportOccsById[o.id] = { ...o, users: occUsersById[o.user_id] ?? null };
    }
  }

  const reporterIds = [...new Set((reportsRaw ?? []).map((r: any) => r.reporter_id).filter(Boolean))];
  const reportersById: Record<string, any> = {};
  if (reporterIds.length > 0) {
    const { data: reporters } = await supabase
      .from('users')
      .select('id, username, first_name')
      .in('id', reporterIds);
    for (const u of reporters ?? []) reportersById[u.id] = u;
  }

  const pendingReports = (reportsRaw ?? []).map((r: any) => ({
    ...r,
    occupancies: reportOccsById[r.occupancy_id] ?? null,
    reporter: reportersById[r.reporter_id] ?? null,
  }));

  return NextResponse.json({ liveOccupancies, pendingReports });
}
