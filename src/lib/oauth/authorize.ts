/**
 * Validation of an authorization request (docs/specs/mcp-oauth.md S4 as
 * amended by A14 and A15). Pure: no database, no cookies.
 */
import { findClient, matchRedirectUri, type OAuthClient } from '@/lib/oauth/clients';
import { oauthResource } from '@/lib/oauth/config';
import { PKCE_CHALLENGE_RE } from '@/lib/oauth/tokens';
import { parseScopes, type AgentScope } from '@/lib/agent-tokens';

export const MAX_STATE = 2048;

export type ClientCheck =
  | { ok: true; client: OAuthClient; redirectUri: string }
  | { ok: false; reason: 'client' | 'redirect_uri' };

/**
 * Steps 2 and 3: the client and the redirect URI. A failure here is shown to
 * the person on our own page and NEVER redirected, whatever the other
 * parameters say.
 */
export function checkClientAndRedirect(params: URLSearchParams): ClientCheck {
  const ids = params.getAll('client_id');
  const client = ids.length === 1 ? findClient(ids[0]) : null;
  if (!client) return { ok: false, reason: 'client' };
  const uris = params.getAll('redirect_uri');
  if (uris.length !== 1 || !matchRedirectUri(client, uris[0])) return { ok: false, reason: 'redirect_uri' };
  return { ok: true, client, redirectUri: uris[0] };
}

export interface AuthorizeError {
  error: 'invalid_request' | 'unsupported_response_type' | 'invalid_target';
  description: string;
}

export interface ValidAuthorize {
  codeChallenge: string;
  resource: string;
  state: string | null;
  scopes: AgentScope[];
}

/** The resource must be ours, up to scheme and host case, default port and one trailing slash. */
export function canonicalResource(raw: string, resource: string = oauthResource()): string | null {
  if (/[%\\\s?#]|\.\./.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const canonical = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  return canonical === resource ? resource : null;
}

const SINGLE = ['response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const;

/** Steps 4 to 7, after the client and redirect URI passed. */
export function validateAuthorize(params: URLSearchParams): { ok: true; value: ValidAuthorize } | { ok: false; error: AuthorizeError } {
  const fail = (error: AuthorizeError['error'], description: string) => ({ ok: false as const, error: { error, description } });

  for (const name of SINGLE) {
    if (params.getAll(name).length > 1) return fail('invalid_request', `The ${name} parameter must not be repeated.`);
  }

  const responseType = params.get('response_type');
  if (responseType === null) return fail('invalid_request', 'response_type is required.');
  if (responseType !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');

  const challenge = params.get('code_challenge');
  if (!challenge || !PKCE_CHALLENGE_RE.test(challenge)) {
    return fail('invalid_request', 'A PKCE code_challenge of 43 to 128 characters is required.');
  }
  if (params.get('code_challenge_method') !== 'S256') {
    return fail('invalid_request', 'code_challenge_method must be S256.');
  }

  const rawResource = params.get('resource');
  let resource = oauthResource();
  if (rawResource !== null) {
    const canonical = canonicalResource(rawResource);
    if (!canonical) return fail('invalid_target', 'The resource is not served by this authorization server.');
    resource = canonical;
  }

  const state = params.get('state');
  if (state !== null && state.length > MAX_STATE) return fail('invalid_request', `state must be at most ${MAX_STATE} characters.`);

  // Unknown scopes and offline_access are ignored: the person chooses on the consent page
  const known = (params.get('scope') ?? '')
    .split(/\s+/)
    .filter((scope) => scope === 'read' || scope === 'bills:write');
  const scopes = known.length > 0 ? (parseScopes(known) ?? []) : [];

  return { ok: true, value: { codeChallenge: challenge, resource, state, scopes } };
}
