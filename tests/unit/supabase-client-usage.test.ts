import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// R-O1: every route learns who is signed in through createClient() from
// @/lib/supabase/server, which refuses OAuth access tokens. A file under
// src/app that built its own Supabase client from the cookies would skip that.
const ROOT = join(__dirname, '..', '..', 'src', 'app');
const ALLOWED = new Set(['@/lib/supabase/server', '@/lib/supabase/admin', '@/lib/supabase/client']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

describe('Supabase clients under src/app', () => {
  it('finds source files to check', () => {
    expect(sourceFiles(ROOT).length).toBeGreaterThan(20);
  });

  it('only come from the three wrappers, never from the SDK packages', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      // Type-only imports create nothing at runtime.
      const text = readFileSync(file, 'utf8').replace(/import\s+type\s[^;]*?from\s*['"][^'"]+['"]/g, '');
      const rel = relative(ROOT, file);
      for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const spec = match[1];
        if (/^@supabase\//.test(spec)) offenders.push(`${rel} imports ${spec}`);
        if (/supabase\/(server|admin|client)/.test(spec) && !ALLOWED.has(spec)) offenders.push(`${rel} imports ${spec}`);
      }
      if (/\bcreate(Server|Browser)Client\b/.test(text)) offenders.push(`${rel} calls createServerClient/createBrowserClient`);
    }
    expect(offenders).toEqual([]);
  });
});
