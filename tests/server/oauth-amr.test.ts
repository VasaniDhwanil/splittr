import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createUser, db, sql } from './helpers/db';
import { connectOAuthClient, cookiesFor, signInForReal, type CookieJar } from './helpers/oauth';
import { hasFreshEmailSignIn, readFreshSignIn } from '@/lib/oauth/stepup';

// What `amr` method name does each way of signing in to Splittr produce, as
// read from VERIFIED claims through the real, R-O1-guarded cookie client?
// (docs/specs/mcp-oauth.md A16; the answers are recorded in "Part 2 build
// decisions".) The `?code=` path and code entry need the local stack to be
// able to send mail: they run when an SMTP sink is listening at
// supabase_inbucket_splittr:1025 and are reported as skipped otherwise.
const cookieStore = vi.hoisted(() => ({ current: null as null | { getAll(): { name: string; value: string }[]; set(n: string, v: string, o?: unknown): void } }));
vi.mock('next/headers', () => ({ cookies: async () => cookieStore.current }));

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const plain = () => createClient(url(), anon(), { auth: { persistSession: false, autoRefreshToken: false } });
const pkce = () => createClient(url(), anon(), { auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false } });

let real: typeof import('@/lib/supabase/server');
const amrOf = async (client: ReturnType<typeof plain>) => {
  const { data, error } = await client.auth.getClaims();
  if (error || !data) throw new Error(`getClaims failed: ${error?.message}`);
  return data.claims.amr as { method: string; timestamp: number }[];
};

beforeAll(async () => {
  real = await vi.importActual<typeof import('@/lib/supabase/server')>('@/lib/supabase/server');
});

describe('amr of the sign-in paths (token_hash, no mail needed)', () => {
  for (const type of ['email', 'magiclink'] as const) {
    it(`verifyOtp({ token_hash, type: '${type}' }) for an existing and a first-time account is "otp"`, async () => {
      // a first-time account's emailed token is a signup confirmation: only type 'email' verifies it
      for (const existing of type === 'email' ? [true, false] : [true]) {
        const email = existing ? (await createUser('amr')).email : `amr-new-${Date.now()}-${type}@test.local`;
        const link = await db().auth.admin.generateLink({ type: 'magiclink', email });
        expect(link.error).toBeNull();
        const client = plain();
        const verified = await client.auth.verifyOtp({ type, token_hash: link.data.properties!.hashed_token });
        expect(verified.error, `existing=${existing} type=${type} ${email}`).toBeNull();
        const amr = await amrOf(client);
        expect(amr.map((entry) => entry.method)).toEqual(['otp']);
        expect(hasFreshEmailSignIn({ amr })).toBe(true);
      }
    });
  }

  it('a password sign-in is "password" and never counts', async () => {
    const email = `amr-pw-${Date.now()}@test.local`;
    await db().auth.admin.createUser({ email, password: 'pw-123456-abcdef', email_confirm: true });
    const client = plain();
    expect((await client.auth.signInWithPassword({ email, password: 'pw-123456-abcdef' })).error).toBeNull();
    const amr = await amrOf(client);
    expect(amr.map((entry) => entry.method)).toEqual(['password']);
    expect(hasFreshEmailSignIn({ amr })).toBe(false);
  });
});

describe('through the real guarded cookie client', () => {
  let jar: CookieJar;
  let userId: string;
  let oauthJar: CookieJar;
  let oauthAccessToken: string;
  beforeAll(async () => {
    const user = await createUser('amr-real');
    userId = user.id;
    const session = await signInForReal(user.email);
    jar = await cookiesFor(session);
    const grant = await connectOAuthClient(session);
    oauthAccessToken = grant.accessToken;
    oauthJar = await cookiesFor({ access_token: grant.accessToken, refresh_token: grant.refreshToken });
  });

  it('reads a fresh email sign-in from verified claims', async () => {
    cookieStore.current = jar.store;
    const supabase = await real.createClient();
    expect((await supabase.auth.getUser()).data.user?.id).toBe(userId);
    expect(await readFreshSignIn(supabase, userId)).toBe(true);
    expect(await readFreshSignIn(supabase, '00000000-0000-4000-8000-000000000000')).toBe(false);
  });

  it('reads nothing from a cookie that holds an OAuth client\'s token', async () => {
    cookieStore.current = oauthJar.store;
    const supabase = await real.createClient();
    expect((await supabase.auth.getUser()).data.user).toBeNull();
    const claims = await supabase.auth.getClaims();
    expect(claims.data).toBeNull();
    expect(await readFreshSignIn(supabase, userId)).toBe(false);
  });

  it('the claims of an OAuth client\'s token say so, and never read as a fresh email sign-in', async () => {
    // even if a guard were bypassed and the claims were read
    const payload = JSON.parse(Buffer.from(oauthAccessToken.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.client_id).toBeTruthy();
    expect(payload.amr.map((entry: { method: string }) => entry.method)).toEqual(['oauth_provider/authorization_code']);
    expect(hasFreshEmailSignIn(payload)).toBe(false);
    expect(await readFreshSignIn({ auth: { getClaims: async () => ({ data: { claims: payload }, error: null }) } }, payload.sub)).toBe(false);
  });
});

const smtpWorks = await (async () => {
  const email = `amr-probe-${Date.now()}@test.local`;
  const { error } = await pkce().auth.signInWithOtp({ email });
  return !error;
})();

describe.runIf(smtpWorks)('amr of the paths that need mail (SMTP sink present)', () => {
  const tokenHashFor = async (email: string) =>
    (await sql<{ token_hash: string }>(
      `select o.token_hash from auth.one_time_tokens o join auth.users u on u.id = o.user_id where u.email = $1`,
      [email]
    ))[0].token_hash;

  for (const existing of [false, true]) {
    it(`the ?code= path (link, then exchangeCodeForSession) for a ${existing ? 'returning' : 'first-time'} account is "magiclink"`, async () => {
      const email = existing ? (await createUser('amr-code')).email : `amr-first-${Date.now()}@test.local`;
      const client = pkce();
      expect((await client.auth.signInWithOtp({ email, options: { emailRedirectTo: 'http://localhost:3199/auth/callback' } })).error).toBeNull();
      const link = `${url()}/auth/v1/verify?token=${await tokenHashFor(email)}&type=magiclink&redirect_to=http://localhost:3199/auth/callback`;
      const hop = await fetch(link, { redirect: 'manual' });
      const code = new URL(hop.headers.get('location')!).searchParams.get('code');
      expect(code).toBeTruthy();
      expect((await client.auth.exchangeCodeForSession(code!)).error).toBeNull();
      const amr = await amrOf(client);
      expect(amr.map((entry) => entry.method)).toEqual(['magiclink']);
      expect(hasFreshEmailSignIn({ amr })).toBe(true);
    });
  }

  it('entering the 6-digit code (verifyOtp with email, token, type email) is "otp"', async () => {
    const email = `amr-otp-${Date.now()}@test.local`;
    expect((await pkce().auth.signInWithOtp({ email })).error).toBeNull();
    const stored = (await tokenHashFor(email)).replace(/^pkce_/, '');
    let otp: string | null = null;
    for (let i = 0; i < 1_000_000 && !otp; i++) {
      const candidate = String(i).padStart(6, '0');
      if (createHash('sha224').update(email + candidate).digest('hex') === stored) otp = candidate;
    }
    expect(otp).not.toBeNull();
    const client = plain();
    expect((await client.auth.verifyOtp({ email, token: otp!, type: 'email' })).error).toBeNull();
    const amr = await amrOf(client);
    expect(amr.map((entry) => entry.method)).toEqual(['otp']);
    expect(hasFreshEmailSignIn({ amr })).toBe(true);
  });
});
