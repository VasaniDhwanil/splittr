import { describe, expect, it } from 'vitest';
import { formatTimeLeft, splitMineRows, tokenErrorMessage } from '@/lib/agent-ui';

describe('splitMineRows', () => {
  it('sends pending rows away from the normal list', () => {
    const { normal, pending } = splitMineRows([
      { id: 'a', approval: 'none' as const },
      { id: 'b', approval: 'pending' as const },
    ]);
    expect(normal.map((r) => r.id)).toEqual(['a']);
    expect(pending.map((r) => r.id)).toEqual(['b']);
  });

  it('treats rows without the new fields as normal', () => {
    const { normal, pending } = splitMineRows([{ id: 'old-1' }, { id: 'old-2' }]);
    expect(normal).toHaveLength(2);
    expect(pending).toHaveLength(0);
  });
});

describe('tokenErrorMessage', () => {
  it.each([
    'wrong_code',
    'expired',
    'no_pending',
    'too_many_attempts',
    'token_limit',
    'locked',
    'rate_limited',
    'email_unavailable',
  ])('has its own message for %s', (code) => {
    const text = tokenErrorMessage(code, { attempts_left: 3, retry_after: 600 });
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toContain('—');
    expect(text).not.toBe(tokenErrorMessage('something_else'));
  });

  it('says how many tries are left and how long to wait', () => {
    expect(tokenErrorMessage('wrong_code', { attempts_left: 2 })).toContain('2 tries left');
    expect(tokenErrorMessage('wrong_code', { attempts_left: 1 })).toContain('1 try left');
    expect(tokenErrorMessage('rate_limited', { retry_after: 1500 })).toContain('25 minutes');
  });
});

describe('formatTimeLeft', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  it('speaks in minutes and hours', () => {
    expect(formatTimeLeft('2026-01-01T00:25:00Z', now)).toBe('in 25 minutes');
    expect(formatTimeLeft('2026-01-01T05:00:00Z', now)).toBe('in 5 hours');
    expect(formatTimeLeft('2025-12-31T00:00:00Z', now)).toBe('now');
  });
});
