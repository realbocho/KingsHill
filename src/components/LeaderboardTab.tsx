'use client';

import { useEffect, useState } from 'react';
import { formatGramsShort } from '@/lib/telegram';
import clsx from 'clsx';
import type { User } from '@/types/database';

interface LeaderData {
  topEarners:  (User & { total_earned: number })[];
  topSpenders: (User & { total_spent:  number })[];
  stats: {
    total_bids:           number;
    total_volume:         number;
    total_fees_collected: number;
    total_users:          number;
  } | null;
  recentBids: Array<{
    id:         string;
    bid_amount: number;
    premium_paid: number;
    ad_text:    string | null;
    ad_emoji:   string | null;
    ad_color:   string | null;
    created_at: string;
    users:      { username: string | null; first_name: string | null } | null;
    ad_slots:   { name: string; tier: string } | null;
  }>;
}

function timeAgo(date: string) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function LeaderboardTab() {
  const [data, setData] = useState<LeaderData | null>(null);
  const [tab,  setTab]  = useState<'earners' | 'spenders' | 'live'>('earners');

  useEffect(() => {
    fetch('/api/leaderboard')
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const displayName = (u: { username?: string | null; first_name?: string | null }) =>
    u.username ? `@${u.username}` : (u.first_name ?? 'Anonymous');

  const MEDALS = ['🥇', '🥈', '🥉'];

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Platform stats */}
      {data?.stats && (
        <div className="m-3 rounded-2xl bg-brand-surface border border-brand-border p-4">
          <p className="text-xs text-brand-muted uppercase tracking-widest mb-3 text-center">
            Platform Stats
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total Bids',   value: data.stats.total_bids.toLocaleString() },
              { label: 'Volume',       value: `${formatGramsShort(data.stats.total_volume)} GRAM` },
              { label: 'Users',        value: data.stats.total_users.toLocaleString() },
              { label: 'Fees Earned',  value: `${formatGramsShort(data.stats.total_fees_collected)} GRAM` },
            ].map(s => (
              <div key={s.label} className="text-center bg-brand-card rounded-xl p-2.5">
                <p className="text-[10px] text-brand-muted uppercase">{s.label}</p>
                <p className="text-base font-bold text-brand-gold font-mono">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex mx-3 mb-3 rounded-xl overflow-hidden border border-brand-border">
        {[
          { key: 'earners',  label: '💰 Earners' },
          { key: 'spenders', label: '⚔️ Players' },
          { key: 'live',     label: '🔴 Live' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={clsx(
              'flex-1 py-2.5 text-xs font-bold transition-colors',
              tab === t.key
                ? 'bg-brand-gold text-brand-dark'
                : 'bg-brand-surface text-brand-muted'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-3 pb-3 space-y-2">
        {!data && (
          <div className="text-center py-10">
            <div className="w-8 h-8 border-2 border-brand-gold/30 border-t-brand-gold rounded-full animate-spin mx-auto" />
          </div>
        )}

        {tab === 'earners' && data?.topEarners.map((u, i) => (
          <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-brand-surface border border-brand-border">
            <span className="text-xl w-7 text-center">{MEDALS[i] ?? `${i + 1}`}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-brand-text truncate">{displayName(u)}</p>
              <p className="text-[10px] text-brand-muted">Wallet: {formatGramsShort(u.wallet)} GRAM</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-green-400 font-mono">+{formatGramsShort(u.total_earned)} GRAM</p>
              <p className="text-[10px] text-brand-muted">earned</p>
            </div>
          </div>
        ))}

        {tab === 'spenders' && data?.topSpenders.map((u, i) => (
          <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-brand-surface border border-brand-border">
            <span className="text-xl w-7 text-center">{MEDALS[i] ?? `${i + 1}`}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-brand-text truncate">{displayName(u)}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-red-400 font-mono">{formatGramsShort(u.total_spent)} GRAM</p>
              <p className="text-[10px] text-brand-muted">invested</p>
            </div>
          </div>
        ))}

        {tab === 'live' && data?.recentBids.map(bid => (
          <div key={bid.id} className="flex items-start gap-3 p-3 rounded-xl bg-brand-surface border border-brand-border"
            style={bid.ad_color ? { borderColor: `${bid.ad_color}30` } : {}}
          >
            <span className="text-xl flex-shrink-0">{bid.ad_emoji ?? '🔥'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-brand-text truncate">
                {bid.users ? displayName(bid.users) : 'Unknown'}
                <span className="text-brand-muted font-normal"> seized </span>
                {bid.ad_slots?.name}
              </p>
              {bid.ad_text && (
                <p className="text-[10px] text-brand-muted truncate mt-0.5">"{bid.ad_text}"</p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs font-bold text-brand-gold font-mono">{formatGramsShort(bid.bid_amount)} GRAM</p>
              <p className="text-[10px] text-brand-muted">{timeAgo(bid.created_at)} ago</p>
            </div>
          </div>
        ))}

        {tab === 'live' && data?.recentBids.length === 0 && (
          <div className="text-center py-10">
            <p className="text-3xl mb-2">📡</p>
            <p className="text-sm text-brand-muted">No bids yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
