import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client for data operations in API routes.
 *
 * With SUPABASE_SERVICE_ROLE_KEY set it bypasses RLS, which lets the database
 * policies be locked down to deny direct client writes entirely (the API
 * routes remain the only write path, enforcing creator tokens / sessions).
 *
 * Falls back to the anon key when the service key isn't configured, so the
 * app keeps working before the lockdown migration is applied. NEVER import
 * this from client components.
 */

let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  cached = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function isServiceRoleConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
