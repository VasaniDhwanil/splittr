import { describe, expect, it } from 'vitest';
import { approvalState, isPublished } from '@/lib/bill-visibility';
import { loadBillPreview } from '@/lib/bill-preview';

describe('isPublished', () => {
  it('is true for a row that does not have the approval columns (before the migration)', () => {
    expect(isPublished({})).toBe(true);
    expect(isPublished({ name: 'old bill' } as never)).toBe(true);
  });

  it('is true unless approval is required and not yet given', () => {
    expect(isPublished({ approval_required: false, approved_at: null })).toBe(true);
    expect(isPublished({ approval_required: true, approved_at: '2026-11-20T00:00:00Z' })).toBe(true);
    expect(isPublished({ approval_required: true, approved_at: null })).toBe(false);
    expect(isPublished({ approval_required: true })).toBe(false);
  });
});

describe('approvalState (for /api/bills/mine)', () => {
  const NOW = Date.parse('2026-11-20T12:00:00Z');

  it('a row from a database without the columns is a plain web bill', () => {
    expect(approvalState({}, NOW)).toEqual({
      approval: 'none',
      created_via: 'web',
      approval_expires_at: null,
      listed: true,
    });
  });

  it('a pending proposal is listed until it expires', () => {
    const row = { approval_required: true, approved_at: null, created_via: 'agent', approval_expires_at: '2026-11-21T00:00:00Z' };
    expect(approvalState(row, NOW)).toEqual({
      approval: 'pending',
      created_via: 'agent',
      approval_expires_at: '2026-11-21T00:00:00Z',
      listed: true,
    });
    expect(approvalState({ ...row, approval_expires_at: '2026-11-20T11:59:59Z' }, NOW).listed).toBe(false);
  });

  it('an approved agent bill is none, and keeps created_via', () => {
    const row = { approval_required: true, approved_at: '2026-11-20T01:00:00Z', created_via: 'agent', approval_expires_at: '2026-11-21T00:00:00Z' };
    expect(approvalState(row, NOW)).toMatchObject({ approval: 'none', created_via: 'agent', listed: true });
  });
});

/** A Supabase-shaped stub that answers each select() with the next canned reply. */
function stubDb(replies: { data: unknown; error: { code: string } | null }[]) {
  const selects: string[] = [];
  const db = {
    from: () => ({
      select: (columns: string) => {
        selects.push(columns);
        const reply = replies.shift()!;
        const chain = { eq: () => chain, maybeSingle: async () => reply };
        return chain;
      },
    }),
  };
  return { db: db as never, selects };
}

const ID = '3f1c2a52-6f67-4f0e-9d7f-0d9c8f6f9a11';
const row = { name: ' Dinner ', subtotal: 10, tax: 1, tip_amount: 2, participants: [{ name: 'Sam', is_creator: true }] };

describe('loadBillPreview', () => {
  it('retries without the approval columns when the database does not have them yet (42703)', async () => {
    const { db, selects } = stubDb([
      { data: null, error: { code: '42703' } },
      { data: row, error: null },
    ]);
    const preview = await loadBillPreview(ID, db);
    expect(selects).toHaveLength(2);
    expect(selects[0]).toMatch(/approval_required/);
    expect(selects[1]).not.toMatch(/approval/);
    expect(preview).toMatchObject({ name: 'Dinner', host: 'Sam', count: 1, total: 13 });
  });

  it('does not retry on other errors, and answers null', async () => {
    const { db, selects } = stubDb([{ data: null, error: { code: '57014' } }]);
    expect(await loadBillPreview(ID, db)).toBeNull();
    expect(selects).toHaveLength(1);
  });

  it('answers null for a bill that is waiting for approval', async () => {
    const { db } = stubDb([{ data: { ...row, approval_required: true, approved_at: null }, error: null }]);
    expect(await loadBillPreview(ID, db)).toBeNull();
  });

  it('answers null for anything that is not a uuid, without querying', async () => {
    const { db, selects } = stubDb([]);
    expect(await loadBillPreview('ABC123', db)).toBeNull();
    expect(selects).toHaveLength(0);
  });
});
