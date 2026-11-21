/**
 * The access matrix in mcp-authz.test.ts also passes when a query loses its
 * actor or published filter, because the code re-checks every row afterwards.
 * This file looks at the requests themselves: every PostgREST call for bills
 * must carry the actor and the published filter in its own URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded = vi.hoisted(() => ({ urls: [] as string[] }));

vi.mock('@/lib/supabase/admin', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/supabase/admin')>();
  const { createClient } = await import('@supabase/supabase-js');
  let client: ReturnType<typeof createClient> | null = null;
  return {
    ...real,
    createAdminClient: () =>
      (client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            recorded.urls.push(decodeURIComponent(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url));
            return fetch(input, init);
          },
        },
      })),
  };
});

import { enableAgentAccess, insertToken } from './helpers/agent';
import { createBill, createGroup, createUser, joinBill, uuid } from './helpers/db';
import { callTool } from './helpers/mcp';
import type { TestUser } from './helpers/session';

const PUBLISHED = 'or=(approval_required.eq.false,approved_at.not.is.null)';
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

let restoreEnv: () => void;
beforeAll(() => {
  restoreEnv = enableAgentAccess();
});
afterAll(() => restoreEnv());

let actor: TestUser;
let stranger: TestUser;
let token: string;
let groupId: string;
let billId: string;
let foreignBillId: string;

beforeAll(async () => {
  actor = await createUser('actor');
  stranger = await createUser('stranger');
  const owner = await createUser('owner');
  groupId = (await createGroup(owner, [actor])).id;
  token = (await insertToken(actor)).token;
  billId = (await createBill({ creator: actor })).id;
  const groupBill = await createBill({ creator: owner, groupId });
  await joinBill(groupBill.id, { name: 'Me', user: actor });
  foreignBillId = (await createBill({ creator: stranger })).id;
});

beforeEach(() => {
  recorded.urls.length = 0;
});

const billRequests = () => recorded.urls.filter((url) => /\/rest\/v1\/bills\?/.test(url));

/** The URL names the actor, or a group the actor is in, and the published filter. */
function expectScoped(urls: string[]) {
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(url, url).toContain(PUBLISHED);
    const namesActor = url.includes(actor.id);
    const groupList = /group_id=in\.\(([^)]*)\)/.exec(url)?.[1];
    const onlyActorGroups = groupList !== undefined && (groupList.match(UUID_G) ?? []).every((id) => id === groupId);
    expect(namesActor || onlyActorGroups, url).toBe(true);
  }
}

describe('every bills query carries the actor and the published filter', () => {
  it('list_my_bills and list_my_expenses', async () => {
    await callTool(token, 'list_my_bills', {});
    expectScoped(billRequests());
    expect(billRequests().length).toBeGreaterThanOrEqual(3); // created, joined, via group

    recorded.urls.length = 0;
    const today = new Date().toISOString().slice(0, 10);
    await callTool(token, 'list_my_expenses', { from: today, to: today });
    expectScoped(billRequests());
  });

  it('get_bill for an own bill, a group bill, a stranger bill and an id that does not exist', async () => {
    for (const id of [billId, foreignBillId, uuid()]) {
      recorded.urls.length = 0;
      await callTool(token, 'get_bill', { bill_id: id });
      expectScoped(billRequests());
    }
  });

  it('get_balances, all and for one group', async () => {
    await callTool(token, 'get_balances', {});
    expectScoped(billRequests());
    recorded.urls.length = 0;
    await callTool(token, 'get_balances', { group_id: groupId });
    expectScoped(billRequests());
  });

  it('the recorder sees real requests, and a stranger token never reaches into the actor bills', async () => {
    const other = await insertToken(stranger);
    recorded.urls.length = 0;
    const res = await callTool(other.token, 'get_bill', { bill_id: billId });
    expect(res.isError).toBe(true);
    for (const url of billRequests()) expect(url).not.toContain(actor.id);
    expect(billRequests().every((url) => url.includes(stranger.id))).toBe(true);
  });
});
