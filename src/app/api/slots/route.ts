/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/**
 * Throttled expiry sweep.
 *
 * expire_occupancies() used to run on every request here and was removed
 * to save a round-trip on the hottest endpoint. The problem is that the
 * cleanup cron then became the *only* caller, and there is no Vercel
 * cron — so if the external cron-job.org job is missing, paused, or
 * sending a stale secret, is_active never flips and ads never come down.
 *
 * Running it at most once a minute per warm instance keeps the sweep
 * alive without putting an RPC in front of every board read, which is
 * what the original removal was actually trying to avoid.
 */
let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 60_000;

async function sweepIfDue(supabase: any) {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  const { data, error } = await supabase.rpc('expire_occupancies');
  if (error) {
    // Never fail the board read because the sweep failed — the query
    // below filters expired rows out regardless. Just make it visible.
    logger.error('expire_occupancies_failed', { message: error.message });
    return;
  }
  if (data) logger.info('occupancies_expired', { count: data });
}

export async function GET() {
  try {
    const supabase = createServiceClient() as any;

    await sweepIfDue(supabase);

    const { data: allSlots } = await supabase
      .from('ad_slots')
      .select('*')
      .eq('is_retired', false)
      .order('position');

    // Expiry is filtered here as well as swept above. The sweep is
    // throttled and can fail; this predicate cannot, so an occupancy
    // whose time has run out is never shown as live and never counts
    // toward min_bid, even if is_active is still stale in the table.
    const { data: activeOccs } = await supabase
      .from('occupancies')
      .select('id, slot_id, user_id, bid_amount, ad_text, ad_url, ad_emoji, ad_color, ad_image_path, expires_at, is_active, created_at, removed_by_admin')
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString());

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
