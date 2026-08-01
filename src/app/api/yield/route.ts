/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } as const;

// Read-only: how much time-based slot yield the user can claim right now.
// Mirrors the DB function get_claimable_yield() so the UI can show a live
// "claimable" figure without trusting the client to do the math.
//
// This number changes every second and MUST be fetched fresh every call —
// explicit no-store headers so no CDN/browser cache ever serves a stale
// claimable amount right after the user hits Claim.
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400, headers: NO_STORE });

  const supabase = createServiceClient() as any;

  const { data, error } = await supabase.rpc('get_claimable_yield', { p_user_id: userId });

  if (error) {
    logger.error('get_claimable_yield_failed', { userId, message: error.message });
    // Yield display must never break the wallet screen — degrade to zero.
    return NextResponse.json({ claimable: 0, items: [] }, { headers: NO_STORE });
  }

  const result = data as { claimable?: number; items?: unknown[] };
  return NextResponse.json(
    {
      claimable: result?.claimable ?? 0,
      items: result?.items ?? [],
    },
    { headers: NO_STORE },
  );
}
