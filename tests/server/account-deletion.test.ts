import { describe, expect, it } from 'vitest';
import { createBill, createGroup, createUser, db, joinBill, sql } from './helpers/db';
import { billExists, insertProposal, insertToken } from './helpers/agent';

/**
 * Deleting an account through the auth admin API (what the Supabase dashboard
 * does) runs the cascade as supabase_auth_admin. SET NULL on bills fires the
 * doorbell trigger, which must not need that role to reach the realtime schema.
 */
async function deleteAccount(id: string) {
  const { error } = await db().auth.admin.deleteUser(id);
  expect(error).toBeNull();
  expect((await sql('select 1 from auth.users where id = $1', [id])).length).toBe(0);
}

const billRow = async (id: string) =>
  (await db().from('bills').select('id, creator_user_id, paid_by_user_id, group_id, agent_token_id').eq('id', id).single()).data!;

describe('deleting an account through the auth admin API', () => {
  it('works for a user who created a bill, and keeps the bill and its participants', async () => {
    const user = await createUser('creator');
    const bill = await createBill({ creator: user });
    const guest = await joinBill(bill.id, { name: 'Guest' });

    await deleteAccount(user.id);

    expect(await billRow(bill.id)).toMatchObject({ id: bill.id, creator_user_id: null });
    expect((await db().from('participants').select('id').eq('id', guest.id)).data).toHaveLength(1);
    expect((await db().from('bill_items').select('id').eq('bill_id', bill.id)).data).toHaveLength(2);
  });

  it('works for a user who is the payer of a group bill, and leaves the other members alone', async () => {
    const owner = await createUser('owner');
    const payer = await createUser('payer');
    const group = await createGroup(owner, [payer]);
    const bill = await createBill({ creator: owner, groupId: group.id, extra: { paid_by_user_id: payer.id } });

    await deleteAccount(payer.id);

    expect(await billRow(bill.id)).toMatchObject({ creator_user_id: owner.id, paid_by_user_id: null, group_id: group.id });
    expect((await db().from('group_members').select('user_id').eq('group_id', group.id)).data!.map((r) => r.user_id)).toEqual([owner.id]);
    expect((await sql('select 1 from auth.users where id = $1', [owner.id])).length).toBe(1);
  });

  it('works for a user who owns a group with members and a group bill', async () => {
    const owner = await createUser('owner');
    const member = await createUser('member');
    const group = await createGroup(owner, [member]);
    const elsewhere = await createGroup(member, [owner]);
    const bill = await createBill({ creator: owner, groupId: group.id });
    const memberBill = await createBill({ creator: member, groupId: group.id });

    await deleteAccount(owner.id);

    expect((await db().from('groups').select('id').eq('id', group.id)).data).toHaveLength(0);
    // the group's bills outlive it, detached
    expect(await billRow(bill.id)).toMatchObject({ creator_user_id: null, group_id: null });
    expect(await billRow(memberBill.id)).toMatchObject({ creator_user_id: member.id, group_id: null });
    // the other group and the member are intact
    expect((await db().from('groups').select('id').eq('id', elsewhere.id)).data).toHaveLength(1);
    expect((await db().from('group_members').select('user_id').eq('group_id', elsewhere.id).eq('user_id', member.id)).data).toHaveLength(1);
    expect((await sql('select 1 from auth.users where id = $1', [member.id])).length).toBe(1);
  });

  it('works for a user with agent tokens, a proposed bill and an approved agent bill', async () => {
    const user = await createUser('agent-owner');
    const other = await createUser('other');
    const token = await insertToken(user, { scopes: ['read', 'bills:write'] });
    const otherToken = await insertToken(other);
    const proposed = await insertProposal(user, token.id);
    const approved = await insertProposal(user, token.id, { approved: true });
    const othersBill = await insertProposal(other, otherToken.id, { approved: true });

    await deleteAccount(user.id);

    expect((await db().from('agent_tokens').select('id').eq('user_id', user.id)).data).toHaveLength(0);
    expect(await billExists(proposed)).toBe(true);
    expect(await billExists(approved)).toBe(true);
    expect(await billRow(approved)).toMatchObject({ creator_user_id: null, agent_token_id: null });
    expect(await billRow(proposed)).toMatchObject({ creator_user_id: null, agent_token_id: null });
    // someone else's token and bill are untouched
    expect((await db().from('agent_tokens').select('id').eq('id', otherToken.id)).data).toHaveLength(1);
    expect(await billRow(othersBill)).toMatchObject({ creator_user_id: other.id, agent_token_id: otherToken.id });
  });

  it('the doorbell still rings for an ordinary bill change', async () => {
    const bill = await createBill({});
    const rung = async () =>
      Number((await sql<{ n: string }>(
        `select count(*) n from realtime.messages where topic = $1 and event = 'changed'`,
        [`bill:${bill.id}`]
      ))[0].n);
    const before = await rung();
    const { error } = await db().from('bills').update({ name: 'Renamed' }).eq('id', bill.id);
    expect(error).toBeNull();
    expect(await rung()).toBeGreaterThan(before);
  });

  it('the doorbell function is still not callable by app roles', async () => {
    const rows = await sql<{ anon: boolean; authed: boolean; definer: boolean }>(
      `select has_function_privilege('anon', 'public.ring_bill_doorbell()', 'EXECUTE') anon,
              has_function_privilege('authenticated', 'public.ring_bill_doorbell()', 'EXECUTE') authed,
              prosecdef definer
         from pg_proc where oid = 'public.ring_bill_doorbell()'::regprocedure`
    );
    expect(rows[0]).toEqual({ anon: false, authed: false, definer: true });
    const auth = await sql<{ usage: boolean }>(`select has_schema_privilege('supabase_auth_admin', 'realtime', 'USAGE') usage`);
    expect(auth[0].usage).toBe(false);
  });
});
