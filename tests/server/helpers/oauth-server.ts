import { randomBytes } from 'node:crypto';
import {
  deriveFirstPair,
  deriveSuccessors,
  generateAuthorizationCode,
  hashOAuthSecret,
} from '@/lib/oauth/tokens';
import { CLAUDE_CODE_CLIENT_ID, HOSTED_CLIENT_ID } from '@/lib/oauth/clients';
import { NextRequest } from 'next/server';
import { db } from './db';
import { enableAgentAccess, TEST_PEPPER } from './agent';
import type { TestUser } from './session';

export { CLAUDE_CODE_CLIENT_ID, HOSTED_CLIENT_ID, TEST_PEPPER };

export const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
export const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
export const CODE_REDIRECT = 'http://localhost:54321/callback';
export const RESOURCE = 'http://localhost:3199/api/mcp';

export const newRequestId = () => randomBytes(16).toString('base64url');
export const newBinding = () => randomBytes(32).toString('base64url');
export const sha = hashOAuthSecret;

export interface SeedRequest {
  id: string;
  binding: string;
  clientId: string;
}

/** An authorization request as GET /oauth/authorize leaves it. */
export async function seedRequest(
  user: TestUser | null,
  opts: {
    clientId?: string;
    redirectUri?: string;
    state?: string | null;
    scopes?: string[];
    status?: 'pending' | 'approved' | 'denied';
    expiresAt?: Date;
    codeHmac?: string | null;
    codeExpiresAt?: Date | null;
    attempts?: number;
  } = {}
): Promise<SeedRequest> {
  const id = newRequestId();
  const binding = newBinding();
  const clientId = opts.clientId ?? CLAUDE_CODE_CLIENT_ID;
  const { error } = await db()
    .from('agent_oauth_requests')
    .insert({
      id,
      client_id: clientId,
      redirect_uri: opts.redirectUri ?? (clientId === HOSTED_CLIENT_ID ? 'https://claude.ai/api/mcp/auth_callback' : CODE_REDIRECT),
      state: opts.state === undefined ? 'st' : opts.state,
      code_challenge: CHALLENGE,
      scopes_requested: opts.scopes ?? ['read', 'bills:write'],
      resource: RESOURCE,
      binding_hash: sha(binding),
      user_id: user?.id ?? null,
      expires_at: (opts.expiresAt ?? new Date(Date.now() + 10 * 60_000)).toISOString(),
      status: opts.status ?? 'pending',
      code_hmac: opts.codeHmac ?? null,
      code_expires_at: opts.codeExpiresAt?.toISOString() ?? null,
      attempts: opts.attempts ?? 0,
    });
  if (error) throw new Error(`seedRequest failed: ${error.message}`);
  return { id, binding, clientId };
}

export interface ApproveArgs {
  scopes?: string[];
  replace?: boolean;
  requireCode?: boolean;
  codeHmac?: string | null;
  binding?: string;
  user?: TestUser;
  name?: string;
  destination?: 'claude.ai' | 'loopback';
}

export async function callApprove(user: TestUser, req: SeedRequest, args: ApproveArgs = {}) {
  const code = generateAuthorizationCode(TEST_PEPPER);
  // The function itself refuses a hosted-client approval without an emailed code: unless a test says
  // otherwise, give the hosted client the code it needs
  const hostedDefault = req.clientId === HOSTED_CLIENT_ID && args.requireCode === undefined;
  if (hostedDefault) {
    await db()
      .from('agent_oauth_requests')
      .update({ code_hmac: 'helper-code-hmac', code_expires_at: new Date(Date.now() + 600_000).toISOString() })
      .eq('id', req.id);
  }
  const { data, error } = await db().rpc('oauth_approve_request', {
    p_request_id: req.id,
    p_user_id: (args.user ?? user).id,
    p_binding_hash: sha(args.binding ?? req.binding),
    p_scopes: args.scopes ?? ['read'],
    p_replace: args.replace ?? false,
    p_require_code: args.requireCode ?? hostedDefault,
    p_code_hmac: args.codeHmac ?? (hostedDefault ? 'helper-code-hmac' : null),
    p_code_hash: sha(code),
    p_grant_name: args.name ?? 'Claude Code',
    p_destination: args.destination ?? 'loopback',
    p_revoke_link_hash: sha(randomBytes(32).toString('base64url')),
  });
  if (error) throw new Error(`oauth_approve_request failed: ${error.message}`);
  return { result: data as { status: string; grant_id?: string; attempts_left?: number; replaces?: number }, code };
}

export async function callRedeem(code: string, bindingsOk = true, pairOverride?: { access: string; refresh: string }, verifier = VERIFIER) {
  // Derived from the code and the verifier, as the token endpoint does
  const pair = pairOverride ?? deriveFirstPair(code, verifier, TEST_PEPPER);
  const { data, error } = await db().rpc('oauth_redeem_code', {
    p_code_hash: sha(code),
    p_bindings_ok: bindingsOk,
    p_access_hash: sha(pair.access),
    p_refresh_hash: sha(pair.refresh),
  });
  if (error) throw new Error(`oauth_redeem_code failed: ${error.message}`);
  return { result: data as { status: string; grant_id?: string; user_id?: string; replaced?: number; replay?: boolean }, pair };
}

export async function callRefresh(refresh: string, clientId = CLAUDE_CODE_CLIENT_ID) {
  const next = deriveSuccessors(refresh, TEST_PEPPER);
  const { data, error } = await db().rpc('oauth_refresh', {
    p_refresh_hash: sha(refresh),
    p_client_id: clientId,
    p_new_access_hash: sha(next.access),
    p_new_refresh_hash: sha(next.refresh),
  });
  if (error) throw new Error(`oauth_refresh failed: ${error.message}`);
  return { result: data as { status: string; replay?: boolean; grant_id?: string; user_id?: string }, next };
}

/** Request, approve and redeem: a live grant with its first token pair. */
export async function connect(
  user: TestUser,
  opts: { clientId?: string; scopes?: string[]; replace?: boolean } = {}
) {
  const clientId = opts.clientId ?? CLAUDE_CODE_CLIENT_ID;
  const req = await seedRequest(user, { clientId });
  const { result: approved, code } = await callApprove(user, req, {
    scopes: opts.scopes,
    replace: opts.replace,
    destination: clientId === HOSTED_CLIENT_ID ? 'claude.ai' : 'loopback',
  });
  if (approved.status !== 'ok') throw new Error(`connect: approve gave ${approved.status}`);
  const { result, pair } = await callRedeem(code);
  if (result.status !== 'ok') throw new Error(`connect: redeem gave ${result.status}`);
  return { grantId: approved.grant_id!, pair, code, requestId: req.id };
}

export const grantRow = async (id: string) => (await db().from('agent_tokens').select('*').eq('id', id).single()).data!;
export const oauthTokens = async (grantId: string) =>
  (await db().from('agent_oauth_tokens').select('*').eq('grant_id', grantId)).data ?? [];
export const oauthCodes = async (grantId: string) =>
  (await db().from('agent_oauth_codes').select('*').eq('grant_id', grantId)).data ?? [];

/** Agent access plus OAuth on, issuer http://localhost:3199 (so the cookie is the http variant). */
export function enableOAuth(issuer = 'http://localhost:3199'): () => void {
  const restoreAgent = enableAgentAccess();
  const before = { switch: process.env.MCP_OAUTH_ENABLED, issuer: process.env.OAUTH_ISSUER, vercel: process.env.VERCEL_ENV };
  process.env.MCP_OAUTH_ENABLED = 'true';
  process.env.OAUTH_ISSUER = issuer;
  return () => {
    restoreAgent();
    for (const [key, value] of [
      ['MCP_OAUTH_ENABLED', before.switch],
      ['OAUTH_ISSUER', before.issuer],
      ['VERCEL_ENV', before.vercel],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export const randomIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;

/** An application/x-www-form-urlencoded POST, as Claude sends to the token endpoint. */
export function formRequest(
  path: string,
  fields: Record<string, string> | string,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(`http://localhost:3199${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': randomIp(), ...headers },
    body: typeof fields === 'string' ? fields : new URLSearchParams(fields).toString(),
  });
}
