'use client';

import { useEffect, useState } from 'react';
import type { SlotWithOccupancy } from '@/types/database';
import { formatGramsShort, timeLeft, adImageUrl } from '@/lib/telegram';
import clsx from 'clsx';

interface Props {
  slot:     SlotWithOccupancy;
  onClick:  (slot: SlotWithOccupancy) => void;
  isOwned:  boolean;
}

const TIER_LABELS: Record<string, string> = {
  prime:    'PRIME',
  corner:   'CORNER',
  standard: 'STD',
};

export function SlotCard({ slot, onClick, isOwned }: Props) {
  const occ = slot.current_occupancy;
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    if (!occ) return;
    const update = () => setTimeStr(timeLeft(occ.expires_at));
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, [occ]);

  const bgColor = occ?.ad_color ?? '#2A2A3A';
  const isPrime = slot.tier === 'prime';
  const isCorner = slot.tier === 'corner';
  const heightClass = isPrime ? 'row-span-2' : isCorner ? 'row-span-2' : '';
  const widthClass  = isPrime ? 'col-span-3' : '';

  return (
    <div
      className={clsx(
        'slot-card rounded-xl border cursor-pointer relative overflow-hidden',
        heightClass, widthClass,
        occ ? 'border-brand-border' : 'border-brand-border/50 border-dashed',
        isOwned && 'ring-1 ring-brand-gold/60',
        occ && isPrime && 'slot-occupied',
      )}
      style={occ ? {
        background: `linear-gradient(135deg, ${bgColor}22, ${bgColor}08)`,
        borderColor: `${bgColor}44`,
      } : {}}
      onClick={() => onClick(slot)}
    >
      {/* Tier badge */}
      <div className="absolute top-1.5 left-1.5 z-10">
        <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded', `tier-${slot.tier}`)}>
          {TIER_LABELS[slot.tier]}
        </span>
      </div>

      {/* Owned indicator */}
      {isOwned && (
        <div className="absolute top-1.5 right-1.5 z-10">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-brand-gold/20 text-brand-gold border border-brand-gold/40">
            YOURS
          </span>
        </div>
      )}

      {occ ? (
        // Occupied state
        <div className={clsx('h-full flex flex-col justify-between p-2 relative', isPrime ? 'min-h-[100px]' : 'min-h-[70px]')}>
          {occ.ad_image_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={adImageUrl(occ.ad_image_path) ?? ''}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-30"
            />
          )}
          <div className="mt-5 relative">
            {/* Ad content */}
            <div className="flex items-start gap-1.5">
              <span className={clsx('text-2xl leading-none', isPrime && 'text-4xl')}>
                {occ.ad_emoji ?? '🔥'}
              </span>
              <div className="flex-1 min-w-0">
                <p className={clsx(
                  'font-bold leading-tight truncate',
                  isPrime ? 'text-sm' : 'text-xs'
                )} style={{ color: bgColor === '#2A2A3A' ? '#E8E8F0' : bgColor }}>
                  {occ.ad_text ?? 'No message'}
                </p>
                {isPrime && occ.ad_url && (
                  <p className="text-[10px] text-brand-muted truncate mt-0.5">{occ.ad_url}</p>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-1.5 relative">
            <span className="text-[10px] text-brand-muted font-mono">
              ⏱ {timeStr}
            </span>
            <div className="text-right">
              <span className="text-[10px] text-brand-gold font-bold font-mono">
                {formatGramsShort(occ.bid_amount)} GRAM
              </span>
            </div>
          </div>
        </div>
      ) : (
        // Empty state
        <div className={clsx('h-full flex flex-col items-center justify-center gap-1 text-center p-2', isPrime ? 'min-h-[100px]' : 'min-h-[70px]')}>
          <span className="text-lg mt-4 opacity-30">+</span>
          <p className="text-[10px] text-brand-muted leading-tight">{slot.name}</p>
          <p className="text-[10px] font-mono text-brand-gold/70">
            from {formatGramsShort(slot.base_price)} GRAM
          </p>
        </div>
      )}
    </div>
  );
}
