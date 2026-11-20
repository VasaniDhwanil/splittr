import { vi } from 'vitest';

export interface TestUser {
  id: string;
  email: string;
}

let current: TestUser | null = null;

/** Who the cookie session resolves to for the handlers under test. */
export function signInAs(user: TestUser | null): void {
  current = user;
}

export function signOut(): void {
  current = null;
}

export const globalSignOut = vi.fn(async () => ({ error: null }));

/**
 * Stand-in for the cookie-reading Supabase client. Route handlers only use it
 * to learn who is signed in; all data access goes through the real admin
 * client against the local database.
 */
export function fakeServerClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: current }, error: null }),
      signOut: globalSignOut,
      verifyOtp: async () => ({
        data: { user: current },
        error: current ? null : { message: 'invalid token' },
      }),
      exchangeCodeForSession: async () => ({
        data: { user: current },
        error: current ? null : { message: 'invalid code' },
      }),
    },
  };
}
