import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as authCallback } from '@/app/auth/callback/route';
import { enableAgentAccess } from './helpers/agent';
import { createBill, createUser, db, joinBill, params, request, uuid } from './helpers/db';
import { DELETE as deleteBill, GET as getBill, PATCH as patchBill } from '@/app/api/bills/[id]/route';
import { POST as createBillRoute } from '@/app/api/bills/route';
import { DELETE as unclaim, POST as claim } from '@/app/api/claims/route';
import { POST as batchClaim } from '@/app/api/claims/batch/route';
import { DELETE as removeParticipant, PATCH as patchParticipant, POST as joinRoute } from '@/app/api/participants/route';
import { globalSignOut, signInAs, signInAsOAuthClient, signOut, type TestUser } from './helpers/session';

// R-O1, route by route. Every server test replaces @/lib/supabase/server with
// a stand-in (tests/server/helpers/session.ts) that applies the same guard as
// the real createClient() on top of a Supabase that, like the real one,
// resolves OAuth-client tokens to the user. The real wrapper is tested against
// a real local session in oauth-session-guard.test.ts. Here: a cookie holding
// an OAuth token must make every cookie-authenticated route answer exactly as
// if nobody were signed in.

const routeFiles = import.meta.glob('../../src/app/api/**/route.ts');

// Routes that use no session at all. Each is checked below to really not use one.
const NO_SESSION: Record<string, string> = {
  '/api/mcp': 'authenticates with a bearer token only (covered by mcp-authz tests)',
  '/api/scan': 'anonymous receipt scan, rate limited by IP',
  '/api/agent-tokens/revoke-link': 'the "not you?" link works without a session on purpose',
  '/api/oauth/token': 'our own OAuth token endpoint: public clients, no cookies (excluded from the proxy)',
  '/api/oauth/revoke': 'our own OAuth revocation endpoint: public clients, no cookies (excluded from the proxy)',
};
// Routes whose empty probe request is refused (validation, origin) before the
// session matters, so the check above cannot tell them apart from a guard that
// does nothing. They get stateful checks in the last describe below.
const BLIND_TO_EMPTY_REQUESTS: string[] = [
  '/api/bills',
  '/api/bills/[id]',
  '/api/claims',
  '/api/claims/batch',
  '/api/participants',
  // The consent APIs refuse an empty probe at the binding cookie; their
  // session guard is exercised in oauth-consent.test.ts
  '/api/agent-oauth/requests/[id]',
  '/api/agent-oauth/requests/[id]/approve',
  '/api/agent-oauth/requests/[id]/code',
  '/api/agent-oauth/requests/[id]/deny',
];
const SESSION_MACHINERY = /supabase\/server|guardAgentSession|auth-helpers/;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const ORIGIN = { origin: 'http://localhost:3000' };

const routes = Object.keys(routeFiles).map((file) => {
  const rel = file.replace('../../src/app', '');
  const route = rel.replace(/\/route\.ts$/, '');
  return { file, route, source: readFileSync(join(__dirname, file), 'utf8') };
});

interface Outcome {
  status: number;
  body: unknown;
}

async function call(
  mod: Record<string, unknown>,
  method: string,
  route: string
): Promise<Outcome> {
  const names: Record<string, string> = {};
  const path = route.replace(/\[(\w+)\]/g, (_m, name: string) => (names[name] = uuid()));
  const handler = mod[method] as (req: unknown, ctx?: unknown) => Promise<Response>;
  const res = await handler(
    request(method, path, { body: method === 'GET' ? undefined : {}, headers: ORIGIN }),
    params(names)
  );
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON: compare the text
  }
  return { status: res.status, body };
}

let user: TestUser;
let restoreEnv: () => void;

beforeAll(async () => {
  restoreEnv = enableAgentAccess();
  user = await createUser('oauth-routes');
});
afterAll(() => restoreEnv());
beforeEach(() => signOut());

describe('route enumeration', () => {
  it('finds the API routes on disk', () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.map((r) => r.route)).toContain('/api/mcp');
    expect(routes.map((r) => r.route)).toContain('/api/bills/[id]');
  });

  it.each(Object.keys(NO_SESSION))('%s really uses no session', (route) => {
    const found = routes.find((r) => r.route === route);
    expect(found, `${route} does not exist any more: drop it from NO_SESSION`).toBeDefined();
    expect(found!.source).not.toMatch(SESSION_MACHINERY);
  });
});

describe('a cookie holding an OAuth access token is signed out, on every cookie-authenticated route', () => {
  const discriminating = new Set<string>();

  for (const { file, route } of routes.filter((r) => !(r.route in NO_SESSION))) {
    it(route, async () => {
      const mod = (await routeFiles[file]()) as Record<string, unknown>;
      const methods = METHODS.filter((m) => typeof mod[m] === 'function');
      expect(methods.length).toBeGreaterThan(0);

      for (const method of methods) {
        signOut();
        const signedOut = await call(mod, method, route);
        signInAsOAuthClient(user);
        const withOAuth = await call(mod, method, route);
        expect(withOAuth, `${method} ${route}`).toEqual(signedOut);

        signInAs(user);
        const signedIn = await call(mod, method, route);
        if (JSON.stringify(signedIn) !== JSON.stringify(signedOut)) discriminating.add(route);
      }
    });
  }

  it('is not vacuous: the probe requests reach the auth check on all but a known few routes', () => {
    // A route where a signed-in user and nobody get the same answer to an
    // empty request would pass the checks above even without the guard.
    const all = routes.filter((r) => !(r.route in NO_SESSION)).map((r) => r.route);
    const blind = all.filter((route) => !discriminating.has(route)).sort();
    expect(blind).toEqual([...BLIND_TO_EMPTY_REQUESTS].sort());
  });
});

describe('GET /auth/callback', () => {
  const callback = (query: string) => authCallback(request('GET', `/auth/callback?${query}`));

  it('keeps a first-party session', async () => {
    signInAs(user);
    globalSignOut.mockClear();
    const res = await callback('token_hash=good&type=email&next=/profile');
    expect(res.headers.get('location')).toBe('http://localhost:3000/profile');
    expect(globalSignOut).not.toHaveBeenCalled();
  });

  it('refuses a session whose access token is an OAuth token: signs it out and sends the user to /signin', async () => {
    signInAsOAuthClient(user);
    globalSignOut.mockClear();
    const res = await callback('token_hash=good&type=email&next=/profile');
    expect(res.headers.get('location')).toBe('http://localhost:3000/signin?error=auth_failed');
    expect(globalSignOut).toHaveBeenCalledTimes(1);
  });

  it('refuses the PKCE code path the same way', async () => {
    signInAsOAuthClient(user);
    globalSignOut.mockClear();
    const res = await callback('code=good&next=/profile');
    expect(res.headers.get('location')).toBe('http://localhost:3000/signin?error=auth_failed');
    expect(globalSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('the routes an empty request cannot tell apart: checked against real data', () => {
  const as = (mode: 'out' | 'oauth' | 'in') =>
    mode === 'out' ? signOut() : mode === 'oauth' ? signInAsOAuthClient(user) : signInAs(user);

  it('POST /api/bills files the bill under nobody when the session is an OAuth token', async () => {
    const body = { name: 'Dinner', creator_name: 'Host', items: [{ name: 'Pasta', price: 10, quantity: 1 }] };
    const owner = async (mode: 'out' | 'oauth' | 'in') => {
      as(mode);
      const res = await createBillRoute(request('POST', '/api/bills', { body }));
      expect(res.status).toBe(200);
      const { id } = (await res.json()) as { id: string };
      return (await db().from('bills').select('creator_user_id').eq('id', id).single()).data!.creator_user_id;
    };
    expect(await owner('in')).toBe(user.id);
    expect(await owner('oauth')).toBeNull();
    expect(await owner('out')).toBeNull();
  });

  describe('on a bill the user owns and is on', () => {
    let bill: Awaited<ReturnType<typeof createBill>>;
    let me: { id: string };
    let guest: { id: string };

    beforeAll(async () => {
      bill = await createBill({ creator: user, name: 'Original' });
      me = { id: bill.creatorParticipantId };
      guest = await joinBill(bill.id, { name: 'Guest', withToken: false });
    });

    const billName = async () => (await db().from('bills').select('name').eq('id', bill.id).single()).data!.name;
    const claimsOn = async () => (await db().from('item_claims').select('id').eq('item_id', bill.itemIds[0])).data!.length;

    it('GET /api/bills/[id] answers like a stranger, not like the owner', async () => {
      const get = async (mode: 'out' | 'oauth' | 'in') => {
        as(mode);
        const res = await getBill(request('GET', `/api/bills/${bill.id}`), params({ id: bill.id }));
        return { status: res.status, body: await res.json() };
      };
      const stranger = await get('out');
      expect(await get('oauth')).toEqual(stranger);
      expect(await get('in')).not.toEqual(stranger);
    });

    it('PATCH and DELETE /api/bills/[id] are refused', async () => {
      as('oauth');
      const patched = await patchBill(request('PATCH', `/api/bills/${bill.id}`, { body: { name: 'Hijacked' }, headers: ORIGIN }), params({ id: bill.id }));
      expect(patched.status).toBeGreaterThanOrEqual(400);
      expect(await billName()).toBe('Original');
      const deleted = await deleteBill(request('DELETE', `/api/bills/${bill.id}`, { headers: ORIGIN }), params({ id: bill.id }));
      expect(deleted.status).toBeGreaterThanOrEqual(400);
      expect(await billName()).toBe('Original');
    });

    it('POST, DELETE /api/claims and POST /api/claims/batch cannot change claims', async () => {
      const item = bill.itemIds[0];
      as('oauth');
      const posted = await claim(request('POST', '/api/claims', { body: { participant_id: me.id, item_id: item, share: 1 } }));
      expect(posted.status).toBe(403);
      const batched = await batchClaim(request('POST', '/api/claims/batch', { body: { item_id: item, entries: [{ participant_id: me.id, share: 1 }] } }));
      expect(batched.status).toBe(403);
      expect(await claimsOn()).toBe(0);

      as('in'); // control: the same calls work for the signed-in owner
      expect((await claim(request('POST', '/api/claims', { body: { participant_id: me.id, item_id: item, share: 1 } }))).status).toBe(200);
      expect(await claimsOn()).toBe(1);
      as('oauth');
      const deleted = await unclaim(request('DELETE', `/api/claims?participant_id=${me.id}&item_id=${item}`));
      expect(deleted.status).toBe(403);
      expect(await claimsOn()).toBe(1);
    });

    it('PATCH and DELETE /api/participants cannot act as the owner', async () => {
      as('oauth');
      const patched = await patchParticipant(request('PATCH', '/api/participants', { body: { participant_id: guest.id, payment_status: 'paid' } }));
      expect(patched.status).toBe(403);
      const removed = await removeParticipant(request('DELETE', `/api/participants?participant_id=${guest.id}`));
      expect(removed.status).toBe(403);
      const row = (await db().from('participants').select('payment_status').eq('id', guest.id).maybeSingle()).data;
      expect(row?.payment_status).not.toBe('paid');
    });

    it('POST /api/participants does not join the bill under the account', async () => {
      const other = await createBill({ name: 'Other bill' });
      const join = async (mode: 'out' | 'oauth' | 'in') => {
        as(mode);
        return joinRoute(request('POST', '/api/participants', { body: { bill_id: other.id } }));
      };
      const stranger = await join('out');
      expect(stranger.status).toBe(400); // a nameless join needs an account
      expect((await join('oauth')).status).toBe(400);
      expect((await join('in')).status).toBe(200); // control
    });
  });
});
