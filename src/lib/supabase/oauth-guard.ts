import { AuthSessionMissingError } from '@supabase/supabase-js';

/**
 * True when an access token was issued to an OAuth client (it carries a
 * `client_id` claim) rather than minted by signing in to Splittr itself.
 *
 * This only classifies. The payload is decoded without checking the
 * signature, so nothing may be trusted from it except this one distinction;
 * the real verification stays with Supabase (`getUser`). Anything that cannot
 * be decoded is not an OAuth token (and no verifier will accept it either).
 *
 * Why it exists: Supabase's `GET /auth/v1/user` accepts OAuth-client tokens
 * on purpose, so such a token placed in the session cookie would be taken for
 * the user's own session by every route. OAuth tokens belong to the MCP
 * endpoint only (docs/specs/mcp-oauth.md, R-O1).
 */
export function isOAuthAccessToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
    const clientId = (payload as Record<string, unknown>).client_id;
    return clientId !== undefined && clientId !== null && clientId !== '';
  } catch {
    return false;
  }
}

/** The part of a Supabase client that the guard touches. */
interface GuardableClient {
  auth: {
    getUser: (jwt?: string) => Promise<unknown>;
    getSession: () => Promise<{ data: { session: { access_token: string } | null } }>;
  };
}

/**
 * Makes a cookie-session client treat an OAuth-token session as signed out:
 * `auth.getUser()` and `auth.getSession()` report no user / no session. The
 * rest of the client is untouched. Apply it to every client built from the
 * request's cookies.
 */
export function rejectOAuthSessions<T extends GuardableClient>(supabase: T): T {
  const auth = supabase.auth;
  const getUser = auth.getUser.bind(auth);
  const getSession = auth.getSession.bind(auth);

  auth.getSession = async () => {
    const result = await getSession();
    if (isOAuthAccessToken(result.data.session?.access_token)) {
      return { data: { session: null }, error: null } as unknown as typeof result;
    }
    return result;
  };

  auth.getUser = async (jwt?: string) => {
    const token = jwt ?? (await getSession()).data.session?.access_token;
    if (isOAuthAccessToken(token)) {
      return { data: { user: null }, error: new AuthSessionMissingError() };
    }
    return getUser(jwt);
  };

  return supabase;
}
