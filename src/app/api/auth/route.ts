/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { validateInitData } from '@/lib/telegram';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler, ApiError } from '@/lib/api-helpers';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const POST = withApiHandler('auth', async (req: NextRequest) => {
  const { initData } = await req.json();
  if (!initData || typeof initData !== 'string') {
    throw new ApiError('Missing initData', 400);
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';

  let tgUser: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string } | undefined;
  let startParam: string | null = null;

  if (process.env.NODE_ENV === 'development' && initData === 'dev') {
    tgUser = { id: 123456789, first_name: 'Dev', last_name: 'User', username: 'devuser' };
  } else {
    const tgData = validateInitData(initData, botToken);
    if (!tgData?.user) {
      throw new ApiError('Invalid Telegram data', 401);
    }
    tgUser = tgData.user;
    startParam = tgData.start_param ?? null;
  }

  const rl = await checkRateLimit({ key: `auth:${tgUser.id}`, ...RATE_LIMITS.auth });
  if (!rl.allowed) {
    logger.warn('auth_rate_limited', { telegramId: tgUser.id, count: rl.count });
    throw new ApiError('Too many requests. Please slow down.', 429);
  }

  const supabase = createServiceClient();
  const client = supabase as any;

  const { data: existingUser } = await client
    .from('users')
    .select('*')
    .eq('telegram_id', tgUser.id)
    .single();

  let userData;
  if (existingUser) {
    const { data: updated } = await client
      .from('users')
      .update({
        username:   tgUser.username   ?? existingUser.username,
        first_name: tgUser.first_name ?? existingUser.first_name,
        last_name:  tgUser.last_name  ?? existingUser.last_name,
        photo_url:  tgUser.photo_url  ?? existingUser.photo_url,
        updated_at: new Date().toISOString(),
      })
      .eq('telegram_id', tgUser.id)
      .select()
      .single();
    userData = updated ?? existingUser;
  } else {
    const { data: newUser, error: insertError } = await client
      .from('users')
      .insert({
        telegram_id: tgUser.id,
        username:    tgUser.username   ?? null,
        first_name:  tgUser.first_name ?? null,
        last_name:   tgUser.last_name  ?? null,
        photo_url:   tgUser.photo_url  ?? null,
        wallet:      7.0,
      })
      .select()
      .single();

    if (insertError) {
      logger.error('auth_user_create_failed', { telegramId: tgUser.id, message: insertError.message });
      throw new ApiError('Failed to create user', 500);
    }

    userData = newUser;
    logger.info('user_created', { telegramId: tgUser.id, userId: newUser.id });

    if (newUser) {
      await client.from('wallet_transactions').insert({
        user_id:       newUser.id,
        type:          'topup',
        amount:        7.0,
        balance_after: 7.0,
        description:   'Welcome bonus — 7 GRAM to get you started!',
      });

      if (startParam?.startsWith('ref_')) {
        const referrerTelegramId = parseInt(startParam.slice(4), 10);
        if (!isNaN(referrerTelegramId) && referrerTelegramId !== tgUser.id) {
          const { data: referrer } = await client
            .from('users')
            .select('id')
            .eq('telegram_id', referrerTelegramId)
            .eq('is_bot', false)
            .single();

          if (referrer) {
            await client
              .from('users')
              .update({ referred_by: referrer.id })
              .eq('id', newUser.id);

            logger.info('referral_linked', { newUserId: newUser.id, referrerId: referrer.id });
          }
        }
      }

    }
  }

  return NextResponse.json({ user: userData });
});
