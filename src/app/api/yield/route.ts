/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Read-only: how much time-based slot yield the user can claim right now.
// Mirrors the DB function get_claimable_yield() so the UI can show a live
// "claimable" figure without trusting the client to do the math.
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

  const supabase = createServiceClient() as any;

  const { data, error } = await supabase.rpc('get_claimable_yield', { p_user_id: userId });

  if (error) {
    logger.error('get_claimable_yield_failed', { userId, message: error.message });
    // Yield display must never break the wallet screen — degrade to zero.
    return NextResponse.json({ claimable: 0, items: [] });
  }

  const result = data as { claimable?: number; items?: unknown[] };
  return NextResponse.json({
    claimable: result?.claimable ?? 0,
    items: result?.items ?? [],
  });
}
