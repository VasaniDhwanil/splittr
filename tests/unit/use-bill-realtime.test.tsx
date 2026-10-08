import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBillRealtime } from '@/hooks/use-bill-realtime';

// ---------------------------------------------------------------------------
// Fake Supabase realtime client
// ---------------------------------------------------------------------------

interface BindingConfig {
  event: string;
}

interface Binding {
  type: string;
  cfg: BindingConfig;
  cb: (payload: unknown) => void;
}

interface ChannelOptions {
  config?: { private?: boolean };
}

interface FakeChannel {
  topic: string;
  options: ChannelOptions | undefined;
  bindings: Binding[];
  statusCb: ((status: string) => void) | null;
  on: (type: string, cfg: BindingConfig, cb: (payload: unknown) => void) => FakeChannel;
  subscribe: (cb: (status: string) => void) => FakeChannel;
}

const fake = vi.hoisted(() => {
  const channels: FakeChannel[] = [];
  const channel = vi.fn((topic: string, options?: ChannelOptions): FakeChannel => {
    const ch: FakeChannel = {
      topic,
      options,
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

/** Ring the doorbell the way the DB trigger does: broadcast `changed`. */
function ring(payload: unknown = { table: 'item_claims', bill_id: BILL_ID }): void {
  const bindings = lastChannel().bindings.filter((b) => b.type === 'broadcast' && b.cfg.event === 'changed');
  if (bindings.length !== 1) throw new Error(`expected 1 doorbell binding, got ${bindings.length}`);
  act(() => {
    bindings[0].cb({ type: 'broadcast', event: 'changed', payload });
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
  onChange: () => void;
}

function setup(overrides: Partial<HookProps> = {}) {
  const initialProps: HookProps = { billId: BILL_ID, onChange: vi.fn(), ...overrides };
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
  it('subscribes once to the private bill:<id> doorbell and nothing else', () => {
    setup();
    expect(fake.channel).toHaveBeenCalledTimes(1);
    const ch = lastChannel();
    expect(ch.topic).toBe(`bill:${BILL_ID}`);
    expect(ch.options?.config?.private).toBe(true);
    expect(ch.bindings).toHaveLength(1);
    expect(ch.bindings[0]).toMatchObject({ type: 'broadcast', cfg: { event: 'changed' } });
    // No table subscriptions: clients can't read the tables any more
    expect(ch.bindings.some((b) => b.type === 'postgres_changes')).toBe(false);
  });

  it('calls onChange when the doorbell rings, for every table', () => {
    const { props } = setup();
    for (const table of ['bills', 'participants', 'bill_items', 'item_claims']) {
      ring({ table, bill_id: BILL_ID });
    }
    expect(props.onChange).toHaveBeenCalledTimes(4);
  });

  it('ignores a doorbell that names a different bill', () => {
    const { props } = setup();
    ring({ table: 'bills', bill_id: 'someone-else' });
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('still refetches on a doorbell without a payload (it only says "something changed")', () => {
    const { props } = setup();
    ring(undefined);
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it('does not resubscribe for a new onChange identity', () => {
    const { rerender, props } = setup();
    rerender({ ...props, onChange: vi.fn() });
    expect(fake.channel).toHaveBeenCalledTimes(1);
    expect(fake.removeChannel).not.toHaveBeenCalled();
  });

  it('calls the latest onChange after a rerender with a new callback', () => {
    const { rerender, props } = setup();
    const next = vi.fn();
    rerender({ ...props, onChange: next });
    ring();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('moves to the new bill when billId changes', () => {
    const { rerender, props } = setup();
    const first = lastChannel();
    rerender({ ...props, billId: 'bill-2' });
    expect(fake.removeChannel).toHaveBeenCalledWith(first);
    expect(lastChannel().topic).toBe('bill:bill-2');
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
