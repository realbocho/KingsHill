/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler } from '@/lib/api-helpers';
import { requireCronSecret } from '@/lib/cron-auth';
import { fetchIncomingTransactions } from '@/lib/ton-wallet';
import { logger } from '@/lib/logger';
import { notifyDepositCredited } from '@/lib/notify';

// Free GRAM bonuses are currently DISABLED — set this back to 0.1 (10%)
// to resume paying referrers a cut of their friend's first deposit.
// Referral LINKING (referred_by, first_deposit_done) is still tracked
// either way; this only controls whether it pays out.
const REFERRAL_BONUS_RATE = 0;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = withApiHandler('cron-scan-deposits', async (req: NextRequest) => {
  requireCronSecret(req);

  const supabase = createServiceClient() as any;

  let incoming;
  try {
    incoming = await fetchIncomingTransactions(50);
  } catch (err) {
    logger.error('deposit_scan_fetch_failed', { error: String(err) });
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 502 });
  }

  let credited = 0;
  let unmatched = 0;
  let skipped = 0;

  for (const tx of incoming) {
    const { data: existing } = await supabase
      .from('ton_deposits')
      .select('id')
      .eq('tx_hash', tx.hash)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    const amountTon = Number(tx.amountNanoTon) / 1e9;

    let matchedUserId: string | null = null;
    if (tx.memo) {
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('deposit_memo', tx.memo.trim())
        .maybeSingle();
      matchedUserId = user?.id ?? null;
    }

    const { data: depositRow, error: insertError } = await supabase
      .from('ton_deposits')
      .insert({
        user_id:        matchedUserId,
        tx_hash:        tx.hash,
        tx_lt:          tx.lt,
        from_address:   tx.fromAddress,
        amount_nanoton: tx.amountNanoTon,
        amount_ton:     amountTon,
        memo:           tx.memo,
        status:         matchedUserId ? 'pending' : 'unmatched',
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        logger.debug('deposit_already_recorded', { hash: tx.hash });
        skipped++;
      } else {
        logger.error('deposit_insert_failed', { hash: tx.hash, error: insertError.message });
      }
      continue;
    }

    if (matchedUserId) {
      const { data: creditResult, error: creditError } = await supabase.rpc('credit_deposit', {
        p_deposit_id: depositRow.id,
      });

      if (creditError || !(creditResult as any)?.success) {
        logger.error('deposit_credit_failed', { depositId: depositRow.id, error: creditError?.message ?? (creditResult as any)?.error });
        continue;
      }

      credited++;
      logger.info('deposit_credited', { userId: matchedUserId, amountTon, txHash: tx.hash });

      // Referral bonus on first deposit: REFERRAL_BONUS_RATE of deposit
      // (spend-only) to referrer. Currently 0 = disabled; linking/tracking
      // (first_deposit_done) still happens regardless so the data isn't lost.
      const { data: depositor } = await supabase
        .from('users')
        .select('referred_by, first_deposit_done')
        .eq('id', matchedUserId)
        .single();

      if (depositor && !depositor.first_deposit_done && depositor.referred_by) {
        await supabase.from('users').update({ first_deposit_done: true }).eq('id', matchedUserId);

        const referralBonus = Math.round(amountTon * REFERRAL_BONUS_RATE * 10000) / 10000;

        if (referralBonus > 0) {
          const { data: referrer } = await supabase
            .from('users')
            .select('wallet, total_bonus_received')
            .eq('id', depositor.referred_by)
            .eq('is_bot', false)
            .single();

          if (referrer) {
            await supabase.from('users').update({
              wallet:               referrer.wallet + referralBonus,
              total_bonus_received: referrer.total_bonus_received + referralBonus,
            }).eq('id', depositor.referred_by);

            await supabase.from('wallet_transactions').insert({
              user_id:       depositor.referred_by,
              type:          'reward',
              amount:        referralBonus,
              balance_after: referrer.wallet + referralBonus,
              description:   `Referral bonus — friend deposited ${amountTon} TON`,
            });

            logger.info('referral_deposit_bonus', { referrerId: depositor.referred_by, bonus: referralBonus });
          }
        }
      }

      notifyDepositCredited(matchedUserId, amountTon).catch(err =>
        logger.error('notify_deposit_failed', { error: String(err) })
      );
    } else {
      unmatched++;
      logger.warn('deposit_unmatched', { txHash: tx.hash, memo: tx.memo, amountTon });
    }
  }

  return NextResponse.json({ scanned: incoming.length, credited, unmatched, skipped });
});
