import { beforeEach, describe, expect, it } from 'vitest';
import { POST as claimBills } from '@/app/api/bills/claim/route';
import { POST as join } from '@/app/api/participants/route';
import { createBill, createUser, db, joinBill, request, sql } from './helpers/db';
import { signInAs, signOut } from './helpers/session';

// P4: a signed-in person has at most one participant row per bill, and
// claiming an anonymous bill makes its host row theirs when that's unambiguous.

const rowsFor = async (billId: string) => {
  const { data } = await db()
    .from('participants')
    .select('id, user_id, is_creator, name, payment_status')
    .eq('bill_id', billId)
    .order('created_at');
  return data ?? [];
};

beforeEach(() => signOut());

describe('claiming an anonymous bill into an account', () => {
  it('links the host row to the claimer', async () => {
    const user = await createUser('claimer');
    const bill = await createBill();
    signInAs(user);
    const res = await claimBills(
      request('POST', '/api/bills/claim', {
        body: { claims: [{ bill_id: bill.id, creator_token: bill.creatorToken }] },
      })
    );
    expect(await res.json()).toEqual({ claimed: 1, failed: [] });

    const rows = await rowsFor(bill.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ is_creator: true, user_id: user.id });
  });

  it('leaves the host row alone when the claimer already joined as someone else', async () => {
    const user = await createUser('claimer');
    const bill = await createBill();
    const joined = await joinBill(bill.id, { name: 'Me', user });
    signInAs(user);
    const res = await claimBills(
      request('POST', '/api/bills/claim', {
        body: { claims: [{ bill_id: bill.id, creator_token: bill.creatorToken }] },
      })
    );
    expect(await res.json()).toEqual({ claimed: 1, failed: [] });

    const rows = await rowsFor(bill.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.is_creator)!.user_id).toBeNull();
    expect(rows.find((r) => r.id === joined.id)!.user_id).toBe(user.id);
  });

  it('changes nothing with a wrong token', async () => {
    const user = await createUser('claimer');
    const bill = await createBill();
    signInAs(user);
    const res = await claimBills(
      request('POST', '/api/bills/claim', {
        body: { claims: [{ bill_id: bill.id, creator_token: 'wrong' }] },
      })
    );
    expect(await res.json()).toEqual({ claimed: 0, failed: [bill.id] });
    expect((await rowsFor(bill.id))[0].user_id).toBeNull();
  });
});

describe('joining a bill while signed in', () => {
  it('creates one row even when two joins race', async () => {
    const user = await createUser('racer');
    const bill = await createBill();
    signInAs(user);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        join(request('POST', '/api/participants', { body: { bill_id: bill.id, name: 'Racer' } }))
      )
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const ids = new Set(await Promise.all(responses.map(async (r) => (await r.json()).id)));
    expect(ids.size).toBe(1);
    expect((await rowsFor(bill.id)).filter((r) => r.user_id === user.id)).toHaveLength(1);
  });
});

describe('merging duplicate rows left by earlier races', () => {
  it('keeps every claim and the most-paid status on one surviving row', async () => {
    const user = await createUser('dup');
    const bill = await createBill();
    const [pasta, beer] = bill.itemIds;

    // Duplicates can only exist without the unique index, so lift it for the
    // seeding and let the merge function prove it can be recreated.
    await sql('drop index if exists public.participants_bill_user_unique');
    try {
      const first = await joinBill(bill.id, { name: 'Dup', user });
      const second = await joinBill(bill.id, { name: 'Dup (2)', user });
      await db().from('participants').update({ payment_status: 'paid', paid_at: new Date().toISOString() }).eq('id', second.id);
      await db().from('item_claims').insert([
        { participant_id: first.id, item_id: pasta, share: 0.5 },
        { participant_id: second.id, item_id: pasta, share: 1 },
        { participant_id: second.id, item_id: beer, share: 2 },
      ]);

      const [{ merged }] = await sql<{ merged: number }>('select public.merge_duplicate_participants() as merged');
      expect(Number(merged)).toBeGreaterThanOrEqual(1);

      const mine = (await rowsFor(bill.id)).filter((r) => r.user_id === user.id);
      expect(mine).toHaveLength(1);
      expect(mine[0].id).toBe(first.id);
      expect(mine[0].payment_status).toBe('paid');

      const { data: claims } = await db()
        .from('item_claims')
        .select('item_id, share')
        .eq('participant_id', first.id);
      expect(new Map((claims ?? []).map((c) => [c.item_id, Number(c.share)]))).toEqual(
        new Map([
          [pasta, 1],
          [beer, 2],
        ])
      );
    } finally {
      await sql(
        'create unique index if not exists participants_bill_user_unique on public.participants (bill_id, user_id) where user_id is not null'
      );
    }
  });
});
