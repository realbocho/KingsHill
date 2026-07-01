/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = createServiceClient() as any;

    const { data: allSlots } = await supabase
      .from('ad_slots')
      .select('*')
      .order('position');

    const { data: activeOccs } = await supabase
      .from('occupancies')
      .select('id, slot_id, user_id, bid_amount, ad_text, ad_url, ad_emoji, ad_color, ad_image_path, expires_at, is_active, created_at, removed_by_admin')
      .eq('is_active', true);

    // Fetch users separately to avoid the nested join silently dropping
    // occupancy rows when the joined users select hits an RLS boundary.
    const userIds = [...new Set((activeOccs ?? []).map((o: any) => o.user_id).filter(Boolean))];
    const usersById: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: userRows } = await supabase
        .from('users')
        .select('id, telegram_id, username, first_name, photo_url')
        .in('id', userIds);
      for (const u of userRows ?? []) {
        usersById[u.id] = u;
      }
    }

    const occBySlot: Record<string, any> = {};
    if (activeOccs) {
      for (const occ of activeOccs as any[]) {
        occBySlot[occ.slot_id] = {
          ...occ,
          users: usersById[occ.user_id] ?? null,
        };
      }
    }

    const enriched = (allSlots ?? []).map((slot: any) => {
      const occ = occBySlot[slot.id] ?? null;
      const minBid = occ
        ? Number(occ.bid_amount) * (1 + slot.min_increment_pct / 100)
        : slot.base_price;
      return {
        ...slot,
        current_occupancy: occ,
        min_bid: Math.round(minBid * 10000) / 10000,
      };
    });

    return NextResponse.json(
      { slots: enriched },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 });
  }
}
