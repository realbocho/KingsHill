'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useApp, AppProvider } from '@/lib/store';
import { Toast } from '@/components/Toast';
import { BoardTab } from '@/components/BoardTab';
import { WalletTab } from '@/components/WalletTab';
import { LeaderboardTab } from '@/components/LeaderboardTab';
import { ProfileTab } from '@/components/ProfileTab';
import { AdminPanel } from '@/components/AdminPanel';
import clsx from 'clsx';

const BASE_NAV_TABS = [
  { key: 'board',       label: 'Board',   icon: '⚡' },
  { key: 'wallet',      label: 'Wallet',  icon: '💎' },
  { key: 'leaderboard', label: 'Ranks',   icon: '🏆' },
  { key: 'profile',     label: 'Profile', icon: '👤' },
] as const;

const ADMIN_TAB = { key: 'admin', label: 'Admin', icon: '🛡' } as const;

function AppInner() {
  const { state, dispatch, refreshSlots, refreshWallet, showToast } = useApp();
  const initialized = useRef(false);

  const init = useCallback(async () => {
    if (initialized.current) return;
    initialized.current = true;

    try {
      let initData = 'dev'; // fallback for dev

      // Try to get Telegram initData
      if (typeof window !== 'undefined') {
        const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } } }).Telegram?.WebApp;
        if (tg?.initData) {
          initData = tg.initData;
          tg.ready?.();
          tg.expand?.();
        }
      }

      const res  = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData }),
      });
      const data = await res.json();

      if (!res.ok || !data.user) {
        dispatch({ type: 'SET_AUTH_ERROR', error: data.error ?? 'Authentication failed' });
        dispatch({ type: 'SET_LOADING', loading: false });
        return;
      }

      dispatch({ type: 'SET_USER', user: data.user });

      // Check admin status
      fetch(`/api/admin/check?telegramId=${data.user.telegram_id}`)
        .then(r => r.json())
        .then(d => dispatch({ type: 'SET_IS_ADMIN', isAdmin: !!d.isAdmin }))
        .catch(() => {});

      // Load initial data
      await Promise.all([refreshSlots(), refreshWallet()]);

      if (data.user.total_spent === 0 && data.user.total_earned === 0) {
        showToast('Welcome! 7 GRAM bonus added — use it to bid (not withdrawable). 🎁', 'success');
      }
    } catch (err) {
      console.error(err);
      dispatch({ type: 'SET_AUTH_ERROR', error: 'Connection failed' });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [dispatch, refreshSlots, refreshWallet, showToast]);

  useEffect(() => { init(); }, [init]);

  if (state.loading) {
    return (
      <div className="h-screen bg-brand-dark flex flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-2 border-brand-gold/20 border-t-brand-gold animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl">👑</span>
          </div>
        </div>
        <div className="text-center">
          <p className="text-brand-gold font-bold text-lg gold-shimmer">KingsHill</p>
          <p className="text-brand-muted text-xs mt-1">Loading your empire...</p>
          <p className="text-brand-muted text-[10px] mt-2">Currency: GRAM (TON's name in this app)</p>
        </div>
      </div>
    );
  }

  if (state.authError) {
    return (
      <div className="h-screen bg-brand-dark flex flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="text-4xl">⚠️</span>
        <div>
          <p className="text-brand-text font-bold">Authentication Failed</p>
          <p className="text-brand-muted text-sm mt-1">{state.authError}</p>
          <p className="text-brand-muted text-xs mt-3">Please open this app through Telegram.</p>
        </div>
        <button
          onClick={() => { initialized.current = false; init(); }}
          className="px-6 py-2.5 bg-brand-gold text-brand-dark font-bold rounded-xl text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  const navTabs = state.isAdmin ? [...BASE_NAV_TABS, ADMIN_TAB] : BASE_NAV_TABS;

  return (
    <div className="h-screen flex flex-col bg-brand-dark overflow-hidden safe-top">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-brand-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">👑</span>
          <span className="font-bold text-base gold-shimmer">KingsHill</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-brand-muted font-mono">
            {state.user?.first_name}
          </span>
          <div className="px-2.5 py-1 rounded-lg bg-brand-gold/10 border border-brand-gold/20" title="GRAM is TON's name in this app">
            <span className="text-xs font-bold text-brand-gold font-mono">
              {state.user ? Number(state.user.wallet).toFixed(2) : '—'} GRAM
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {state.activeTab === 'board'       && <BoardTab />}
        {state.activeTab === 'wallet'      && <WalletTab />}
        {state.activeTab === 'leaderboard' && <LeaderboardTab />}
        {state.activeTab === 'profile'     && <ProfileTab />}
        {state.activeTab === 'admin'       && state.isAdmin && <AdminPanel />}
      </main>

      {/* Bottom nav */}
      <nav className="bottom-nav flex-shrink-0 safe-bottom">
        <div className={clsx('grid', navTabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
          {navTabs.map(tab => {
            const active = state.activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => dispatch({ type: 'SET_TAB', tab: tab.key })}
                className={clsx(
                  'flex flex-col items-center gap-0.5 py-3 transition-colors',
                  active ? 'text-brand-gold' : 'text-brand-muted'
                )}
              >
                <span className={clsx('text-lg leading-none transition-transform', active && 'scale-110')}>
                  {tab.icon}
                </span>
                <span className={clsx('text-[10px] font-medium', active && 'font-bold')}>
                  {tab.label}
                </span>
                {active && (
                  <div className="absolute bottom-0 w-6 h-0.5 bg-brand-gold rounded-full" style={{ position: 'relative' }} />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
