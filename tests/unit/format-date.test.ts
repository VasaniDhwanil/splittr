import { describe, expect, it } from 'vitest';
import { formatRelativeDate } from '@/lib/format-date';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe('formatRelativeDate', () => {
  it('returns "just now" for under a minute', () => {
    expect(formatRelativeDate(ago(30 * SECOND), NOW)).toBe('just now');
  });

  it('returns "yesterday" for one day ago', () => {
    expect(formatRelativeDate(ago(DAY), NOW)).toBe('yesterday');
  });

  it('returns "3 days ago"', () => {
    expect(formatRelativeDate(ago(3 * DAY), NOW)).toBe('3 days ago');
  });

  it('returns "2 months ago"', () => {
    expect(formatRelativeDate(ago(60 * DAY), NOW)).toBe('2 months ago');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatRelativeDate('not a date', NOW)).toBe('');
  });
});
