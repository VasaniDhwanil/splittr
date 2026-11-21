import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/agent-bills/[id]/route';
import { POST as approve } from '@/app/api/agent-bills/[id]/approve/route';
import { POST as decline } from '@/app/api/agent-bills/[id]/decline/route';
import { GET as billGet } from '@/app/api/bills/[id]/route';
import { enableAgentAccess, insertProposal, insertToken } from './helpers/agent';
import { createUser, db, params, request, uuid } from './helpers/db';
import { callTool } from './helpers/mcp';
import { signInAs, signOut, type TestUser } from './helpers/session';

let restoreEnv: () => void;
beforeAll(() => {
  restoreEnv = enableAgentAccess();
});
afterAll(() => restoreEnv());

let owner: TestUser;
let stranger: TestUser;
let token: string;
let tokenId: string;

beforeEach(async () => {
  signOut();
  owner = await createUser('owner', 'Olive Owner');
  stranger = await createUser('stranger');
  const t = await insertToken(owner, { name: 'Claude on my laptop', scopes: ['read', 'bills:write'] });
  token = t.token;
  tokenId = t.id;
});

const SAME_SITE = { origin: 'http://localhost:3000' };
const propose = async (args: Record<string, unknown> = {}) => {
  const res = await callTool(token, 'create_bill', {
    name: 'Team dinner',
    items: [
      { name: 'Pasta', price: 18.5, quantity: 1 },
      { name: 'Beer', price: 7, quantity: 2 },
    ],
    tax: 3,
    tip_amount: 5,
    ...args,
  });
  if (res.isError || !res.data) throw new Error(`propose failed: ${res.message}`);
  return res.data.bill_id as string;
};

const get = (id: string, headers: Record<string, string> = {}) => GET(request('GET', `/api/agent-bills/${id}`, { headers }), params({ id }));
const post = (action: typeof approve, name: 'approve' | 'decline', id: string, headers: Record<string, string> = SAME_SITE) =>
  action(request('POST', `/api/agent-bills/${id}/${name}`, { headers }), params({ id }));
const doApprove = (id: string, headers?: Record<string, string>) => post(approve, 'approve', id, headers);
const doDecline = (id: string, headers?: Record<string, string>) => post(decline, 'decline', id, headers);
const row = async (id: string) => (await db().from('bills').select('*').eq('id', id).maybeSingle()).data;
const outcomes = async () =>
  (await db().from('agent_audit_log').select('tool, outcome, user_id').eq('token_id', tokenId).eq('tool', 'approval').order('id')).data!;
const expire = (id: string) =>
  db().from('bills').update({ approval_expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', id);

describe('GET /api/agent-bills/[id]', () => {
  it('shows the creator what the agent proposed', async () => {
    const id = await propose();
    signInAs(owner);
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    const bill = (await row(id))!;
    expect(body).toEqual({
      id,
      name: 'Team dinner',
      items: [
        { name: 'Pasta', price: 18.5, quantity: 1 },
        { name: 'Beer', price: 7, quantity: 2 },
      ],
      subtotal: 32.5,
      tax: 3,
      tip_amount: 5,
      total: 40.5,
      split_mode: 'items',
      created_at: bill.created_at,
      expires_at: bill.approval_expires_at,
      token_name: 'Claude on my laptop',
      warnings: [],
    });
  });

  it('is 401 without a session and 404 for anyone but the creator', async () => {
    const id = await propose();
    expect((await get(id)).status).toBe(401);
    signInAs(stranger);
    const other = await get(id);
    signInAs(owner);
    const ghost = await get(uuid());
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual(await ghost.json());
  });

  it('is 404 for an approved bill, an expired one, a missing one and a malformed id', async () => {
    signInAs(owner);
    const approved = await propose({ name: 'Approved' });
    await db().from('bills').update({ approved_at: new Date().toISOString() }).eq('id', approved);
    const expired = await propose({ name: 'Expired' });
    await expire(expired);
    for (const id of [approved, expired, uuid(), 'not-a-uuid', 'ABC123']) {
      expect((await get(id)).status).toBe(404);
    }
  });

  it('does not change anything', async () => {
    const id = await propose();
    const before = await row(id);
    signInAs(owner);
    await get(id);
    await get(id);
    expect(await row(id)).toEqual(before);
  });

  it('is 404 when agent access is off', async () => {
    const id = await propose();
    signInAs(owner);
    process.env.MCP_ENABLED = 'false';
    try {
      expect((await get(id)).status).toBe(404);
    } finally {
      process.env.MCP_ENABLED = 'true';
    }
  });

  it('flags names shaped like addresses and keys, and returns them as plain data', async () => {
    const id = await propose({
      name: 'Pay at https://evil.example/x',
      items: [
        { name: 'bob@example.com', price: 3, quantity: 1 },
        { name: 'spl_pat_abcdefghijklmnopqrstuvwxyz0123456789', price: 4, quantity: 1 },
        { name: '<b>Soup</b>', price: 5, quantity: 1 },
      ],
    });
    signInAs(owner);
    const body = await (await get(id)).json();
    expect(body.warnings).toHaveLength(3);
    expect(body.name).toBe('Pay at https://evil.example/x');
    expect(body.items[2].name).toBe('<b>Soup</b>');
  });

  it('survives the token being deleted: token_name is null', async () => {
    const id = await propose();
    await db().from('agent_tokens').delete().eq('id', tokenId);
    signInAs(owner);
    const res = await get(id);
    expect(res.status).toBe(200);
    expect((await res.json()).token_name).toBeNull();
  });
});

describe('approve', () => {
  it('needs a same-site Origin, then a session, then to be the creator', async () => {
    const id = await propose();
    signInAs(owner);
    expect((await doApprove(id, {})).status).toBe(403);
    expect((await doApprove(id, { origin: 'https://evil.example' })).status).toBe(403);
    signOut();
    expect((await doApprove(id)).status).toBe(401);
    signInAs(stranger);
    expect((await doApprove(id)).status).toBe(404);
    expect((await row(id))!.approved_at).toBeNull();
    expect(await outcomes()).toEqual([]);
  });

  it('publishes the bill, and the ordinary endpoints then serve it', async () => {
    const id = await propose();
    signInAs(owner);
    expect((await billGet(request('GET', `/api/bills/${id}`), params({ id }))).status).toBe(404);
    const res = await doApprove(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, bill_id: id });
    expect((await row(id))!.approved_at).not.toBeNull();
    expect((await billGet(request('GET', `/api/bills/${id}`), params({ id }))).status).toBe(200);
    expect(await outcomes()).toEqual([{ tool: 'approval', outcome: 'approval_approved', user_id: owner.id }]);
  });

  it('is 404 the second time, and for an approved web-style bill', async () => {
    const id = await propose();
    signInAs(owner);
    expect((await doApprove(id)).status).toBe(200);
    expect((await doApprove(id)).status).toBe(404);
    expect((await doApprove(uuid())).status).toBe(404);
    expect((await doApprove('nope')).status).toBe(404);
  });

  it('is 410 expired for an expired proposal, which stays unpublished', async () => {
    const id = await propose();
    await expire(id);
    signInAs(owner);
    const res = await doApprove(id);
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ code: 'expired' });
    expect((await row(id))!.approved_at).toBeNull();
  });

  it('only one of ten parallel approvals wins', async () => {
    const id = await propose();
    signInAs(owner);
    const statuses = (await Promise.all(Array.from({ length: 10 }, () => doApprove(id)))).map((r) => r.status).sort();
    expect(statuses).toEqual([200, ...Array(9).fill(404)]);
    expect((await outcomes()).filter((o) => o.outcome === 'approval_approved')).toHaveLength(1);
  });

  it('an approval racing a decline: exactly one of them wins', async () => {
    // Proposed up front: two or three declines would pause the token mid-test
    const ids = await Promise.all(Array.from({ length: 5 }, (_, round) => propose({ name: `Race ${round}` })));
    for (const id of ids) {
      signInAs(owner);
      const [a, d] = await Promise.all([doApprove(id), doDecline(id)]);
      expect([a.status, d.status].filter((s) => s === 200)).toHaveLength(1);
      const after = await row(id);
      if (a.status === 200) expect(after!.approved_at).not.toBeNull();
      else expect(after).toBeNull();
    }
  });

  it('is 404 when agent access is off', async () => {
    const id = await propose();
    signInAs(owner);
    process.env.MCP_ENABLED = 'false';
    try {
      expect((await doApprove(id)).status).toBe(404);
    } finally {
      process.env.MCP_ENABLED = 'true';
    }
    expect((await row(id))!.approved_at).toBeNull();
  });
});

describe('decline', () => {
  it('needs a same-site Origin, a session and to be the creator', async () => {
    const id = await propose();
    signInAs(owner);
    expect((await doDecline(id, {})).status).toBe(403);
    signOut();
    expect((await doDecline(id)).status).toBe(401);
    signInAs(stranger);
    expect((await doDecline(id)).status).toBe(404);
    expect(await row(id)).not.toBeNull();
    expect(await outcomes()).toEqual([]);
  });

  it('deletes the bill and its children, and logs the decline against the token', async () => {
    const id = await propose();
    signInAs(owner);
    const res = await doDecline(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await row(id)).toBeNull();
    expect((await db().from('bill_items').select('id').eq('bill_id', id)).data).toHaveLength(0);
    expect((await db().from('participants').select('id').eq('bill_id', id)).data).toHaveLength(0);
    expect(await outcomes()).toEqual([{ tool: 'approval', outcome: 'approval_declined', user_id: owner.id }]);
    expect((await doDecline(id)).status).toBe(404);
  });

  it('is 404 for an approved bill, which stays', async () => {
    const id = await propose();
    signInAs(owner);
    await doApprove(id);
    expect((await doDecline(id)).status).toBe(404);
    expect(await row(id)).not.toBeNull();
  });

  it('deletes an expired proposal and answers 200', async () => {
    const id = await propose();
    await expire(id);
    signInAs(owner);
    expect((await doDecline(id)).status).toBe(200);
    expect(await row(id)).toBeNull();
  });

  it('is 404 for a missing or malformed id, and when agent access is off', async () => {
    signInAs(owner);
    expect((await doDecline(uuid())).status).toBe(404);
    expect((await doDecline('x')).status).toBe(404);
    const id = await propose();
    process.env.MCP_ENABLED = 'false';
    try {
      expect((await doDecline(id)).status).toBe(404);
    } finally {
      process.env.MCP_ENABLED = 'true';
    }
    expect(await row(id)).not.toBeNull();
  });
});

describe('a proposal whose token was revoked', () => {
  it('answers 404 on GET, approve and decline and stays unapproved', async () => {
    const id = await propose();
    await db().from('agent_tokens').update({ revoked_at: new Date().toISOString(), revoked_reason: 'user' }).eq('id', tokenId);
    signInAs(owner);
    expect((await get(id)).status).toBe(404);
    expect((await doApprove(id)).status).toBe(404);
    expect((await doDecline(id)).status).toBe(404);
    const bill = (await row(id))!;
    expect(bill.approved_at).toBeNull();
    expect(await outcomes()).toEqual([]);
  });

  it('a live token proposal still approves', async () => {
    const id = await propose();
    signInAs(owner);
    expect((await doApprove(id)).status).toBe(200);
  });
});
