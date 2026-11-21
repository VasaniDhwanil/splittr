/**
 * Proof of inbox control at consent (docs/specs/mcp-oauth.md S5, A5, A16).
 * Approval needs a fresh email sign-in (Claude Code only) or the emailed code.
 */
import { createHmac } from 'crypto';
import type { OAuthClient } from '@/lib/oauth/clients';

/**
 * Until the post-deploy test shows that claude.ai's callback binds the flow
 * to the claude.ai session that started it, the hosted client always needs
 * the emailed code (docs/specs/mcp-oauth.md A5, the D3 phishing case).
 */
export const HOSTED_CLIENT_REQUIRES_EMAILED_CODE = true;

export const FRESH_SIGN_IN_SECONDS = 600;
export const CODE_TTL_MINUTES = 10;

/**
 * The `amr` method names a Splittr email sign-in produces, measured on the
 * local stack (docs/specs/mcp-oauth.md, "Part 2 build decisions"):
 *   verifyOtp with a token_hash (any type) ........ otp
 *   verifyOtp with the 6-digit code ................ otp
 *   exchangeCodeForSession(?code=) after the link .. magiclink
 * Anything else (password, an OAuth session's oauth_provider/..., recovery,
 * anonymous) is not a magic-link sign-in and never counts.
 */
export const FRESH_AMR_METHODS: readonly string[] = ['otp', 'magiclink'];

export function emailedCodeRequired(client: Pick<OAuthClient, 'destination'>, freshSignIn: boolean): boolean {
  if (client.destination === 'claude.ai' && HOSTED_CLIENT_REQUIRES_EMAILED_CODE) return true;
  return !freshSignIn;
}

/** What is stored for an emailed consent code: bound to the account and this request. */
export function hmacOAuthCode(pepper: string, userId: string, requestId: string, code: string): string {
  return createHmac('sha256', pepper).update(`${userId}:oauth:${requestId}:${code}`).digest('hex');
}

interface Claims {
  sub?: unknown;
  amr?: unknown;
  client_id?: unknown;
}

/** True when `claims` hold an email sign-in from the last 10 minutes. Pure. */
export function hasFreshEmailSignIn(claims: Claims, nowMs: number = Date.now()): boolean {
  if (!Array.isArray(claims.amr)) return false;
  const nowSeconds = Math.floor(nowMs / 1000);
  return claims.amr.some((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (typeof method !== 'string' || !FRESH_AMR_METHODS.includes(method)) return false;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false;
    // not in the future either (a minute of clock skew)
    return nowSeconds - timestamp <= FRESH_SIGN_IN_SECONDS && timestamp - nowSeconds <= 60;
  });
}

interface ClaimsClient {
  auth: { getClaims: () => Promise<{ data: { claims: Claims } | null; error: unknown }> };
}

/**
 * Reads the amr from VERIFIED claims (the signature is checked against the
 * project's keys), through the R-O1-guarded client, and requires them to
 * belong to `userId` and not to an OAuth client's token. Any failure is "not
 * fresh".
 */
export async function readFreshSignIn(supabase: ClaimsClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return false;
    const { claims } = data;
    if (claims.sub !== userId) return false;
    if (claims.client_id !== undefined && claims.client_id !== null && claims.client_id !== '') return false;
    return hasFreshEmailSignIn(claims);
  } catch {
    return false;
  }
}
