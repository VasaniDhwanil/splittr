import fs from 'node:fs';
import { test as setup, expect } from '@playwright/test';
import {
  AUTH_DIR,
  BASE_URL,
  HOST_EMAIL,
  HOST_STATE,
  MEMBER_EMAIL,
  MEMBER_STATE,
  readEnvLocal,
} from './env';

/**
 * Mints real sessions the same way scripts/api-scenario-test.sh does:
 * the Supabase admin generate_link API returns a hashed magic-link token,
 * and visiting {BASE}/auth/callback?token_hash=...&type=email makes the app
 * set its session cookies. The resulting storageState is saved per role.
 *
 * Never log the service key, the token, or cookies.
 */

const env = readEnvLocal();
const SUPA_URL = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const MISSING_KEY_REASON =
  'SUPABASE_SERVICE_ROLE_KEY and/or NEXT_PUBLIC_SUPABASE_URL missing from .env.local: ' +
  'skipping session setup, auth-dependent specs will skip';

const roles = [
  { role: 'host', email: HOST_EMAIL, file: HOST_STATE },
  { role: 'member', email: MEMBER_EMAIL, file: MEMBER_STATE },
] as const;

for (const { role, email, file } of roles) {
  setup(`authenticate ${role}`, async ({ page, playwright }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      // A stale session file would make dependents run with an unverified login
      fs.rmSync(file, { force: true });
      setup.skip(true, MISSING_KEY_REASON);
    }

    const admin = await playwright.request.newContext();
    let hashedToken = '';
    try {
      const res = await admin.post(`${SUPA_URL}/auth/v1/admin/generate_link`, {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        data: { type: 'magiclink', email },
      });
      // Status only; the body carries the token
      expect(res.status(), `generate_link for ${role} returned HTTP ${res.status()}`).toBe(200);
      const body = (await res.json()) as { hashed_token?: string; properties?: { hashed_token?: string } };
      hashedToken = body.hashed_token || body.properties?.hashed_token || '';
    } finally {
      await admin.dispose();
    }
    expect(hashedToken.length > 0, `generate_link for ${role} returned no hashed_token`).toBe(true);

    const callback = `${BASE_URL}/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=email`;
    await page.goto(callback);
    // A failed verify redirects to /signin?error=...
    await expect(page, `${role} magic-link callback was rejected`).not.toHaveURL(/\/signin\?error=/);

    const cookies = await page.context().cookies();
    expect(
      cookies.some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token')),
      `no Supabase auth cookie after callback for ${role}`
    ).toBe(true);

    // Confirm the session is honored by an authenticated, read-only endpoint
    const check = await page.request.get('/api/groups');
    expect(check.status(), `${role} session not accepted by /api/groups`).toBe(200);

    fs.mkdirSync(AUTH_DIR, { recursive: true });
    await page.context().storageState({ path: file });
  });
}
