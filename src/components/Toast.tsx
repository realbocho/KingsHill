'use client';

import { useApp } from '@/lib/store';
import clsx from 'clsx';

export function Toast() {
  const { state } = useApp();
  if (!state.toast) return null;

  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const colors = {
    success: 'border-green-500/30 bg-green-950/80 text-green-300',
    error:   'border-red-500/30 bg-red-950/80 text-red-300',
    info:    'border-brand-gold/30 bg-yellow-950/80 text-yellow-300',
  };

  return (
    <div className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
      <div className={clsx(
        'toast-enter flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium shadow-2xl max-w-sm w-full',
        colors[state.toast.type]
      )}>
        <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-xs flex-shrink-0">
          {icons[state.toast.type]}
        </span>
        <span>{state.toast.message}</span>
      </div>
    </div>
  );
}
