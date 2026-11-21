import { inject, vi } from 'vitest';
import { assertLocal } from './global-setup';

// Runs in each test worker before any test module is imported, so
// src/lib/supabase/admin.ts (a module singleton) first sees the local stack.
const env = inject('supabaseEnv');
assertLocal(env);

process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.serviceRoleKey;
process.env.TEST_DATABASE_URL = env.dbUrl;

// A shell that sourced scripts/local-env.sh (to run the dev server or a build)
// exports a localhost site URL; tests expect the production default.
delete process.env.NEXT_PUBLIC_SITE_URL;
delete process.env.OAUTH_ISSUER;
delete process.env.MCP_OAUTH_ENABLED;

// Nothing in a test may reach a real third party.
delete process.env.RESEND_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

// Handlers learn who is signed in from the cookie client, which can't exist
// outside a Next request. Tests choose the session with signInAs().
vi.mock('@/lib/supabase/server', async () => {
  const { fakeServerClient } = await import('./helpers/session');
  return { createClient: async () => fakeServerClient() };
});
