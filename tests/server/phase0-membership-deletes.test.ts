import { beforeEach, describe, expect, it } from 'vitest';
import { DELETE as deleteGroup } from '@/app/api/groups/[id]/route';
import { createGroup, createUser, params, request, sql } from './helpers/db';
import { signInAs, signOut } from './helpers/session';

// Migration 015 logs a "left" event whenever a group_members row is deleted.
// When the row goes because its group or its account is being deleted, that
// insert must be skipped, or the delete itself fails on a foreign key.

beforeEach(() => signOut());

const events = (where: string, id: string) =>
  sql<{ n: string }>(`select count(*) n from group_membership_events where ${where} = $1`, [id]).then((rows) => Number(rows[0].n));

describe('membership history when parents are deleted', () => {
  it('deleting a group as its owner succeeds and leaves no events behind', async () => {
    const owner = await createUser('owner');
    const member = await createUser('member');
    const group = await createGroup(owner, [member]);
    expect(await events('group_id', group.id)).toBe(2); // two "joined" rows

    signInAs(owner);
    const res = await deleteGroup(request('DELETE', `/api/groups/${group.id}`), params({ id: group.id }));
    expect(res.status).toBe(200);

    expect((await sql('select 1 from groups where id = $1', [group.id])).length).toBe(0);
    expect((await sql('select 1 from group_members where group_id = $1', [group.id])).length).toBe(0);
    expect(await events('group_id', group.id)).toBe(0);
    // the member's account is untouched
    expect((await sql('select 1 from auth.users where id = $1', [member.id])).length).toBe(1);
  });

  it('deleting an account that owns a group succeeds and leaves no events for it or its group', async () => {
    const owner = await createUser('owner');
    const member = await createUser('member');
    const group = await createGroup(owner, [member]);
    const elsewhere = await createGroup(member, [owner]); // the owner is also a member of another group
    expect(await events('user_id', owner.id)).toBe(2);

    await sql('delete from auth.users where id = $1', [owner.id]);

    expect((await sql('select 1 from groups where id = $1', [group.id])).length).toBe(0);
    expect(await events('group_id', group.id)).toBe(0);
    expect(await events('user_id', owner.id)).toBe(0);
    // the other group survives, with the remaining member's history intact and nothing for the deleted account
    expect((await sql('select 1 from groups where id = $1', [elsewhere.id])).length).toBe(1);
    expect((await sql('select 1 from group_members where group_id = $1 and user_id = $2', [elsewhere.id, owner.id])).length).toBe(0);
    expect(await events('group_id', elsewhere.id)).toBe(1);
  });

  it('a plain leave still logs one "left" event', async () => {
    const owner = await createUser('owner');
    const member = await createUser('member');
    const group = await createGroup(owner, [member]);
    await sql('delete from group_members where group_id = $1 and user_id = $2', [group.id, member.id]);
    const rows = await sql<{ event: string }>('select event from group_membership_events where group_id = $1 and user_id = $2 order by created_at, id', [group.id, member.id]);
    expect(rows.map((r) => r.event)).toEqual(['joined', 'left']);
  });
});
