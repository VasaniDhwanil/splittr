import { describe, expect, it } from 'vitest';
import { getInitials } from '@/components/avatar-initials';

describe('getInitials', () => {
  it('uses one letter for a single name', () => {
    expect(getInitials('sam')).toBe('S');
  });
  it('uses first and last word for full names', () => {
    expect(getInitials('Ada Lovelace')).toBe('AL');
    expect(getInitials('  Mary Jane Watson ')).toBe('MW');
  });
  it('ignores a trailing (n) counter', () => {
    expect(getInitials('Sam (2)')).toBe('S');
    expect(getInitials('Ada Lovelace (13)')).toBe('AL');
  });
  it('ignores non-letter characters', () => {
    expect(getInitials('(Sam)')).toBe('S');
    expect(getInitials('7 Sam')).toBe('S');
    expect(getInitials('Zoë')).toBe('Z');
  });
  it('falls back when there are no letters', () => {
    expect(getInitials('123')).toBe('?');
  });
});
