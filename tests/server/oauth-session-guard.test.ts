import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createUser } from './helpers/db';
import {
  connectOAuthClient,
  cookieHeader,
  cookiesFor,
  signInForReal,
  type CookieJar,
  type OAuthGrant,
  type RealSession,
} from './helpers/oauth';
import { proxy } from '@/proxy';

// The real createClient() wrapper, the real proxy and the real callback, with
// real sessions from the local stack. (Every other server test replaces
// @/lib/supabase/server with a fake; oauth-routes-signed-out.test.ts covers
// the routes through that fake.)
const cookieStore = vi.hoisted(() => ({ current: null as null | { getAll(): { name: string; value: string }[]; set(n: string, v: string, o?: unknown): void } }));
vi.mock('next/headers', () => ({ cookies: async () => cookieStore.current }));

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let real: typeof import('@/lib/supabase/server');
let firstParty: { session: RealSession; jar: CookieJar; email: string; id: string };
let oauth: { grant: OAuthGrant; jar: CookieJar };

beforeAll(async () => {
  real = await vi.importActual<typeof import('@/lib/supabase/server')>('@/lib/supabase/server');
  const user = await createUser('oauth-guard');
  const session = await signInForReal(user.email);
  firstParty = { session, jar: await cookiesFor(session), email: user.email, id: user.id };
  const grant = await connectOAuthClient(session);
  oauth = { grant, jar: await cookiesFor({ access_token: grant.accessToken, refresh_token: grant.refreshToken }) };
});

/** What the app would be if createClient() were a plain @supabase/ssr client. */
const unguardedGetUser = (jar: CookieJar) =>
  createServerClient(url(), anon(), {
    cookies: { getAll: () => jar.store.getAll(), setAll: () => {} },
  }).auth.getUser();

describe('the premise: Supabase itself takes OAuth tokens for the user', () => {
  it('an unguarded client resolves a cookie holding an OAuth access token to the user', async () => {
    const { data, error } = await unguardedGetUser(oauth.jar);
    expect(error).toBeNull();
    expect(data.user?.id).toBe(firstParty.id);
  });
});

describe('createClient() from @/lib/supabase/server', () => {
  it('still resolves a first-party session to the user', async () => {
    cookieStore.current = firstParty.jar.store;
    const supabase = await real.createClient();
    const { data, error } = await supabase.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.id).toBe(firstParty.id);
    expect((await supabase.auth.getSession()).data.session?.access_token).toBeTruthy();
  });

  it('reports no user and no session when the cookie holds an OAuth access token', async () => {
    cookieStore.current = oauth.jar.store;
    const supabase = await real.createClient();
    const { data, error } = await supabase.auth.getUser();
    expect(data.user).toBeNull();
    expect(error?.name).toBe('AuthSessionMissingError');
    expect((await supabase.auth.getSession()).data.session).toBeNull();
  });

  it('treats an OAuth token handed to getUser(jwt) the same way', async () => {
    cookieStore.current = firstParty.jar.store;
    const supabase = await real.createClient();
    const { data } = await supabase.auth.getUser(oauth.grant.accessToken);
    expect(data.user).toBeNull();
  });
});

describe('the session proxy', () => {
  const run = (jar: CookieJar) =>
    proxy(new NextRequest('http://localhost:3199/profile', { headers: { cookie: cookieHeader(jar) } }));
  const cleared = (response: Response) =>
    response.headers
      .getSetCookie()
      .filter((c) => /^sb-[^=]*-auth-token/.test(c) && /(max-age=0|expires=Thu, 01 Jan 1970)/i.test(c));

  it('clears the Supabase auth cookies of an OAuth-token session', async () => {
    const response = await run(oauth.jar);
    const names = [...oauth.jar.cookies.keys()];
    expect(names.length).toBeGreaterThan(0);
    expect(cleared(response).length).toBe(names.length);
  });

  it('leaves a first-party session alone', async () => {
    const response = await run(firstParty.jar);
    expect(cleared(response)).toEqual([]);
  });

  it('does not let the downstream request see the OAuth cookie either', async () => {
    const response = await run(oauth.jar);
    // NextResponse.next({request}) forwards the (modified) request headers.
    const forwarded = response.headers.get('x-middleware-request-cookie') ?? '';
    expect(forwarded).not.toMatch(/sb-.*-auth-token/);
  });
});
