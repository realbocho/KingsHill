'use client';

import { useState } from 'react';
import { useApp } from '@/lib/store';
import { isLikelyTonAddress } from '@/lib/telegram';

interface Props {
  onClose: () => void;
}

export function WithdrawModal({ onClose }: Props) {
  const { state, dispatch, refreshWallet, showToast } = useApp();
  const [toAddress, setToAddress] = useState('');
  const [amount,    setAmount]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  const balance = state.user?.wallet ?? 0;
  const amountNum = parseFloat(amount) || 0;
  const addressValid = isLikelyTonAddress(toAddress.trim());
  const isValid = addressValid && amountNum >= 0.5 && amountNum <= balance;

  async function submitWithdrawal() {
    if (!state.user || !isValid) return;
    setLoading(true);
    try {
      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: state.user.id, toAddress: toAddress.trim(), amount: amountNum }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error ?? 'Withdrawal failed', 'error');
      } else {
        showToast('Withdrawal queued — processed within a few minutes', 'success');
        dispatch({
          type: 'UPDATE_USER_WALLET',
          wallet: balance - amountNum,
          total_earned: state.user.total_earned,
          total_spent: state.user.total_spent,
        });
        await refreshWallet();
        onClose();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full bg-brand-card rounded-t-2xl border-t border-brand-border max-h-[90vh] overflow-y-auto">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-brand-border rounded-full" />
        </div>

        <div className="px-4 pb-6">
          <div className="flex items-start justify-between mb-4">
            <h2 className="font-bold text-lg text-brand-text">Withdraw TON</h2>
            <button onClick={onClose} className="text-brand-muted text-xl p-1">×</button>
          </div>

          {!confirmStep ? (
            <>
              <div className="mb-4">
                <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
                  Destination TON Address
                </label>
                <input
                  type="text"
                  value={toAddress}
                  onChange={e => setToAddress(e.target.value)}
                  placeholder="UQ... or EQ..."
                  className="w-full bg-brand-surface border border-brand-border focus:border-brand-gold/40 rounded-xl px-4 py-3 text-sm font-mono text-brand-text outline-none"
                />
                {toAddress.trim() && !addressValid && (
                  <p className="text-xs text-red-400 mt-1.5">This doesn't look like a valid TON address</p>
                )}
              </div>

              <div className="mb-4">
                <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
                  Amount (GRAM)
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  step="0.01"
                  min="0.5"
                  max={balance}
                  placeholder="0.50"
                  className="w-full bg-brand-surface border border-brand-border focus:border-brand-gold/40 rounded-xl px-4 py-3 text-lg font-bold font-mono text-brand-text outline-none"
                />
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-xs text-brand-muted">Min: 0.5 GRAM</p>
                  <p className="text-xs text-brand-muted">
                    Available: <span className="text-brand-gold font-mono">{balance.toFixed(4)} GRAM</span>
                  </p>
                </div>
                <button
                  onClick={() => setAmount(balance.toFixed(4))}
                  className="mt-2 text-xs px-3 py-1.5 bg-brand-surface border border-brand-border rounded-lg text-brand-muted"
                >
                  Max
                </button>
              </div>

              <div className="rounded-xl border border-brand-border bg-brand-surface p-3 mb-4 text-xs text-brand-muted leading-relaxed">
                Withdrawals are processed automatically within a few minutes. A small network fee is
                deducted on-chain by TON itself — the amount above is what leaves your GRAM balance,
                you may receive a slightly smaller amount in your wallet after network fees.
              </div>

              <button
                onClick={() => setConfirmStep(true)}
                disabled={!isValid}
                className="w-full py-4 rounded-xl font-bold text-base bg-brand-gold text-brand-dark disabled:bg-brand-surface disabled:text-brand-muted transition-all"
              >
                {!addressValid ? 'Enter Valid Address' : amountNum < 0.5 ? 'Minimum 0.5 GRAM' : amountNum > balance ? 'Insufficient Balance' : 'Continue'}
              </button>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 mb-4">
                <p className="text-sm font-bold text-red-300 mb-2">⚠️ Confirm Withdrawal</p>
                <p className="text-xs text-red-200/80 leading-relaxed mb-3">
                  This action is irreversible once processed. Double-check the address — funds sent
                  to the wrong address cannot be recovered.
                </p>
                <div className="bg-brand-card rounded-lg p-3 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-brand-muted">Amount</span>
                    <span className="text-brand-text font-mono font-bold">{amountNum.toFixed(4)} GRAM</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-brand-muted">To</span>
                    <span className="text-brand-text font-mono text-[10px] break-all text-right max-w-[200px]">{toAddress.trim()}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmStep(false)}
                  className="flex-1 py-3.5 rounded-xl text-sm font-medium bg-brand-surface text-brand-muted"
                >
                  Back
                </button>
                <button
                  onClick={submitWithdrawal}
                  disabled={loading}
                  className="flex-1 py-3.5 rounded-xl text-sm font-bold bg-red-600 text-white disabled:opacity-50"
                >
                  {loading ? 'Sending...' : 'Confirm Withdrawal'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
