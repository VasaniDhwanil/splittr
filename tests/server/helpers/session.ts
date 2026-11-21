import { vi } from 'vitest';
import { rejectOAuthSessions } from '@/lib/supabase/oauth-guard';

export interface TestUser {
  id: string;
  email: string;
}

let current: TestUser | null = null;
let viaOAuth = false;

/** Who the cookie session resolves to for the handlers under test. */
export function signInAs(user: TestUser | null): void {
  current = user;
  viaOAuth = false;
}

/**
 * The cookie holds an access token issued to an OAuth client for this user.
 * Supabase itself accepts such a token as the user (the stand-in below does
 * too); the app must not, and tests assert that it does not.
 */
export function signInAsOAuthClient(user: TestUser): void {
  current = user;
  viaOAuth = true;
}

export function signOut(): void {
  current = null;
  viaOAuth = false;
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** Unsigned on purpose: the guard only classifies, and the stand-in never verifies. */
const accessTokenFor = (user: TestUser, oauth: boolean) =>
  `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({
    sub: user.id,
    role: 'authenticated',
    session_id: 'test-session',
    ...(oauth ? { client_id: '00000000-0000-4000-8000-000000000001' } : {}),
  })}.c2ln`;

export const globalSignOut = vi.fn(async () => ({ error: null }));

/**
 * Stand-in for the cookie-reading Supabase client. Route handlers only use it
 * to learn who is signed in; all data access goes through the real admin
 * client against the local database.
 */
export function fakeServerClient() {
  const session = () => (current ? { access_token: accessTokenFor(current, viaOAuth) } : null);
  const raw = {
    auth: {
      // Like GoTrue's /user: any valid access token resolves to its user,
      // an OAuth client's included.
      getUser: async () => ({ data: { user: current }, error: null }),
      getSession: async () => ({ data: { session: session() }, error: null }),
      signOut: globalSignOut,
      verifyOtp: async () => ({
        data: { user: current, session: session() },
        error: current ? null : { message: 'invalid token' },
      }),
      exchangeCodeForSession: async () => ({
        data: { user: current, session: session() },
        error: current ? null : { message: 'invalid code' },
      }),
    },
  };
  // The same guard the real createClient() applies.
  return rejectOAuthSessions(raw);
}
