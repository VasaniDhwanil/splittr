import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBillRealtime } from '@/hooks/use-bill-realtime';

// ---------------------------------------------------------------------------
// Fake Supabase realtime client
// ---------------------------------------------------------------------------

interface BindingConfig {
  event: string;
  schema: string;
  table: string;
  filter?: string;
}

interface Binding {
  type: string;
  cfg: BindingConfig;
  cb: (payload: unknown) => void;
}

interface FakeChannel {
  topic: string;
  bindings: Binding[];
  statusCb: ((status: string) => void) | null;
  on: (type: string, cfg: BindingConfig, cb: (payload: unknown) => void) => FakeChannel;
  subscribe: (cb: (status: string) => void) => FakeChannel;
}

const fake = vi.hoisted(() => {
  const channels: FakeChannel[] = [];
  const channel = vi.fn((topic: string): FakeChannel => {
    const ch: FakeChannel = {
      topic,
      bindings: [],
      statusCb: null,
      on(type, cfg, cb) {
        ch.bindings.push({ type, cfg, cb });
        return ch;
      },
      subscribe(cb) {
        ch.statusCb = cb;
        return ch;
      },
    };
    channels.push(ch);
    return ch;
  });
  const removeChannel = vi.fn((ch: FakeChannel) => ch);
  return { channels, channel, removeChannel };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ channel: fake.channel, removeChannel: fake.removeChannel }),
}));

function lastChannel(): FakeChannel {
  const ch = fake.channels[fake.channels.length - 1];
  if (!ch) throw new Error('no channel was created');
  return ch;
}

function bindingsFor(table: string, event: string, ch: FakeChannel = lastChannel()): Binding[] {
  return ch.bindings.filter((b) => b.cfg.table === table && b.cfg.event === event);
}

function binding(table: string, event: string, ch: FakeChannel = lastChannel()): Binding {
  const found = bindingsFor(table, event, ch);
  if (found.length !== 1) throw new Error(`expected 1 binding for ${table}/${event}, got ${found.length}`);
  return found[0];
}

function fire(table: string, event: string, payload: unknown): void {
  act(() => {
    binding(table, event).cb(payload);
  });
}

function fireStatus(status: string): void {
  const cb = lastChannel().statusCb;
  if (!cb) throw new Error('subscribe was never called');
  act(() => {
    cb(status);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BILL_ID = 'bill-1';

interface HookProps {
  billId: string | null;
  itemIds: string[];
  participantIds: string[];
  claimIds: string[];
  onChange: () => void;
}

function baseProps(overrides: Partial<HookProps> = {}): HookProps {
  return {
    billId: BILL_ID,
    itemIds: ['item-a', 'item-b'],
    participantIds: ['p-1', 'p-2'],
    claimIds: ['c-1', 'c-2'],
    onChange: vi.fn(),
    ...overrides,
  };
}

function setup(overrides: Partial<HookProps> = {}) {
  const initialProps = baseProps(overrides);
  const utils = renderHook((props: HookProps) => useBillRealtime(props), { initialProps });
  return { ...utils, props: initialProps };
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

beforeEach(() => {
  fake.channels.length = 0;
  fake.channel.mockClear();
  fake.removeChannel.mockClear();
});

afterEach(() => {
  setVisibility('visible');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBillRealtime', () => {
  it('subscribes once to bill:<id> with filtered INSERT/UPDATE and unfiltered DELETE bindings', () => {
    setup();

    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.channel).toHaveBeenCalledWith(`bill:${BILL_ID}`);
    const ch = lastChannel();
    expect(ch.statusCb).not.toBeNull();
    expect(ch.bindings.every((b) => b.type === 'postgres_changes' && b.cfg.schema === 'public')).toBe(true);

    for (const event of ['INSERT', 'UPDATE']) {
      expect(binding('bills', event).cfg.filter).toBe(`id=eq.${BILL_ID}`);
      expect(binding('participants', event).cfg.filter).toBe(`bill_id=eq.${BILL_ID}`);
      expect(binding('bill_items', event).cfg.filter).toBe(`bill_id=eq.${BILL_ID}`);
      expect(binding('item_claims', event).cfg.filter).toBe('item_id=in.(item-a,item-b)');
    }

    for (const table of ['bills', 'participants', 'bill_items', 'item_claims']) {
      const del = bindingsFor(table, 'DELETE');
      expect(del).toHaveLength(1);
      expect(del[0].cfg.filter).toBeUndefined();
    }

    expect(ch.bindings).toHaveLength(12);
  });

  it('does not resubscribe for a new onChange identity', () => {
    const { rerender, props } = setup();
    rerender({ ...props, onChange: vi.fn() });
    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });

  it('does not resubscribe for a new claimIds array with the same contents', () => {
    const { rerender, props } = setup();
    rerender({ ...props, claimIds: [...props.claimIds] });
    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });

  it('does not resubscribe for a new participantIds array', () => {
    const { rerender, props } = setup();
    rerender({ ...props, participantIds: ['p-1', 'p-2', 'p-3'] });
    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });

  it('does not resubscribe when the same item ids arrive in a different order', () => {
    const { rerender, props } = setup();
    rerender({ ...props, itemIds: ['item-b', 'item-a'] });
    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });

  it('rebuilds the channel when the set of item ids changes', () => {
    const { rerender, props } = setup();
    const first = lastChannel();
    rerender({ ...props, itemIds: ['item-a', 'item-b', 'item-c'] });

    expect(fake.removeChannel).toHaveBeenCalledTimes(1);
    expect(fake.removeChannel).toHaveBeenCalledWith(first);
    expect(fake.channel).toHaveBeenCalledTimes(2);
    expect(lastChannel()).not.toBe(first);
    expect(binding('item_claims', 'INSERT').cfg.filter).toBe('item_id=in.(item-a,item-b,item-c)');
    // removeChannel ran before the new channel was created
    expect(fake.removeChannel.mock.invocationCallOrder[0]).toBeLessThan(
      fake.channel.mock.invocationCallOrder[1]
    );
  });

  it('item_claims DELETE notifies only for a known claim id', () => {
    const { props } = setup();
    fire('item_claims', 'DELETE', { old: { id: 'c-unknown' } });
    expect(props.onChange).not.toHaveBeenCalled();
    fire('item_claims', 'DELETE', { old: { id: 'c-2' } });
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('item_claims DELETE sees claim ids updated after subscribe', () => {
    const { rerender, props } = setup();
    rerender({ ...props, claimIds: ['c-new'] });
    fire('item_claims', 'DELETE', { old: { id: 'c-1' } });
    expect(props.onChange).not.toHaveBeenCalled();
    fire('item_claims', 'DELETE', { old: { id: 'c-new' } });
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('participants DELETE notifies only for a known participant id', () => {
    const { props } = setup();
    fire('participants', 'DELETE', { old: { id: 'p-unknown' } });
    expect(props.onChange).not.toHaveBeenCalled();
    fire('participants', 'DELETE', { old: { id: 'p-1' } });
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('bill_items DELETE notifies only for a known item id', () => {
    const { props } = setup();
    fire('bill_items', 'DELETE', { old: { id: 'item-unknown' } });
    expect(props.onChange).not.toHaveBeenCalled();
    fire('bill_items', 'DELETE', { old: { id: 'item-a' } });
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('bills DELETE notifies only when old.id is this bill', () => {
    const { props } = setup();
    fire('bills', 'DELETE', { old: { id: 'other-bill' } });
    expect(props.onChange).not.toHaveBeenCalled();
    fire('bills', 'DELETE', { old: { id: BILL_ID } });
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('filtered participants INSERT calls onChange', () => {
    const { props } = setup();
    fire('participants', 'INSERT', { new: { id: 'p-3', bill_id: BILL_ID } });
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('calls the latest onChange after a rerender with a new callback', () => {
    const { rerender, props } = setup();
    const next = vi.fn();
    rerender({ ...props, onChange: next });
    fire('participants', 'INSERT', { new: { id: 'p-3' } });
    expect(props.onChange).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('with more than 100 items, claim upserts are unfiltered and gated by item id', () => {
    const itemIds = Array.from({ length: 101 }, (_, i) => `item-${i}`);
    const { props } = setup({ itemIds });

    expect(binding('item_claims', 'INSERT').cfg.filter).toBeUndefined();
    expect(binding('item_claims', 'UPDATE').cfg.filter).toBeUndefined();

    fire('item_claims', 'INSERT', { new: { id: 'c-9', item_id: 'not-ours' } });
    fire('item_claims', 'UPDATE', { new: { id: 'c-9', item_id: 'not-ours' } });
    fire('item_claims', 'INSERT', { new: { id: 'c-9' } });
    expect(props.onChange).not.toHaveBeenCalled();

    fire('item_claims', 'INSERT', { new: { id: 'c-9', item_id: 'item-50' } });
    expect(props.onChange).toHaveBeenCalledTimes(1);
    fire('item_claims', 'UPDATE', { new: { id: 'c-9', item_id: 'item-100' } });
    expect(props.onChange).toHaveBeenCalledTimes(2);
  });

  it('catches up when the document becomes visible', () => {
    const { props } = setup();

    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(props.onChange).not.toHaveBeenCalled();

    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('catches up when the window comes back online', () => {
    const { props } = setup();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores the first SUBSCRIBED and catches up on later ones', () => {
    const { props } = setup();
    fireStatus('SUBSCRIBED');
    expect(props.onChange).not.toHaveBeenCalled();
    fireStatus('CHANNEL_ERROR');
    expect(props.onChange).not.toHaveBeenCalled();
    fireStatus('SUBSCRIBED');
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('cleans up on unmount', () => {
    const { unmount, props } = setup();
    const ch = lastChannel();
    unmount();

    expect(fake.removeChannel).toHaveBeenCalledWith(ch);
    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('subscribes nothing when billId is null', () => {
    const { props } = setup({ billId: null });
    expect(fake.channel).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
