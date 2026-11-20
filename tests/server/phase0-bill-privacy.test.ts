import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/bills/[id]/route';
import { createBill, createGroup, createUser, db, joinBill, params, request, type TestBill } from './helpers/db';
import { signInAs, signOut, type TestUser } from './helpers/session';

// P5: a share link shows who is on a bill, not which accounts they are.

let host: TestUser;
let payer: TestUser;
let member: TestUser;
let outsider: TestUser;
let group: { id: string };
let bill: TestBill;
let payerRow: { id: string };
let memberRow: { id: string };

const read = async (id = bill.id) => {
  const res = await GET(request('GET', `/api/bills/${id}`), params({ id }));
  expect(res.status).toBe(200);
  return res.json();
};

const allUserIds = (body: { participants: { user_id: string | null }[] }) =>
  body.participants.map((p) => p.user_id).filter(Boolean);

beforeAll(async () => {
  host = await createUser('host');
  payer = await createUser('payer', 'Payer Pat');
  member = await createUser('member');
  outsider = await createUser('outsider');
  group = await createGroup(host, [payer, member]);
  await db().from('profiles').update({ venmo_handle: 'payer-pat' }).eq('user_id', payer.id);
  bill = await createBill({ creator: host, groupId: group.id, extra: { paid_by_user_id: payer.id } });
  payerRow = await joinBill(bill.id, { name: 'Payer Pat', user: payer });
  memberRow = await joinBill(bill.id, { name: 'Member', user: member });
  await joinBill(bill.id, { name: 'Walk-in' });
});

beforeEach(() => signOut());

describe('someone holding only the share link', () => {
  it('gets no account ids, group id or member list', async () => {
    const body = await read();
    expect(allUserIds(body)).toEqual([]);
    expect(body.creator_user_id ?? null).toBeNull();
    expect(body.paid_by_user_id ?? null).toBeNull();
    expect(body.group_id ?? null).toBeNull();
    expect(body.group_members).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(host.id);
    expect(JSON.stringify(body)).not.toContain(payer.id);
    expect(JSON.stringify(body)).not.toContain(member.id);
  });

  it('still learns who to pay, by participant', async () => {
    const body = await read();
    expect(body.paid_by).toMatchObject({
      participant_id: payerRow.id,
      name: expect.any(String),
      venmo_handle: 'payer-pat',
    });
    expect(body.paid_by.user_id).toBeUndefined();
  });

  it('never receives secrets', async () => {
    const body = await read(bill.shortCode);
    const text = JSON.stringify(body);
    expect(text).not.toContain('creator_token');
    expect(text).not.toContain('participant_token_hash');
    expect(text).not.toContain(bill.creatorToken);
  });
});

describe('a signed-in viewer', () => {
  it('who is on the bill sees only their own account id', async () => {
    signInAs(outsider);
    const outsiderBill = await createBill({ creator: host });
    const mine = await joinBill(outsiderBill.id, { name: 'Out', user: outsider });
    const body = await read(outsiderBill.id);
    expect(body.participants.find((p: { id: string }) => p.id === mine.id).user_id).toBe(outsider.id);
    expect(allUserIds(body)).toEqual([outsider.id]);
    expect(body.creator_user_id ?? null).toBeNull();
  });

  it('who is not in the bill’s group gets the same view as a link holder', async () => {
    signInAs(outsider);
    const body = await read();
    expect(allUserIds(body)).toEqual([]);
    expect(body.group_members).toBeUndefined();
    expect(body.group_id ?? null).toBeNull();
  });

  it('who is in the group gets what the payer picker needs', async () => {
    signInAs(member);
    const body = await read();
    expect(body.group_id).toBe(group.id);
    expect(body.creator_user_id).toBe(host.id);
    expect(body.paid_by_user_id).toBe(payer.id);
    expect(body.group_members.map((m: { user_id: string }) => m.user_id).sort()).toEqual(
      [host.id, payer.id, member.id].sort()
    );
    // Fellow members' accounts (the group ledger matches by account), never a walk-in's
    expect(allUserIds(body).sort()).toEqual([host.id, payer.id, member.id].sort());
    expect(body.participants.find((p: { id: string }) => p.id === memberRow.id).user_id).toBe(member.id);
  });
});

describe('a bill whose creator paid', () => {
  it('reports no separate payer', async () => {
    const plain = await createBill();
    const body = await read(plain.id);
    expect(body.paid_by).toBeNull();
  });
});
