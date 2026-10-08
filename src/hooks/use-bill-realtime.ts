'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface UseBillRealtimeOptions {
  /** Bill to watch; pass null until the bill has loaded. */
  billId: string | null;
  /** Coalesced refetch trigger. Identity changes never resubscribe. */
  onChange: () => void;
}

interface Doorbell {
  payload?: { table?: string; bill_id?: string };
}

/**
 * Doorbell-only realtime for one bill: every relevant change (or a catch-up
 * moment like reconnect / tab visible / back online) calls `onChange`, and
 * the caller refetches the whole bill through the API.
 *
 * Database triggers (migration 013) broadcast `changed` with just
 * { table, bill_id } on the private topic bill:<id> whenever the bill, its
 * items, participants, or claims change. No row data is ever sent, and
 * clients can't read the tables directly, so the bill id (the share-link
 * secret) is what lets a guest listen. The channel is keyed only on the
 * bill id, so ordinary refetches never tear it down.
 */
export function useBillRealtime({ billId, onChange }: UseBillRealtimeOptions): void {
  const [supabase] = useState(createClient);

  // Read through a ref so callback identity never retriggers the effect
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Catch-up after phone sleep / tab switch / network loss: Broadcast has no
  // replay, so anything sent while we were away is only recovered here.
  useEffect(() => {
    if (!billId) return;
    const catchUp = () => onChangeRef.current();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') catchUp();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', catchUp);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', catchUp);
    };
  }, [billId]);

  // First SUBSCRIBED is the initial join (the initial fetch already covers
  // it); any later SUBSCRIBED is a rejoin, so refetch to catch up on misses.
  const hasSubscribedRef = useRef(false);

  useEffect(() => {
    if (!billId) return;

    const channel = supabase
      .channel(`bill:${billId}`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, (message: Doorbell) => {
        const target = message.payload?.bill_id;
        if (target && target !== billId) return;
        onChangeRef.current();
      });

    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      if (hasSubscribedRef.current) onChangeRef.current();
      hasSubscribedRef.current = true;
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, billId]);
}
