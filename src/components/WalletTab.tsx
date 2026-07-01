'use client';

import { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { formatGramsShort } from '@/lib/telegram';
import { DepositModal } from '@/components/DepositModal';
import { WithdrawModal } from '@/components/WithdrawModal';
import clsx from 'clsx';

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TX_ICONS: Record<string, string> = {
  bid:    '⚔️',
  refund: '💰',
  reward: '🏆',
  topup:  '🎁',
  fee:    '📊',
};

const TX_COLORS: Record<string, string> = {
  bid:    'text-red-400',
  refund: 'text-green-400',
  reward: 'text-brand-gold',
  topup:  'text-blue-400',
  fee:    'text-brand-muted',
};

export function WalletTab() {
  const { state, refreshWallet } = useApp();
  const { user, walletTxs } = state;

  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  const earned = user?.total_earned ?? 0;
  const spent  = user?.total_spent  ?? 0;
  const roi    = spent > 0 ? ((earned / spent) * 100).toFixed(1) : '—';

  const totalBalance        = user?.wallet ?? 0;
  const withdrawableBalance = user?.withdrawable_balance ?? 0;
  const bonusBalance        = Math.max(0, totalBalance - withdrawableBalance);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="m-3 rounded-2xl overflow-hidden" style={{
        background: 'linear-gradient(135deg, #1A1A10, #2A2000)',
        border: '1px solid rgba(255,215,0,0.2)',
      }}>
        <div className="p-4">
          <p className="text-xs text-brand-muted uppercase tracking-widest mb-1">Total Balance</p>
          <div className="flex items-end gap-2">
            <span className="text-4xl font-bold gold-shimmer">{formatGramsShort(totalBalance)}</span>
            <span className="text-brand-gold/60 text-lg mb-1 font-mono">GRAM</span>
          </div>
          <p className="text-xs text-brand-muted mt-1">GRAM is TON. Your influence currency.</p>

          {bonusBalance > 0.0001 && (
            <div className="mt-3 pt-3 border-t border-brand-gold/10 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-brand-muted">
                  <span className="text-green-400 font-mono font-bold">{withdrawableBalance.toFixed(4)}</span> withdrawable
                  {' · '}
                  <span className="text-yellow-400 font-mono font-bold">{bonusBalance.toFixed(4)}</span> bonus (spend-only)
                </span>
              </div>
              <p className="text-[10px] text-yellow-200/60 leading-relaxed">
                ⚠️ The 7 GRAM bonus can be used for bidding but cannot be withdrawn. Only real TON deposits and auction profits are withdrawable.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 divide-x divide-brand-gold/10 border-t border-brand-gold/10">
          {[
            { label: 'Earned',  value: `${formatGramsShort(earned)} GRAM`,  color: 'text-green-400' },
            { label: 'Spent',   value: `${formatGramsShort(spent)} GRAM`,   color: 'text-red-400' },
            { label: 'ROI',     value: `${roi}%`,                           color: 'text-brand-gold' },
          ].map(({ label, value, color }) => (
            <div key={label} className="py-3 text-center">
              <p className="text-[10px] text-brand-muted uppercase">{label}</p>
              <p className={clsx('text-sm font-bold font-mono', color)}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-3 mb-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => setShowDeposit(true)}
          className="py-3.5 rounded-xl font-bold text-sm bg-brand-gold text-brand-dark flex items-center justify-center gap-1.5"
        >
          ⬇ Deposit
        </button>
        <button
          onClick={() => setShowWithdraw(true)}
          className="py-3.5 rounded-xl font-bold text-sm bg-brand-surface border border-brand-border text-brand-text flex items-center justify-center gap-1.5"
        >
          ⬆ Withdraw
        </button>
      </div>

      <div className="mx-3 mb-3 rounded-xl border border-brand-border bg-brand-surface p-3">
        <p className="text-xs text-brand-muted leading-relaxed">
          GRAM is what your TON balance is called inside KingsHill. Deposit TON to top up your
          balance, or withdraw your GRAM back to any TON wallet at any time — it's the same coin.
        </p>
      </div>

      <div className="px-3 pb-3">
        <p className="text-xs font-bold text-brand-muted uppercase tracking-wider mb-2">
          Transaction History
        </p>

        {walletTxs.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-3xl mb-2">💳</p>
            <p className="text-sm text-brand-muted">No transactions yet</p>
            <p className="text-xs text-brand-muted mt-1">Place your first bid to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {walletTxs.map(tx => (
              <div key={tx.id} className="flex items-center gap-3 p-3 rounded-xl bg-brand-surface border border-brand-border">
                <div className="w-9 h-9 rounded-full bg-brand-card flex items-center justify-center text-base flex-shrink-0">
                  {TX_ICONS[tx.type] ?? '📋'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-brand-text leading-tight truncate">
                    {tx.description ?? tx.type}
                  </p>
                  <p className="text-[10px] text-brand-muted mt-0.5">
                    {timeAgo(tx.created_at)} · Balance: {formatGramsShort(tx.balance_after)} GRAM
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={clsx('text-sm font-bold font-mono', tx.amount >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {tx.amount >= 0 ? '+' : ''}{formatGramsShort(tx.amount)} GRAM
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showDeposit  && <DepositModal  onClose={() => setShowDeposit(false)} />}
      {showWithdraw && <WithdrawModal onClose={() => setShowWithdraw(false)} />}
    </div>
  );
}
