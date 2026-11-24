import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as finish } from '@/app/auth/finish/route';
import { GET as authCallback } from '@/app/auth/callback/route';
import { createUser, db, request } from './helpers/db';
import { globalSignOut, setSessionAmr, signInAs, signInAsOAuthClient, signOut, type TestUser } from './helpers/session';

let user: TestUser;

beforeAll(async () => {
  user = await createUser('finish');
});

const lock = async () => {
  await db().from('agent_mint_state').upsert({ user_id: user.id, failed_verifies: 10, locked_until: new Date(Date.now() + 3600_000).toISOString() });
};
const locked = async () => (await db().from('agent_mint_state').select('user_id').eq('user_id', user.id)).data!.length === 1;
const post = (headers: Record<string, string> = { origin: 'http://localhost:3000' }) => finish(request('POST', '/auth/finish', { headers }));

beforeEach(async () => {
  signOut();
  globalSignOut.mockClear();
  await db().from('agent_mint_state').delete().eq('user_id', user.id);
});

describe('POST /auth/finish', () => {
  it('refuses a cross-site Origin with 403 and changes nothing', async () => {
    signInAs(user);
    setSessionAmr([{ method: 'otp', ageSeconds: 5 }]);
    await lock();
    const res = await post({ origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await locked()).toBe(true);
  });

  it('answers 401 when nobody is signed in', async () => {
    expect((await post()).status).toBe(401);
  });

  it('answers 401 for a session that holds an OAuth client token (the guard hides it, the proxy clears the cookies)', async () => {
    signInAsOAuthClient(user);
    await lock();
    const res = await post();
    expect(res.status).toBe(401);
    expect(await locked()).toBe(true);
  });

  it('does not clear the wrong-code lock for a password session', async () => {
    signInAs(user);
    await lock();
    expect((await post()).status).toBe(200);
    expect(await locked()).toBe(true);
  });

  it('does not clear the lock for an otp sign-in older than 10 minutes', async () => {
    signInAs(user);
    setSessionAmr([{ method: 'otp', ageSeconds: 11 * 60 }]);
    await lock();
    expect((await post()).status).toBe(200);
    expect(await locked()).toBe(true);
  });

  it('clears the lock for a fresh otp sign-in', async () => {
    signInAs(user);
    setSessionAmr([{ method: 'otp', ageSeconds: 30 }]);
    await lock();
    expect((await post()).status).toBe(200);
    expect(await locked()).toBe(false);
  });
});

describe('GET /auth/callback redirect target', () => {
  it.each(['/\t/evil.com', '/%09/evil.com', '//evil.com', '/\\evil.com', 'https://evil.com', '/%2F%2Fevil.com'])('sends next=%j to /', async (next) => {
    signInAs(user);
    const res = await authCallback(request('GET', `/auth/callback?token_hash=good&type=email&next=${encodeURIComponent(next)}`));
    expect(res.headers.get('location')).toBe('http://localhost:3000/');
  });

  it('keeps a normal path with query and hash-free suffix', async () => {
    signInAs(user);
    const res = await authCallback(request('GET', `/auth/callback?token_hash=good&type=email&next=${encodeURIComponent('/groups/join?code=AB12')}`));
    expect(res.headers.get('location')).toBe('http://localhost:3000/groups/join?code=AB12');
  });
});
