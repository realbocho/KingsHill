'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'kingshill_how_it_works_seen_v1';

const STEPS = [
  {
    icon: '🏰',
    title: 'Occupy',
    body: 'Pay GRAM to claim an ad slot for a chosen duration.',
  },
  {
    icon: '⚔️',
    title: 'Challenge',
    body: 'Anyone can outbid you by paying ≥X% above your current bid.',
  },
  {
    icon: '💰',
    title: 'Profit',
    body: 'Displaced? You get your original stake back + 80% of the premium the challenger paid.',
  },
  {
    icon: '🔄',
    title: 'Reset',
    body: 'If your time runs out un-challenged, the slot resets to base price.',
  },
];

export function HowItWorksModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        setOpen(true);
      }
    } catch {
      // localStorage unavailable (e.g. private mode) — show once per session anyway
      setOpen(true);
    }
  }, []);

  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-6">
      <div className="w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl border border-brand-border bg-brand-surface shadow-2xl">
        <div className="px-5 pt-5 pb-3 border-b border-brand-border flex items-center gap-2">
          <span className="text-2xl">👑</span>
          <div>
            <p className="font-bold text-brand-text leading-tight">How KingsHill Works</p>
            <p className="text-xs text-brand-muted mt-0.5">Digital Times Square — quick start</p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {STEPS.map(step => (
            <div key={step.title} className="flex gap-3 items-start">
              <span className="text-xl flex-shrink-0 w-8 text-center">{step.icon}</span>
              <div>
                <p className="text-sm font-bold text-brand-gold">{step.title}</p>
                <p className="text-xs text-brand-muted leading-snug mt-0.5">{step.body}</p>
              </div>
            </div>
          ))}

          <div className="mt-2 pt-3 border-t border-brand-border space-y-2">
            <p className="text-xs text-brand-muted leading-snug">
              <span className="text-brand-gold font-bold">GRAM = TON.</span> It&apos;s just the in-app
              name for your TON balance — no conversion, no separate token. Deposit TON to top up,
              withdraw GRAM to get TON back, any time, from the Wallet tab.
            </p>
            <p className="text-xs text-brand-muted leading-snug">
              Every ad requires agreeing to the content policy before you bid. Illegal or
              rights-infringing content is removed immediately and the stake is forfeited.
            </p>
          </div>
        </div>

        <div className="px-5 pb-5 pt-1">
          <button
            onClick={close}
            className="w-full py-3 rounded-xl bg-brand-gold text-brand-dark font-bold text-sm active:scale-[0.98] transition-transform"
          >
            Got it, let&apos;s go
          </button>
        </div>
      </div>
    </div>
  );
}
