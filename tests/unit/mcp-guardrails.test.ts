// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AGENT_BILL_LIMITS, checkBillInput, nameWarnings } from '@/lib/mcp/guardrails';

const item = (name: string, price = 10, quantity = 1) => ({ name, price, quantity });

describe('input policy for agent-created bills', () => {
  it('passes an ordinary receipt with no warnings', () => {
    const result = checkBillInput({
      name: 'Dinner at Nopa',
      items: [item('Café Crème x2', 4.5, 2), item('#12 Burrito', 13), item('Desk-side salad', 11)],
      tax: 2.5,
      tip: 6,
    });
    expect(result).toEqual({ ok: true, warnings: [] });
  });

  it('refuses a total over the cap', () => {
    const result = checkBillInput({
      name: 'Big',
      items: [item('A', 900), item('B', 900), item('C', 300)],
      tax: 0,
      tip: 0,
    });
    expect(result).toMatchObject({ ok: false, code: 'total_cap' });
  });

  it('counts tax and tip toward the cap', () => {
    const result = checkBillInput({ name: 'Edge', items: [item('A', 999), item('B', 999)], tax: 2, tip: 1 });
    expect(result).toMatchObject({ ok: false, code: 'total_cap' });
    expect(checkBillInput({ name: 'Edge', items: [item('A', 999), item('B', 999)], tax: 1, tip: 1 }).ok).toBe(true);
  });

  it('refuses one unit price over the cap', () => {
    const result = checkBillInput({ name: 'Pricey', items: [item('Wine', 1000.01)], tax: 0, tip: 0 });
    expect(result).toMatchObject({ ok: false, code: 'unit_price_cap' });
  });

  it('refuses too many items', () => {
    const items = Array.from({ length: AGENT_BILL_LIMITS.maxItems + 1 }, (_, i) => item(`Item ${i}`, 1));
    expect(checkBillInput({ name: 'Long', items, tax: 0, tip: 0 })).toMatchObject({ ok: false, code: 'too_many_items' });
  });

  it('gives a reason a person can act on', () => {
    const result = checkBillInput({ name: 'Big', items: [item('A', 1500)], tax: 0, tip: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/\$1,000/);
  });
});

describe('names that look like something other than a receipt line', () => {
  it('are flagged, never refused', () => {
    const result = checkBillInput({
      name: 'see https://evil.example/x',
      items: [
        item('sk-abcdefghijklmnopqrstuvwxyz123456'),
        item('mail bob@example.com'),
        item('call 415-555-0199'),
        item('spl_pat_' + 'A'.repeat(43)),
      ],
      tax: 0,
      tip: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('describe what they noticed', () => {
    expect(nameWarnings(['visit www.example.com'])[0]).toMatch(/web address/i);
    expect(nameWarnings(['bob@example.com'])[0]).toMatch(/email/i);
    expect(nameWarnings(['ghp_abcdefghijklmnopqrstuvwxyz0123456789'])[0]).toMatch(/key|token|secret/i);
  });

  it('stay quiet for SKUs and long plain words', () => {
    expect(nameWarnings(['0012345678905 Oat milk'])).toEqual([]);
    expect(nameWarnings(['Donaudampfschifffahrtsgesellschaft'])).toEqual([]);
    expect(nameWarnings(['Desk-side salad', 'Risk-free refill'])).toEqual([]);
  });
});
