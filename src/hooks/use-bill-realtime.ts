'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

/** Realtime caps `in.(...)` filters at 100 values. */
const MAX_IN_FILTER_VALUES = 100;

interface ClaimRow {
  id: string;
  item_id: string;
}

interface IdRow {
  id: string;
}

interface UseBillRealtimeOptions {
  /** Bill to watch; pass null until the bill has loaded. */
  billId: string | null;
  /** Ids of the bill's items (order does not matter). */
  itemIds: string[];
  /** Ids of the participants this page currently holds. */
  participantIds: string[];
  /** Ids of the claims this page currently holds. */
  claimIds: string[];
  /** Coalesced refetch trigger. Identity changes never resubscribe. */
  onChange: () => void;
}

/**
 * Doorbell-only realtime for one bill: every relevant change (or a catch-up
 * moment like reconnect / tab visible / back online) calls `onChange`, and
 * the caller refetches the whole bill.
 *
 * The channel is keyed only on the bill id and the set of item ids, so
 * ordinary refetches (new object references) never tear it down.
 *
 * DELETEs are handled client-side for every table: under RLS a DELETE
 * payload carries only the primary key, so a server-side filter such as
 * `bill_id=eq.X` can never match it. Each table gets one unfiltered DELETE
 * binding that notifies only when `old.id` is a row this page holds; a row
 * we never saw had its INSERT already trigger a refetch.
 */
export function useBillRealtime({
  billId,
  itemIds,
  participantIds,
  claimIds,
  onChange,
}: UseBillRealtimeOptions): void {
  const [supabase] = useState(createClient);

  // Read through refs so callback / array identity never retriggers the effect
  const onChangeRef = useRef(onChange);
  const claimIdsRef = useRef<Set<string>>(new Set());
  const participantIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    participantIdsRef.current = new Set(participantIds);
  }, [participantIds]);
  useEffect(() => {
    claimIdsRef.current = new Set(claimIds);
  }, [claimIds]);

  // Stable key: only changes when the actual set of items changes
  const itemKey = [...itemIds].sort().join(',');

  // Catch-up after phone sleep / tab switch / network loss
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

    const notify = () => onChangeRef.current();
    const ids = itemKey ? itemKey.split(',') : [];
    const knownItems = new Set(ids);

    const billFilter = `bill_id=eq.${billId}`;

    let channel: RealtimeChannel = supabase
      .channel(`bill:${billId}`)
      // bills: UPDATE payloads carry the id, so the filter matches; DELETE
      // is checked client-side against the id.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bills', filter: `id=eq.${billId}` },
        notify
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bills', filter: `id=eq.${billId}` },
        notify
      )
      .on<IdRow>('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bills' }, (payload) => {
        if (payload.old.id === billId) notify();
      })
      // participants
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants', filter: billFilter }, notify)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'participants', filter: billFilter }, notify)
      .on<IdRow>('postgres_changes', { event: 'DELETE', schema: 'public', table: 'participants' }, (payload) => {
        const id = payload.old.id;
        if (id && participantIdsRef.current.has(id)) notify();
      })
      // bill_items (knownItems tracks itemKey, which this effect is keyed on)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bill_items', filter: billFilter }, notify)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bill_items', filter: billFilter }, notify)
      .on<IdRow>('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bill_items' }, (payload) => {
        const id = payload.old.id;
        if (id && knownItems.has(id)) notify();
      });

    if (ids.length > 0) {
      // Server-side filter when Realtime allows it; otherwise listen broadly
      // and drop claims on items that are not ours.
      const canFilter = ids.length <= MAX_IN_FILTER_VALUES;
      const claimFilter = canFilter ? { filter: `item_id=in.(${itemKey})` } : {};
      const onClaimUpsert = (payload: { new: Partial<ClaimRow> }) => {
        if (canFilter || (payload.new.item_id && knownItems.has(payload.new.item_id))) notify();
      };

      channel = channel
        .on<ClaimRow>(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'item_claims', ...claimFilter },
          onClaimUpsert
        )
        .on<ClaimRow>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'item_claims', ...claimFilter },
          onClaimUpsert
        )
        // DELETE: unfiltered, checked against claims we hold (see JSDoc)
        .on<ClaimRow>(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'item_claims' },
          (payload) => {
            const id = payload.old.id;
            if (id && claimIdsRef.current.has(id)) notify();
          }
        );
    }

    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      if (hasSubscribedRef.current) notify();
      hasSubscribedRef.current = true;
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, billId, itemKey]);
}
