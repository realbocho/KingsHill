'use client';

import { useEffect, useState, useCallback } from 'react';
import { useApp } from '@/lib/store';
import { formatGramsShort, timeAgo } from '@/lib/telegram';
import { TreasuryPanel } from '@/components/TreasuryPanel';
import clsx from 'clsx';

interface LiveOcc {
  id: string;
  slot_id: string;
  bid_amount: number;
  ad_text: string | null;
  ad_url: string | null;
  ad_emoji: string | null;
  ad_color: string | null;
  expires_at: string;
  created_at: string;
  users: { id: string; telegram_id: number; username: string | null; first_name: string | null } | null;
  ad_slots: { name: string; tier: string } | null;
}

interface PendingReport {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  occupancies: {
    id: string;
    ad_text: string | null;
    ad_emoji: string | null;
    ad_color: string | null;
    is_active: boolean;
    users: { username: string | null; first_name: string | null } | null;
  } | null;
  reporter: { username: string | null; first_name: string | null } | null;
}

const QUICK_REASONS = [
  'Infringes copyright / trademark',
  'Uses someone\u2019s likeness without consent',
  'Illegal or fraudulent content',
  'Scam / phishing link',
  'Harassment or hate speech',
  'Other policy violation',
];

export function AdminPanel() {
  const { state, refreshSlots, showToast } = useApp();
  const [liveOccs, setLiveOccs] = useState<LiveOcc[]>([]);
  const [reports,  setReports]  = useState<PendingReport[]>([]);
  const [tab, setTab] = useState<'live' | 'reports' | 'treasury'>('reports');
  const [removing, setRemoving] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!state.user) return;
    const res = await fetch(`/api/admin/queue?telegramId=${state.user.telegram_id}`);
    const data = await res.json();
    if (data.liveOccupancies) setLiveOccs(data.liveOccupancies);
    if (data.pendingReports) setReports(data.pendingReports);
  }, [state.user]);

  useEffect(() => { load(); }, [load]);

  async function removeOccupancy(occupancyId: string, reason: string, reportId?: string) {
    if (!state.user || !reason.trim()) {
      showToast('Enter a removal reason first', 'error');
      return;
    }
    setRemoving(occupancyId);
    try {
      const res = await fetch('/api/admin/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: state.user.telegram_id,
          occupancyId,
          reason: reason.trim(),
          reportId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? 'Failed to remove', 'error');
      } else {
        showToast('Content removed and slot reset', 'success');
        await load();
        await refreshSlots();
      }
    } finally {
      setRemoving(null);
    }
  }

  const displayName = (u?: { username?: string | null; first_name?: string | null } | null) =>
    u ? (u.username ? `@${u.username}` : (u.first_name ?? 'Anonymous')) : 'Unknown';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-3 mt-3 mb-2 rounded-xl bg-red-950/30 border border-red-900/40 p-3">
        <p className="text-xs font-bold text-red-300">🛡 Admin Panel</p>
        <p className="text-[11px] text-red-200/70 mt-0.5">
          Remove any ad that infringes rights or breaks the law. Removal is immediate and the
          slot's stake is forfeited by default — no refund unless you grant one.
        </p>
      </div>

      <div className="flex mx-3 mb-3 rounded-xl overflow-hidden border border-brand-border">
        {[
          { key: 'reports',  label: `🚩 Reports (${reports.length})` },
          { key: 'live',     label: `📡 All Live (${liveOccs.length})` },
          { key: 'treasury', label: `💰 Treasury` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={clsx(
              'flex-1 py-2.5 text-xs font-bold transition-colors',
              tab === t.key ? 'bg-brand-gold text-brand-dark' : 'bg-brand-surface text-brand-muted'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-3 pb-3 space-y-3">
        {tab === 'reports' && (
          reports.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-sm text-brand-muted">No pending reports</p>
            </div>
          ) : reports.map(r => (
            <div key={r.id} className="rounded-xl border border-brand-border bg-brand-surface p-3">
              <div className="flex items-start gap-2 mb-2">
                <span className="text-xl flex-shrink-0">{r.occupancies?.ad_emoji ?? '🔥'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-brand-text truncate">
                    {r.occupancies?.ad_text ?? '(content already removed)'}
                  </p>
                  <p className="text-[10px] text-brand-muted">
                    by {displayName(r.occupancies?.users)} · reported by {displayName(r.reporter)} · {timeAgo(r.created_at)}
                  </p>
                </div>
              </div>
              <p className="text-xs text-brand-text bg-brand-card rounded-lg p-2 mb-2">
                "{r.reason}"
              </p>

              {r.occupancies?.is_active ? (
                <>
                  <textarea
                    value={reasonDraft[r.id] ?? r.reason}
                    onChange={e => setReasonDraft(prev => ({ ...prev, [r.id]: e.target.value }))}
                    rows={2}
                    placeholder="Removal reason shown internally..."
                    className="w-full bg-brand-card border border-brand-border rounded-lg px-2.5 py-2 text-xs text-brand-text outline-none resize-none mb-2"
                  />
                  <button
                    onClick={() => removeOccupancy(r.occupancies!.id, reasonDraft[r.id] ?? r.reason, r.id)}
                    disabled={removing === r.occupancies!.id}
                    className="w-full py-2 rounded-lg text-xs font-bold bg-red-600 text-white disabled:opacity-40"
                  >
                    {removing === r.occupancies!.id ? 'Removing...' : '🗑 Remove Content Now'}
                  </button>
                </>
              ) : (
                <p className="text-xs text-brand-muted italic">Already taken down or expired.</p>
              )}
            </div>
          ))
        )}

        {tab === 'live' && liveOccs.map(occ => (
          <div key={occ.id} className="rounded-xl border border-brand-border bg-brand-surface p-3"
            style={{ borderColor: `${occ.ad_color ?? '#2A2A3A'}30` }}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-start gap-2 min-w-0">
                <span className="text-xl flex-shrink-0">{occ.ad_emoji ?? '🔥'}</span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-brand-text truncate">{occ.ad_text}</p>
                  <p className="text-[10px] text-brand-muted truncate">
                    {occ.ad_slots?.name} · by {displayName(occ.users)} · {formatGramsShort(occ.bid_amount)} GRAM
                  </p>
                  {occ.ad_url && <p className="text-[10px] text-brand-muted truncate">{occ.ad_url}</p>}
                </div>
              </div>
            </div>

            <div className="flex gap-1.5 flex-wrap mb-2">
              {QUICK_REASONS.map(reason => (
                <button
                  key={reason}
                  onClick={() => setReasonDraft(prev => ({ ...prev, [occ.id]: reason }))}
                  className={clsx(
                    'text-[10px] px-2 py-1 rounded-full border',
                    reasonDraft[occ.id] === reason
                      ? 'bg-red-900/40 border-red-700 text-red-300'
                      : 'bg-brand-card border-brand-border text-brand-muted'
                  )}
                >
                  {reason}
                </button>
              ))}
            </div>

            <textarea
              value={reasonDraft[occ.id] ?? ''}
              onChange={e => setReasonDraft(prev => ({ ...prev, [occ.id]: e.target.value }))}
              rows={2}
              placeholder="Removal reason..."
              className="w-full bg-brand-card border border-brand-border rounded-lg px-2.5 py-2 text-xs text-brand-text outline-none resize-none mb-2"
            />
            <button
              onClick={() => removeOccupancy(occ.id, reasonDraft[occ.id] ?? '')}
              disabled={removing === occ.id || !(reasonDraft[occ.id] ?? '').trim()}
              className="w-full py-2 rounded-lg text-xs font-bold bg-red-600 text-white disabled:opacity-40"
            >
              {removing === occ.id ? 'Removing...' : '🗑 Remove Content Now'}
            </button>
          </div>
        ))}

        {tab === 'live' && liveOccs.length === 0 && (
          <div className="text-center py-10">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-sm text-brand-muted">No live ads right now</p>
          </div>
        )}

        {tab === 'treasury' && <TreasuryPanel />}
      </div>
    </div>
  );
}
