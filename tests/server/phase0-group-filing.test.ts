import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PATCH } from '@/app/api/bills/[id]/route';
import { POST as leaveGroup } from '@/app/api/groups/[id]/leave/route';
import { createBill, createGroup, createUser, db, params, request, sql } from './helpers/db';
import { signInAs, signOut, type TestUser } from './helpers/session';

// P1: a bill may only be filed into a group by a signed-in member of that
// group. Holding the bill's creator token is not enough.

let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let group: { id: string };

const groupOf = async (billId: string) => {
  const { data } = await db().from('bills').select('group_id, paid_by_user_id').eq('id', billId).single();
  return data!;
};

const patch = (billId: string, body: unknown, headers: Record<string, string> = {}) =>
  PATCH(request('PATCH', `/api/bills/${billId}`, { body, headers }), params({ id: billId }));

beforeAll(async () => {
  owner = await createUser('owner');
  member = await createUser('member');
  outsider = await createUser('outsider');
  group = await createGroup(owner, [member]);
});

beforeEach(() => signOut());

describe('filing a bill into a group', () => {
  it('refuses a caller who only holds the creator token', async () => {
    const bill = await createBill();
    const res = await patch(bill.id, { group_id: group.id }, { 'X-Creator-Token': bill.creatorToken });
    expect(res.status).toBe(403);
    expect((await groupOf(bill.id)).group_id).toBeNull();
  });

  it('refuses a signed-in bill owner who is not a member of the group', async () => {
    const bill = await createBill({ creator: outsider });
    signInAs(outsider);
    const res = await patch(bill.id, { group_id: group.id });
    expect(res.status).toBe(403);
    expect((await groupOf(bill.id)).group_id).toBeNull();
  });

  it('refuses a group that does not exist the same way', async () => {
    const bill = await createBill({ creator: member });
    signInAs(member);
    const res = await patch(bill.id, { group_id: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(403);
    expect((await patch(bill.id, { group_id: 'not-a-uuid' })).status).toBe(400);
    expect((await groupOf(bill.id)).group_id).toBeNull();
  });

  it('lets a signed-in member file their own bill', async () => {
    const bill = await createBill({ creator: member });
    signInAs(member);
    const res = await patch(bill.id, { group_id: group.id });
    expect(res.status).toBe(200);
    expect((await groupOf(bill.id)).group_id).toBe(group.id);
  });

  it('still lets the owner take a bill out of a group, and forgets the payer', async () => {
    const bill = await createBill({ creator: member, groupId: group.id, extra: { paid_by_user_id: owner.id } });
    const res = await patch(bill.id, { group_id: null }, { 'X-Creator-Token': bill.creatorToken });
    expect(res.status).toBe(200);
    expect(await groupOf(bill.id)).toEqual({ group_id: null, paid_by_user_id: null });
  });

  it('leaves other edits by a token-only creator working', async () => {
    const bill = await createBill();
    const res = await patch(bill.id, { name: 'Renamed' }, { 'X-Creator-Token': bill.creatorToken });
    expect(res.status).toBe(200);
  });
});

describe('group membership history', () => {
  it('records joining and leaving', async () => {
    const joiner = await createUser('joiner');
    await db()
      .from('group_members')
      .insert({ group_id: group.id, user_id: joiner.id, display_name: 'Joiner', role: 'member' });
    signInAs(joiner);
    const res = await leaveGroup(request('POST', `/api/groups/${group.id}/leave`), params({ id: group.id }));
    expect(res.status).toBe(200);

    const events = await sql<{ event: string }>(
      'select event from public.group_membership_events where group_id = $1 and user_id = $2 order by created_at, id',
      [group.id, joiner.id]
    );
    expect(events.map((e) => e.event)).toEqual(['joined', 'left']);
  });
});

describe('audit of bills already filed in groups', () => {
  it('detaches only bills that cannot be legitimate and lists the rest for review', async () => {
    const leaver = await createUser('leaver');
    const stranger = await createUser('stranger');
    await db()
      .from('group_members')
      .insert({ group_id: group.id, user_id: leaver.id, display_name: 'Leaver', role: 'member' });

    const fromMember = await createBill({ creator: member, groupId: group.id });
    const fromLeaver = await createBill({ creator: leaver, groupId: group.id });
    await db().from('group_members').delete().eq('group_id', group.id).eq('user_id', leaver.id);
    // Planted after the fact by someone who was never in the group
    const planted = await createBill({ creator: stranger, groupId: group.id });
    // Planted and older than the group itself: no legitimate path creates this
    const impossible = await createBill({
      groupId: group.id,
      extra: { created_at: '2020-01-01T00:00:00Z' },
    });

    await sql('select public.audit_group_bills(true)');

    expect((await groupOf(fromMember.id)).group_id).toBe(group.id);
    expect((await groupOf(fromLeaver.id)).group_id).toBe(group.id);
    expect((await groupOf(planted.id)).group_id).toBe(group.id);
    expect((await groupOf(impossible.id)).group_id).toBeNull();

    const review = await sql<{ bill_id: string; action: string }>(
      'select bill_id, action from public.group_bill_review where group_id = $1',
      [group.id]
    );
    const byBill = new Map(review.map((r) => [r.bill_id, r.action]));
    expect(byBill.get(planted.id)).toBe('review');
    expect(byBill.get(impossible.id)).toBe('detached');
    expect(byBill.has(fromMember.id)).toBe(false);
    expect(byBill.has(fromLeaver.id)).toBe(false);
  });
});
