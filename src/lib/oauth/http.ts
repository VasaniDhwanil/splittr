/**
 * Small HTTP helpers shared by the OAuth routes: error pages, redirects back
 * to a client, RFC 6749 error bodies, form parsing, the binding cookie.
 */
import { NextResponse } from 'next/server';
import { escapeHtml } from '@/lib/email';
import { oauthIssuer } from '@/lib/oauth/config';

export const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' } as const;

/** A plain HTML page (never reflects request input). */
export function htmlPage(status: number, title: string, message: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#fff;font:16px/1.5 system-ui,sans-serif}main{max-width:28rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:0;color:rgba(255,255,255,.6)}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE },
  });
}

/** Where the client is sent back, with `iss` (RFC 9207) and `state` when it had one. */
export function clientRedirectUrl(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) query.set(key, value);
  }
  query.set('iss', oauthIssuer());
  // A registered redirect URI never carries a query or fragment
  return `${redirectUri}?${query.toString()}`;
}

export function redirectToClient(redirectUri: string, params: Record<string, string | null | undefined>): NextResponse {
  return new NextResponse(null, {
    status: 302,
    headers: { Location: clientRedirectUrl(redirectUri, params), ...NO_STORE },
  });
}

export type TokenErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'invalid_target';

/** RFC 6749 section 5.2 error body. */
export function tokenError(code: TokenErrorCode, description: string): NextResponse {
  return NextResponse.json(
    { error: code, error_description: description },
    { status: code === 'invalid_client' ? 401 : 400, headers: NO_STORE }
  );
}

/** A database or unexpected failure: the client must retry, never conclude its grant is dead. */
export function temporarilyUnavailable(): NextResponse {
  return NextResponse.json(
    { error: 'temporarily_unavailable', error_description: 'Try again shortly.' },
    { status: 503, headers: { ...NO_STORE, 'Retry-After': '5' } }
  );
}

export type FormResult = { ok: true; fields: Map<string, string> } | { ok: false; reason: 'content_type' | 'duplicate' | 'too_large' | 'malformed' };

const MAX_FORM_BYTES = 16 * 1024;

/**
 * application/x-www-form-urlencoded only (any parameters, such as a charset).
 * A parameter given twice is refused outright.
 */
export async function readForm(request: Request): Promise<FormResult> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return { ok: false, reason: 'content_type' };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (text.length > MAX_FORM_BYTES) return { ok: false, reason: 'too_large' };
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(text)) {
    if (fields.has(key)) return { ok: false, reason: 'duplicate' };
    fields.set(key, value);
  }
  return { ok: true, fields };
}

// ---------------------------------------------------------------------------
// The binding cookie: ties /oauth/consent and the consent APIs to the browser
// that started the request (A5). Its SHA-256 is stored on the request.
// ---------------------------------------------------------------------------
const secureIssuer = () => oauthIssuer().startsWith('https://');

/**
 * One cookie per authorization request: `__Host-splittr-oauth-<request id>` on
 * https, so two connections started in one browser (two Claude Code windows,
 * claude.ai and Claude Code) never overwrite each other. A __Host- cookie must
 * be Secure, which an http origin (only ever http://localhost, for local runs)
 * cannot hold, so there it is `splittr-oauth-<request id>` without Secure.
 * The id is 22 base64url characters: valid in a cookie name.
 */
export const bindingCookieName = (requestId: string) =>
  `${secureIssuer() ? '__Host-splittr-oauth' : 'splittr-oauth'}-${requestId}`;

export const bindingCookieOptions = (maxAgeSeconds: number) =>
  ({
    httpOnly: true,
    secure: secureIssuer(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  });

export const BINDING_COOKIE_SHAPE = /^[A-Za-z0-9_-]{43}$/;
