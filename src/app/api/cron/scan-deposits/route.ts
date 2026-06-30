/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler } from '@/lib/api-helpers';
import { requireCronSecret } from '@/lib/cron-auth';
import { fetchIncomingTransactions } from '@/lib/ton-wallet';
import { logger } from '@/lib/logger';
import { notifyDepositCredited } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Intended trigger: cron-job.org, every 2-5 minutes, hitting
 *   GET https://your-app.vercel.app/api/cron/scan-deposits?secret=YOUR_CRON_SECRET
 *
 * For each incoming transaction to the master wallet:
 *   1. Skip if we've already recorded this tx_hash (idempotent).
 *   2. Try to match the transfer comment against a user's deposit_memo.
 *   3. If matched, credit_deposit() tops up their GRAM balance.
 *   4. If unmatched, the deposit is recorded as 'unmatched' so an
 *      admin can manually reconcile it (e.g. user forgot the memo).
 */
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

    if (existing) {
      skipped++;
      continue;
    }

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
      logger.error('deposit_insert_failed', { hash: tx.hash, error: insertError.message });
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
