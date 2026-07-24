'use client';

import { useEffect, useState } from 'react';
import { timeLeft } from '@/lib/telegram';

export interface Countdown {
  /** Human label — "2h 14m", "45s", "Expired", or "—" for a bad timestamp. */
  label: string;
  /** True once the deadline has passed. Drives the UI back to the empty state. */
  expired: boolean;
}

function compute(expiresAt: string | null | undefined): Countdown {
  if (!expiresAt) return { label: '', expired: false };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return { label: '—', expired: false };
  return { label: timeLeft(expiresAt), expired: ms <= 0 };
}

/**
 * Ticking countdown to a timestamp.
 *
 * Every card used to run this inline with the occupancy *object* as the
 * effect dependency. /api/slots builds fresh objects on every fetch, so
 * each realtime event and each fallback poll tore down and recreated an
 * interval on every card on the board. Keying on the timestamp string
 * means the timer only resets when the deadline actually changes.
 *
 * Returning `expired` alongside the label is the part that matters: a
 * card that has run out needs to stop rendering a dead ad, not just
 * relabel its countdown to "Expired" and keep showing it.
 */
export function useCountdown(expiresAt: string | null | undefined): Countdown {
  const [state, setState] = useState<Countdown>(() => compute(expiresAt));

  useEffect(() => {
    setState(compute(expiresAt));
    if (!expiresAt) return;

    const id = setInterval(() => setState(compute(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return state;
}
