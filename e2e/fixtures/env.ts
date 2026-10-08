import fs from 'node:fs';
import path from 'node:path';

/** Repo root (this file lives in e2e/fixtures). */
export const ROOT = path.resolve(__dirname, '..', '..');

export const BASE_URL = (process.env.BASE_URL || 'https://www.splittr.cash').replace(/\/+$/, '');

/** Same defaults as scripts/api-scenario-test.sh. */
export const HOST_EMAIL = process.env.HOST_EMAIL || 'dhwanilvasani@gmail.com';
export const MEMBER_EMAIL = process.env.MEMBER_EMAIL || 'vasanidhwanil@gmail.com';

export const AUTH_DIR = path.join(ROOT, 'playwright', '.auth');
export const HOST_STATE = path.join(AUTH_DIR, 'host.json');
export const MEMBER_STATE = path.join(AUTH_DIR, 'member.json');

/** Tests that create/modify/delete data only run when this is set. */
export const WRITES_ENABLED = Boolean(process.env.E2E_WRITES);
export const WRITES_SKIP_REASON = 'set E2E_WRITES=1 to run tests that create and delete test data';

/**
 * Minimal .env.local reader (no dotenv): KEY=VALUE per line, optional
 * surrounding quotes, `#` comments ignored. Values are never logged.
 */
export function readEnvLocal(file = path.join(ROOT, '.env.local')): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** True once auth.setup.ts has written a session for this role. Checked at run time, not collection time. */
export function hasState(file: string): boolean {
  return fs.existsSync(file);
}

export const NO_AUTH_REASON =
  'no saved session: auth setup was skipped (SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL missing from .env.local) or failed';
