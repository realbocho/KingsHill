/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServiceClient() as any;

    // Expire old occupancies first
    await supabase.rpc('expire_occupancies');

    const { data: allSlots } = await supabase
      .from('ad_slots')
      .select('*')
      .order('position');

    const { data: activeOccs } = await supabase
      .from('occupancies')
      .select(`
        id, slot_id, user_id, bid_amount, ad_text, ad_url, ad_emoji, ad_color, expires_at, is_active, created_at, removed_by_admin,
        users(id, telegram_id, username, first_name, photo_url)
      `)
      .eq('is_active', true);

    const occBySlot: Record<string, any> = {};
    if (activeOccs) {
      for (const occ of activeOccs as any[]) {
        occBySlot[occ.slot_id] = occ;
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

    return NextResponse.json({
      slots: enriched,
      _debug_supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 });
  }
}
