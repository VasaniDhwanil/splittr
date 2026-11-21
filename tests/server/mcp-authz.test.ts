import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enableAgentAccess, insertToken } from './helpers/agent';
import { createBill, createGroup, createUser, db, joinBill, uuid } from './helpers/db';
import { callTool } from './helpers/mcp';
import type { TestUser } from './helpers/session';

let restoreEnv: () => void;
beforeAll(() => {
  restoreEnv = enableAgentAccess();
});
afterAll(() => restoreEnv());

type Who = 'creator' | 'linked' | 'claimedCreator' | 'member' | 'former' | 'stranger' | 'otherGroup';

interface World {
  users: Record<Who, TestUser> & { owner: TestUser; outsider: TestUser };
  tokens: Record<Who, string>;
  groupId: string;
  otherGroupId: string;
  bills: Record<'own' | 'claimed' | 'group' | 'planted' | 'ownUnpublished', string>;
  ghost: string;
}

async function buildWorld(): Promise<World> {
  const [creator, linked, claimedCreator, member, former, stranger, otherGroup, owner, outsider] = await Promise.all(
    ['creator', 'linked', 'claimed', 'member', 'former', 'stranger', 'other', 'owner', 'outsider'].map((l) => createUser(l))
  );
  const group = await createGroup(owner, [member, former]);
  const other = await createGroup(otherGroup, []);
  // The former member leaves: the membership row is deleted
  await db().from('group_members').delete().eq('group_id', group.id).eq('user_id', former.id);

  const own = await createBill({ creator, name: 'Own dinner' });
  await joinBill(own.id, { name: 'Linked Friend', user: linked });
  await joinBill(own.id, { name: 'Zed Guest' });

  // A claimed bill: the host row was made anonymously, the account owns the bill
  const claimed = await createBill({ creator: null, name: 'Claimed bill', extra: { creator_user_id: claimedCreator.id } });

  const groupBill = await createBill({ creator: owner, name: 'Group lunch', groupId: group.id });
  const planted = await createBill({ creator: outsider, name: 'Planted bill', groupId: group.id });
  // (An unapproved bill in a group no longer exists: the database refuses it, see agent-bills-approval.test.ts)
  const ownUnpublished = await createBill({ creator, name: 'Waiting', extra: { approval_required: true, approved_at: null } });

  const users = { creator, linked, claimedCreator, member, former, stranger, otherGroup, owner, outsider };
  const tokens = {} as Record<Who, string>;
  for (const who of ['creator', 'linked', 'claimedCreator', 'member', 'former', 'stranger', 'otherGroup'] as Who[]) {
    tokens[who] = (await insertToken(users[who])).token;
  }
  return {
    users,
    tokens,
    groupId: group.id,
    otherGroupId: other.id,
    bills: {
      own: own.id,
      claimed: claimed.id,
      group: groupBill.id,
      planted: planted.id,
      ownUnpublished: ownUnpublished.id,
    },
    ghost: uuid(),
  };
}

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});

type BillKey = keyof World['bills'];
// What each caller may open with get_bill. Planted bills follow the spec (D7):
// a current group member sees a bill filed under the group.
const CAN_OPEN: Record<Who, BillKey[]> = {
  creator: ['own'],
  linked: ['own'],
  claimedCreator: ['claimed'],
  member: ['group', 'planted'],
  former: [],
  stranger: [],
  otherGroup: [],
};
// list_my_bills shows the same set
const CAN_LIST = CAN_OPEN;
// list_my_expenses: only bills the caller has a row on
const CAN_EXPENSE: Record<Who, BillKey[]> = {
  creator: ['own'],
  linked: ['own'],
  claimedCreator: ['claimed'],
  member: [],
  former: [],
  stranger: [],
  otherGroup: [],
};

const WHO = Object.keys(CAN_OPEN) as Who[];
const BILL_KEYS = ['own', 'claimed', 'group', 'planted', 'ownUnpublished'] as BillKey[];

describe('get_bill', () => {
  for (const who of WHO) {
    it(`${who}: opens exactly the bills they are related to`, async () => {
      for (const key of BILL_KEYS) {
        const res = await callTool(w.tokens[who], 'get_bill', { bill_id: w.bills[key] });
        if (CAN_OPEN[who].includes(key)) {
          expect(res.isError, `${who} should open ${key}`).toBe(false);
          expect(res.data.id).toBe(w.bills[key]);
        } else {
          expect(res.isError, `${who} must not open ${key}`).toBe(true);
          expect(res.message).toBe('Bill not found');
        }
      }
    });
  }

  it('an unrelated bill and a nonexistent id give byte-identical results', async () => {
    for (const who of ['stranger', 'former', 'otherGroup'] as Who[]) {
      const real = await callTool(w.tokens[who], 'get_bill', { bill_id: w.bills.own });
      const ghost = await callTool(w.tokens[who], 'get_bill', { bill_id: w.ghost });
      expect(real.isError).toBe(true);
      expect(real.text.replace(/"id":\d+/, '')).toBe(ghost.text.replace(/"id":\d+/, ''));
    }
  });

  it('unpublished bills are hidden from everyone, their own creator included', async () => {
    for (const who of WHO) {
      for (const key of ['ownUnpublished'] as BillKey[]) {
        const res = await callTool(w.tokens[who], 'get_bill', { bill_id: w.bills[key] });
        expect(res.isError).toBe(true);
      }
    }
  });

  it('a bill becomes visible once approved', async () => {
    await db().from('bills').update({ approved_at: new Date().toISOString() }).eq('id', w.bills.ownUnpublished);
    try {
      expect((await callTool(w.tokens.creator, 'get_bill', { bill_id: w.bills.ownUnpublished })).isError).toBe(false);
    } finally {
      await db().from('bills').update({ approved_at: null }).eq('id', w.bills.ownUnpublished);
    }
  });

  it('a former member loses a bill once they leave, a current member keeps it', async () => {
    // former was never able to see it; re-adding and removing shows the live check
    await db().from('group_members').insert({ group_id: w.groupId, user_id: w.users.former.id, display_name: 'Former', role: 'member' });
    expect((await callTool(w.tokens.former, 'get_bill', { bill_id: w.bills.group })).isError).toBe(false);
    await db().from('group_members').delete().eq('group_id', w.groupId).eq('user_id', w.users.former.id);
    expect((await callTool(w.tokens.former, 'get_bill', { bill_id: w.bills.group })).isError).toBe(true);
  });
});

describe('list_my_bills', () => {
  for (const who of WHO) {
    it(`${who}: lists only related, published bills`, async () => {
      const res = await callTool(w.tokens[who], 'list_my_bills', { limit: 50 });
      const ids = (res.data.bills as { id: string }[]).map((b) => b.id).sort();
      expect(ids).toEqual(CAN_LIST[who].map((k) => w.bills[k]).sort());
    });
  }

  it('reports the right role for each relation', async () => {
    const roleOf = async (who: Who) => (await callTool(w.tokens[who], 'list_my_bills')).data.bills[0]?.role;
    expect(await roleOf('creator')).toBe('creator');
    expect(await roleOf('claimedCreator')).toBe('creator');
    expect(await roleOf('linked')).toBe('participant');
    expect(await roleOf('member')).toBe('group_member');
  });

  it('honours limit and status', async () => {
    const mine = await callTool(w.tokens.member, 'list_my_bills', { limit: 1 });
    expect(mine.data.bills).toHaveLength(1);
    expect((await callTool(w.tokens.creator, 'list_my_bills', { status: 'settled' })).data.bills).toEqual([]);
    expect((await callTool(w.tokens.creator, 'list_my_bills', { status: 'active' })).data.bills).toHaveLength(1);
  });
});

describe('list_my_groups', () => {
  it('lists current memberships only', async () => {
    const names = async (who: Who) => (await callTool(w.tokens[who], 'list_my_groups')).data.groups as { id: string; member_count: number; role: string }[];
    expect((await names('member')).map((g) => g.id)).toEqual([w.groupId]);
    expect((await names('member'))[0]).toMatchObject({ member_count: 2, role: 'member' });
    expect((await names('otherGroup')).map((g) => g.id)).toEqual([w.otherGroupId]);
    expect((await names('otherGroup'))[0].role).toBe('owner');
    for (const who of ['former', 'stranger', 'creator', 'linked', 'claimedCreator'] as Who[]) expect(await names(who)).toEqual([]);
  });
});

describe('get_balances', () => {
  it('a group id the caller is not in looks exactly like one that does not exist', async () => {
    for (const who of ['former', 'stranger', 'creator', 'otherGroup'] as Who[]) {
      const real = await callTool(w.tokens[who], 'get_balances', { group_id: w.groupId });
      const ghost = await callTool(w.tokens[who], 'get_balances', { group_id: w.ghost });
      expect(real.isError).toBe(true);
      expect(real.message).toBe('Group not found');
      expect(real.text.replace(/"id":\d+/, '')).toBe(ghost.text.replace(/"id":\d+/, ''));
    }
  });

  it('a current member can ask for the group', async () => {
    const res = await callTool(w.tokens.member, 'get_balances', { group_id: w.groupId });
    expect(res.isError).toBe(false);
    expect(res.data.scope).toBe('group');
  });

  it('a stranger gets an empty ledger, not someone else\'s', async () => {
    const res = await callTool(w.tokens.stranger, 'get_balances');
    expect(res.data).toMatchObject({ scope: 'all', balances: [], unverified: [] });
  });
});

describe('list_my_expenses', () => {
  const range = { from: '2000-01-01', to: '2099-12-31' };
  for (const who of WHO) {
    it(`${who}: only bills they have a row on`, async () => {
      // the window is at most 366 days, so anchor on the seeded bills' own date
      const today = new Date().toISOString().slice(0, 10);
      const res = await callTool(w.tokens[who], 'list_my_expenses', { from: addDays(today, -30), to: addDays(today, 30) });
      expect(res.isError).toBe(false);
      const ids = (res.data.expenses as { bill_id: string }[]).map((e) => e.bill_id).sort();
      expect(ids).toEqual(CAN_EXPENSE[who].map((k) => w.bills[k]).sort());
    });
  }

  it('rejects a window over 366 days', async () => {
    expect((await callTool(w.tokens.creator, 'list_my_expenses', range)).isError).toBe(true);
  });

  it('excludes bills outside the window', async () => {
    const res = await callTool(w.tokens.creator, 'list_my_expenses', { from: '2001-01-01', to: '2001-12-31' });
    expect(res.data.expenses).toEqual([]);
    expect(res.data.total_my_share).toBe(0);
  });
});

function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
