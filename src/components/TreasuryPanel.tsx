'use client';

import { useEffect, useState, useCallback } from 'react';
import { useApp } from '@/lib/store';
import { formatGramsShort, timeAgo, isLikelyTonAddress } from '@/lib/telegram';

interface FeeEntry {
  amount: number;
  description: string | null;
  created_at: string;
}

export function TreasuryPanel() {
  const { state, showToast } = useApp();
  const [balance, setBalance] = useState<number | null>(null);
  const [recentFees, setRecentFees] = useState<FeeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  const load = useCallback(async () => {
    if (!state.user) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/treasury?telegramId=${state.user.telegram_id}`);
      const data = await res.json();
      if (res.ok) {
        setBalance(data.balance);
        setRecentFees(data.recentFees ?? []);
      } else {
        showToast(data.error ?? 'Failed to load treasury', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [state.user, showToast]);

  useEffect(() => { load(); }, [load]);

  const amountNum = parseFloat(amount) || 0;
  const addressValid = isLikelyTonAddress(toAddress.trim());
  const isValid = addressValid && amountNum >= 0.5 && balance !== null && amountNum <= balance;

  async function submitWithdraw() {
    if (!state.user || !isValid) return;
    setWithdrawing(true);
    try {
      const res = await fetch('/api/admin/treasury', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: state.user.telegram_id,
          toAddress: toAddress.trim(),
          amount: amountNum,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? 'Withdrawal failed', 'error');
      } else {
        showToast('Treasury withdrawal queued', 'success');
        setToAddress('');
        setAmount('');
        await load();
      }
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-brand-gold/30 bg-gradient-to-br from-yellow-950/30 to-transparent p-4">
        <p className="text-xs text-brand-muted uppercase tracking-widest mb-1">Platform Treasury</p>
        {loading ? (
          <div className="h-9 w-32 bg-brand-surface rounded animate-pulse" />
        ) : (
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-brand-gold">{balance !== null ? formatGramsShort(balance) : '—'}</span>
            <span className="text-brand-gold/60 text-sm mb-1 font-mono">GRAM</span>
          </div>
        )}
        <p className="text-[11px] text-brand-muted mt-1">
          Accumulated from platform fees (20% of displacement premiums, 5% on fresh slot claims). Real TON, withdrawable any time.
        </p>
      </div>

      <div className="rounded-xl border border-brand-border bg-brand-surface p-3">
        <p className="text-xs font-bold text-brand-muted uppercase tracking-wider mb-2">Withdraw to TON Address</p>
        <input
          type="text"
          value={toAddress}
          onChange={e => setToAddress(e.target.value)}
          placeholder="UQ... or EQ..."
          className="w-full bg-brand-card border border-brand-border focus:border-brand-gold/40 rounded-lg px-3 py-2.5 text-xs font-mono text-brand-text outline-none mb-2"
        />
        <div className="flex gap-2 mb-2">
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            step="0.01"
            min="0.5"
            placeholder="Amount"
            className="flex-1 bg-brand-card border border-brand-border focus:border-brand-gold/40 rounded-lg px-3 py-2.5 text-sm font-mono text-brand-text outline-none"
          />
          <button
            onClick={() => balance !== null && setAmount(balance.toFixed(4))}
            className="px-3 text-xs bg-brand-card border border-brand-border rounded-lg text-brand-muted"
          >
            Max
          </button>
        </div>
        <button
          onClick={submitWithdraw}
          disabled={!isValid || withdrawing}
          className="w-full py-2.5 rounded-lg text-sm font-bold bg-brand-gold text-brand-dark disabled:bg-brand-card disabled:text-brand-muted"
        >
          {withdrawing ? 'Sending...' : !addressValid ? 'Enter Valid Address' : amountNum < 0.5 ? 'Min 0.5 GRAM' : balance !== null && amountNum > balance ? 'Exceeds Balance' : 'Withdraw'}
        </button>
      </div>

      <div>
        <p className="text-xs font-bold text-brand-muted uppercase tracking-wider mb-2">Recent Fee Credits</p>
        {recentFees.length === 0 ? (
          <p className="text-xs text-brand-muted text-center py-4">No fees collected yet</p>
        ) : (
          <div className="space-y-1.5">
            {recentFees.map((f, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-brand-surface border border-brand-border text-xs">
                <span className="text-brand-muted truncate flex-1">{f.description}</span>
                <span className="text-brand-gold font-mono font-bold ml-2">+{formatGramsShort(f.amount)}</span>
                <span className="text-brand-muted ml-2 flex-shrink-0">{timeAgo(f.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
