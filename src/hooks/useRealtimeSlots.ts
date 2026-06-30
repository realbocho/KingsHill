'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

interface UseRealtimeSlotsOptions {
  onChange: () => void;
  enabled: boolean;
}

/**
 * Subscribes to Postgres changes on the occupancies table via Supabase
 * Realtime (websocket). Any insert/update there means a bid happened
 * somewhere, a slot was displaced, or an admin removed content — in
 * all of those cases we just refetch the full slots list, since the
 * board needs the joined slot+occupancy+user shape anyway and that's
 * cheap relative to how rarely bids happen.
 *
 * Falls back gracefully: if the websocket disconnects, the caller
 * should still keep its own periodic refresh as a safety net (we
 * keep a long 30s fallback poll in the store for exactly this).
 */
export function useRealtimeSlots({ onChange, enabled }: UseRealtimeSlotsOptions) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel('occupancy-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'occupancies' },
        () => onChangeRef.current()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          logger.debug('realtime_connected', { channel: 'occupancy-changes' });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          logger.warn('realtime_connection_issue', { status });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
