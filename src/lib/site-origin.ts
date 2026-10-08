/** Where the app is served from. Links in outgoing email point here. */
export const CANONICAL_ORIGIN = 'https://www.splittr.cash';

// Origins allowed to receive the auth handoff (prod + local dev). Keep this
// in sync with the Supabase Auth "Redirect URLs" allowlist.
export const ALLOWED_ORIGINS = new Set([CANONICAL_ORIGIN, 'https://splittr.cash', 'http://localhost:3000']);

/**
 * Public origin for links we send to other people (invite emails). Never
 * derived from Host / X-Forwarded-Host alone: a forged header would put an
 * attacker's domain inside a genuine Splittr email.
 */
export function siteOrigin(request: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, '');
  const origin = new URL(request.url).origin;
  return ALLOWED_ORIGINS.has(origin) ? origin : CANONICAL_ORIGIN;
}
