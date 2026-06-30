'use client';

import { useApp } from '@/lib/store';
import { SlotCard } from '@/components/SlotCard';
import { BidModal } from '@/components/BidModal';
import { LiveTicker } from '@/components/LiveTicker';
import type { SlotWithOccupancy } from '@/types/database';
import { formatGramsShort } from '@/lib/telegram';

export function BoardTab() {
  const { state, dispatch, refreshSlots } = useApp();
  const { slots, user, selectedSlot } = state;

  const tickerItems = slots
    .filter(s => s.current_occupancy?.ad_text)
    .map(s => ({
      text:  `${s.current_occupancy!.ad_text} — ${s.name} @ ${formatGramsShort(s.current_occupancy!.bid_amount)} GRAM`,
      emoji: s.current_occupancy!.ad_emoji ?? '🔥',
      color: s.current_occupancy!.ad_color ?? '#FFD700',
    }));

  const activeCount  = slots.filter(s => s.current_occupancy).length;
  const totalVolume  = slots.reduce((sum, s) => sum + (s.current_occupancy?.bid_amount ?? 0), 0);

  return (
    <>
      <LiveTicker items={tickerItems} />

      {/* Stats bar */}
      <div className="grid grid-cols-3 divide-x divide-brand-border border-b border-brand-border">
        {[
          { label: 'Active Ads', value: `${activeCount}/${slots.length}` },
          { label: 'Locked Value', value: `${formatGramsShort(totalVolume)} GRAM` },
          { label: 'Your Balance', value: `${formatGramsShort(user?.wallet ?? 0)} GRAM` },
        ].map(stat => (
          <div key={stat.label} className="text-center py-2 px-1">
            <p className="text-[10px] text-brand-muted uppercase tracking-wider">{stat.label}</p>
            <p className="text-sm font-bold text-brand-gold font-mono">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Board */}
      <div className="flex-1 overflow-y-auto p-3">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: 'auto' }}
        >
          {slots.map(slot => (
            <SlotCard
              key={slot.id}
              slot={slot}
              isOwned={slot.current_occupancy?.user_id === user?.id}
              onClick={(s) => dispatch({ type: 'SET_SELECTED_SLOT', slot: s })}
            />
          ))}
        </div>

        {slots.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-3">📡</div>
            <p className="text-brand-muted text-sm">Loading the board...</p>
          </div>
        )}

        {/* Manual refresh — realtime updates the board automatically, this is just a manual nudge */}
        <button
          onClick={refreshSlots}
          className="w-full mt-3 py-2.5 text-xs text-brand-muted border border-brand-border/40 rounded-xl hover:border-brand-gold/20 hover:text-brand-gold transition-colors"
        >
          ↻ Force Refresh
        </button>
      </div>

      {/* Bid modal */}
      {selectedSlot && (
        <BidModal
          slot={selectedSlot}
          onClose={() => dispatch({ type: 'SET_SELECTED_SLOT', slot: null })}
        />
      )}
    </>
  );
}
