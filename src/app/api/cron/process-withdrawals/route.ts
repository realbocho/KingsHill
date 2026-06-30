/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { withApiHandler } from '@/lib/api-helpers';
import { requireCronSecret } from '@/lib/cron-auth';
import { sendTon, waitForSeqno, getMasterWalletBalance } from '@/lib/ton-wallet';
import { logger } from '@/lib/logger';
import { notifyWithdrawalProcessed } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * Intended trigger: cron-job.org, every 5 minutes, hitting
 *   GET https://your-app.vercel.app/api/cron/process-withdrawals?secret=YOUR_CRON_SECRET
 *
 * Processes a few pending withdrawals per invocation (TON wallets are
 * sequence-number based — sending two transfers concurrently from
 * the same wallet without coordinating seqno is how funds get stuck
 * or transfers get dropped, so we serialize processing within a run).
 */
export const GET = withApiHandler('cron-process-withdrawals', async (req: NextRequest) => {
  requireCronSecret(req);

  const supabase = createServiceClient() as any;

  const { data: pending } = await supabase
    .from('ton_withdrawals')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(5);

  if (!pending || pending.length === 0) {
    return NextResponse.json({ processed: 0, message: 'No pending withdrawals' });
  }

  // Sanity check the master wallet actually has enough TON before
  // attempting anything — fail loudly rather than send partial/garbled
  // transfers if the float is too low.
  let masterBalance: number;
  try {
    masterBalance = await getMasterWalletBalance();
  } catch (err) {
    logger.error('withdrawal_balance_check_failed', { error: String(err) });
    return NextResponse.json({ error: 'Could not verify master wallet balance' }, { status: 502 });
  }

  const totalRequested = pending.reduce((sum: number, w: any) => sum + Number(w.amount_ton), 0);
  if (masterBalance < totalRequested + 1) { // keep a 1 TON safety buffer for network fees
    logger.error('withdrawal_insufficient_float', { masterBalance, totalRequested });
    return NextResponse.json({
      error: 'Master wallet balance too low to process withdrawals safely',
      masterBalance,
      totalRequested,
    }, { status: 503 });
  }

  let processed = 0;
  let failed = 0;

  for (const wd of pending) {
    await supabase.from('ton_withdrawals').update({ status: 'processing' }).eq('id', wd.id);

    try {
      const { seqno } = await sendTon(wd.to_address, Number(wd.amount_ton), `KingsHill withdrawal ${wd.id.slice(0, 8)}`);
      const confirmed = await waitForSeqno(seqno, 45000);

      if (!confirmed) {
        // The tx may still land later — we don't auto-refund here to
        // avoid double-paying if it actually went through. Leave it
        // as 'processing' for manual review instead of guessing.
        logger.warn('withdrawal_confirmation_timeout', { withdrawalId: wd.id });
        continue;
      }

      await supabase.rpc('complete_withdrawal', { p_withdrawal_id: wd.id, p_tx_hash: `seqno:${seqno}` });
      processed++;
      logger.info('withdrawal_completed', { withdrawalId: wd.id, amountTon: wd.amount_ton });

      notifyWithdrawalProcessed(wd.user_id, Number(wd.amount_ton), null, 'completed').catch(err =>
        logger.error('notify_withdrawal_failed', { error: String(err) })
      );
    } catch (err) {
      failed++;
      const reason = err instanceof Error ? err.message : String(err);
      logger.error('withdrawal_send_failed', { withdrawalId: wd.id, error: reason });

      await supabase.rpc('fail_withdrawal', { p_withdrawal_id: wd.id, p_reason: reason });

      notifyWithdrawalProcessed(wd.user_id, Number(wd.amount_ton), null, 'failed').catch(e =>
        logger.error('notify_withdrawal_failed', { error: String(e) })
      );
    }
  }

  return NextResponse.json({ processed, failed, total: pending.length });
});
