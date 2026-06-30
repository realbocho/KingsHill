'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';

interface Props {
  onClose: () => void;
}

export function DepositModal({ onClose }: Props) {
  const { state, showToast } = useApp();
  const [info, setInfo] = useState<{ depositAddress: string; memo: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.user) return;
    fetch(`/api/wallet/deposit-info?userId=${state.user.id}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? 'Failed to load deposit info');
        setInfo(data);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [state.user]);

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => showToast(`${label} copied`, 'success'));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full bg-brand-card rounded-t-2xl border-t border-brand-border max-h-[90vh] overflow-y-auto">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-brand-border rounded-full" />
        </div>

        <div className="px-4 pb-6">
          <div className="flex items-start justify-between mb-4">
            <h2 className="font-bold text-lg text-brand-text">Deposit TON</h2>
            <button onClick={onClose} className="text-brand-muted text-xl p-1">×</button>
          </div>

          {loading && (
            <div className="text-center py-10">
              <span className="w-8 h-8 border-2 border-brand-gold/30 border-t-brand-gold rounded-full animate-spin inline-block" />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {info && (
            <>
              <div className="rounded-xl border border-yellow-900/40 bg-yellow-950/20 p-3 mb-4">
                <p className="text-xs font-bold text-yellow-300 mb-1">⚠️ Important</p>
                <p className="text-[11px] text-yellow-200/80 leading-relaxed">
                  You must include the memo below as the transaction comment. Deposits sent without
                  the correct memo cannot be automatically matched to your account and may require
                  manual support to recover. Only send TON — other coins will be lost.
                </p>
              </div>

              <div className="mb-4">
                <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
                  Deposit Address
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-brand-surface border border-brand-border rounded-xl px-3 py-3 text-xs font-mono text-brand-text break-all">
                    {info.depositAddress}
                  </div>
                  <button
                    onClick={() => copy(info.depositAddress, 'Address')}
                    className="px-3 py-3 bg-brand-gold/10 border border-brand-gold/30 rounded-xl text-brand-gold text-xs font-bold flex-shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-1.5">
                  Memo (required)
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-brand-surface border border-brand-gold/40 rounded-xl px-3 py-3 text-sm font-mono font-bold text-brand-gold">
                    {info.memo}
                  </div>
                  <button
                    onClick={() => copy(info.memo, 'Memo')}
                    className="px-3 py-3 bg-brand-gold/10 border border-brand-gold/30 rounded-xl text-brand-gold text-xs font-bold flex-shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-brand-surface border border-brand-border p-3 text-xs text-brand-muted leading-relaxed">
                1. Open your TON wallet (Tonkeeper, Telegram Wallet, etc.)<br />
                2. Send any amount of TON to the address above<br />
                3. Paste the memo into the comment/message field<br />
                4. Your balance updates automatically within a few minutes — GRAM is just what we call TON in this app
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
