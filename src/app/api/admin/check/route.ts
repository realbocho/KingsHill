/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const telegramId = req.nextUrl.searchParams.get('telegramId');
  if (!telegramId) return NextResponse.json({ isAdmin: false });

  const supabase = createServiceClient() as any;
  const { data } = await supabase
    .from('admins')
    .select('id, label')
    .eq('telegram_id', Number(telegramId))
    .single();

  return NextResponse.json({ isAdmin: !!data, label: data?.label ?? null });
}
