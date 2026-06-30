'use client';

import { useEffect, useState } from 'react';

interface TickerItem {
  text: string;
  emoji: string;
  color: string;
}

interface Props {
  items: TickerItem[];
}

export function LiveTicker({ items }: Props) {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setOffset(prev => (prev + 1) % (items.length * 300 + 1));
    }, 50);
    return () => clearInterval(interval);
  }, [items.length]);

  if (!items.length) {
    return (
      <div className="bg-brand-surface border-b border-brand-border px-4 py-1.5 text-xs text-brand-muted flex items-center gap-2">
        <span className="text-brand-gold animate-pulse">●</span>
        <span>LIVE — No active bids yet. Be the first to claim a slot!</span>
      </div>
    );
  }

  const doubled = [...items, ...items];

  return (
    <div className="bg-brand-surface border-b border-brand-border overflow-hidden py-1.5">
      <div className="flex items-center gap-2 px-3 mb-0.5">
        <span className="text-brand-gold text-xs animate-pulse flex-shrink-0">● LIVE</span>
      </div>
      <div className="ticker-wrap">
        <div
          className="inline-flex gap-8 transition-none"
          style={{ transform: `translateX(-${offset}px)`, willChange: 'transform' }}
        >
          {doubled.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
              <span>{item.emoji}</span>
              <span style={{ color: item.color }} className="font-medium">{item.text}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
