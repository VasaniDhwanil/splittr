import { execFileSync } from 'node:child_process';
import type { TestProject } from 'vitest/node';

export interface LocalSupabaseEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    supabaseEnv: LocalSupabaseEnv;
  }
}

const SUPABASE_CLI = 'supabase@2.122.0';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Tests write and delete freely, so they may only ever see a local stack. */
export function assertLocal(env: LocalSupabaseEnv): void {
  for (const [name, value] of [
    ['API URL', env.url],
    ['database URL', env.dbUrl],
  ] as const) {
    let host: string;
    try {
      host = new URL(value).hostname;
    } catch {
      throw new Error(`Server tests: the Supabase ${name} is missing or malformed`);
    }
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`Server tests refuse to run against a non-local Supabase ${name} (${host})`);
    }
  }
  // Without the service key the admin client silently falls back to the anon
  // key, which can read nothing: every "stranger sees nothing" test would
  // pass for the wrong reason.
  if (!env.serviceRoleKey || !env.anonKey) {
    throw new Error('Server tests need the local service-role and anon keys');
  }
}

function parseStatus(raw: string): LocalSupabaseEnv {
  const vars: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (match) vars[match[1]] = match[2];
  }
  return {
    url: vars.API_URL ?? '',
    anonKey: vars.ANON_KEY ?? '',
    serviceRoleKey: vars.SERVICE_ROLE_KEY ?? '',
    dbUrl: vars.DB_URL ?? '',
  };
}

export default function setup(project: TestProject): void {
  let raw: string;
  try {
    raw = execFileSync('npx', ['-y', SUPABASE_CLI, 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Local Supabase is not running. Start it with `npm run db:start`.');
  }
  const env = parseStatus(raw);
  assertLocal(env);
  project.provide('supabaseEnv', env);
}
