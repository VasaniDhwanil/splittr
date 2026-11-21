import { createHash, randomBytes } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { db } from './db';

/** Talking to the local Supabase OAuth 2.1 server the way Claude does. */

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const issuer = () => `${url()}/auth/v1`;

export interface RealSession {
  access_token: string;
  refresh_token: string;
}

/** A real first-party session: magic link minted with the admin API, verified like the callback does. */
export async function signInForReal(email: string): Promise<RealSession> {
  const link = await db().auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;
  const client = createClient(url(), anon(), { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await client.auth.verifyOtp({ type: 'email', token_hash: link.data.properties.hashed_token });
  if (verified.error || !verified.data.session) throw new Error(`verifyOtp failed: ${verified.error?.message}`);
  return verified.data.session;
}

export interface OAuthGrant {
  clientId: string;
  accessToken: string;
  refreshToken: string;
}

/** Registers a client (DCR), authorizes it as `session`'s user, approves and exchanges the code. */
export async function connectOAuthClient(
  session: RealSession,
  redirectUri = 'https://claude.ai/api/mcp/auth_callback'
): Promise<OAuthGrant> {
  const registered = await fetch(`${issuer()}/oauth/clients/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test Claude',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  if (registered.status !== 201) throw new Error(`client registration failed: ${registered.status}`);
  const { client_id: clientId } = (await registered.json()) as { client_id: string };

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = new URL(`${issuer()}/oauth/authorize`);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'test-state',
    scope: 'email offline_access',
    resource: 'https://www.splittr.cash/api/mcp',
  }))
    authorize.searchParams.set(k, v);
  const redirect = await fetch(authorize, { redirect: 'manual' });
  const consentUrl = redirect.headers.get('location');
  const authorizationId = consentUrl && new URL(consentUrl).searchParams.get('authorization_id');
  if (!authorizationId) throw new Error(`authorize did not redirect to the consent page (${redirect.status})`);

  const userHeaders = { apikey: anon(), authorization: `Bearer ${session.access_token}` };
  const details = await fetch(`${issuer()}/oauth/authorizations/${authorizationId}`, { headers: userHeaders });
  if (!details.ok) throw new Error(`authorization details failed: ${details.status}`);
  const approve = await fetch(`${issuer()}/oauth/authorizations/${authorizationId}/consent`, {
    method: 'POST',
    headers: { ...userHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  });
  const { redirect_url } = (await approve.json()) as { redirect_url?: string };
  const code = redirect_url && new URL(redirect_url).searchParams.get('code');
  if (!code) throw new Error(`approval returned no code (${approve.status})`);

  const token = await fetch(`${issuer()}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: 'https://www.splittr.cash/api/mcp',
    }),
  });
  const body = (await token.json()) as { access_token?: string; refresh_token?: string };
  if (!body.access_token || !body.refresh_token) throw new Error(`token exchange failed: ${token.status}`);
  return { clientId, accessToken: body.access_token, refreshToken: body.refresh_token };
}

export interface CookieJar {
  cookies: Map<string, string>;
  /** Same shape as Next's cookies(): what the route handlers read. */
  store: { getAll(): { name: string; value: string }[]; set(name: string, value: string, options?: unknown): void };
}

export function emptyJar(): CookieJar {
  const cookies = new Map<string, string>();
  return {
    cookies,
    store: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      set: (name, value) => {
        if (value === '') cookies.delete(name);
        else cookies.set(name, value);
      },
    },
  };
}

/** The session cookies a browser would hold for these tokens, written by @supabase/ssr itself. */
export async function cookiesFor(tokens: RealSession): Promise<CookieJar> {
  const jar = emptyJar();
  const writer = createServerClient(url(), anon(), {
    cookies: {
      getAll: () => jar.store.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => jar.store.set(name, value, options)),
    },
  });
  const { error } = await writer.auth.setSession(tokens);
  if (error) throw error;
  return jar;
}

export const cookieHeader = (jar: CookieJar) =>
  jar.store.getAll().map(({ name, value }) => `${name}=${value}`).join('; ');
