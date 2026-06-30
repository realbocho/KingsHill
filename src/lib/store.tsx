'use client';

import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import type { User, SlotWithOccupancy, WalletTx, PlatformStats } from '@/types/database';
import { useRealtimeSlots } from '@/hooks/useRealtimeSlots';

interface AppState {
  user:         User | null;
  slots:        SlotWithOccupancy[];
  walletTxs:    WalletTx[];
  stats:        PlatformStats | null;
  loading:      boolean;
  authError:    string | null;
  toast:        { message: string; type: 'success' | 'error' | 'info' } | null;
  activeTab:    'board' | 'wallet' | 'leaderboard' | 'profile' | 'admin';
  selectedSlot: SlotWithOccupancy | null;
  isAdmin:      boolean;
}

type Action =
  | { type: 'SET_USER'; user: User }
  | { type: 'SET_SLOTS'; slots: SlotWithOccupancy[] }
  | { type: 'SET_WALLET_TXS'; txs: WalletTx[] }
  | { type: 'SET_STATS'; stats: PlatformStats }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_AUTH_ERROR'; error: string }
  | { type: 'SHOW_TOAST'; message: string; toastType: 'success' | 'error' | 'info' }
  | { type: 'CLEAR_TOAST' }
  | { type: 'SET_TAB'; tab: AppState['activeTab'] }
  | { type: 'SET_SELECTED_SLOT'; slot: SlotWithOccupancy | null }
  | { type: 'SET_IS_ADMIN'; isAdmin: boolean }
  | { type: 'UPDATE_USER_WALLET'; wallet: number; total_earned: number; total_spent: number };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_USER':        return { ...state, user: action.user };
    case 'SET_SLOTS':       return { ...state, slots: action.slots };
    case 'SET_WALLET_TXS':  return { ...state, walletTxs: action.txs };
    case 'SET_STATS':       return { ...state, stats: action.stats };
    case 'SET_LOADING':     return { ...state, loading: action.loading };
    case 'SET_AUTH_ERROR':  return { ...state, authError: action.error };
    case 'SHOW_TOAST':      return { ...state, toast: { message: action.message, type: action.toastType } };
    case 'CLEAR_TOAST':     return { ...state, toast: null };
    case 'SET_TAB':         return { ...state, activeTab: action.tab, selectedSlot: null };
    case 'SET_SELECTED_SLOT': return { ...state, selectedSlot: action.slot };
    case 'SET_IS_ADMIN':      return { ...state, isAdmin: action.isAdmin };
    case 'UPDATE_USER_WALLET':
      if (!state.user) return state;
      return { ...state, user: { ...state.user, wallet: action.wallet, total_earned: action.total_earned, total_spent: action.total_spent } };
    default: return state;
  }
}

const initial: AppState = {
  user: null, slots: [], walletTxs: [], stats: null,
  loading: true, authError: null, toast: null,
  activeTab: 'board', selectedSlot: null, isAdmin: false,
};

interface AppContextValue {
  state:         AppState;
  dispatch:      React.Dispatch<Action>;
  refreshSlots:  () => Promise<void>;
  refreshWallet: () => Promise<void>;
  showToast:     (message: string, type?: 'success' | 'error' | 'info') => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  const refreshSlots = useCallback(async () => {
    try {
      const res  = await fetch('/api/slots');
      const data = await res.json();
      if (data.slots) dispatch({ type: 'SET_SLOTS', slots: data.slots });
    } catch {}
  }, []);

  const refreshWallet = useCallback(async () => {
    if (!state.user) return;
    try {
      const res  = await fetch(`/api/wallet?userId=${state.user.id}`);
      const data = await res.json();
      if (data.transactions) dispatch({ type: 'SET_WALLET_TXS', txs: data.transactions });
      if (data.user) dispatch({ type: 'UPDATE_USER_WALLET', wallet: data.user.wallet, total_earned: data.user.total_earned, total_spent: data.user.total_spent });
    } catch {}
  }, [state.user]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    dispatch({ type: 'SHOW_TOAST', message, toastType: type });
    setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 3500);
  }, []);

  // Realtime websocket subscription — fires the moment a bid/displacement/
  // admin removal happens anywhere, no polling delay.
  useRealtimeSlots({ onChange: refreshSlots, enabled: !!state.user });

  // Fallback poll, much less frequent than before (was 10s). This only
  // matters if the websocket connection drops and doesn't reconnect in
  // time — Realtime handles reconnection itself, this is just a safety
  // net so the board can't go stale indefinitely on a flaky connection.
  useEffect(() => {
    if (!state.user) return;
    const interval = setInterval(refreshSlots, 30000);
    return () => clearInterval(interval);
  }, [state.user, refreshSlots]);

  return (
    <AppContext.Provider value={{ state, dispatch, refreshSlots, refreshWallet, showToast }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
