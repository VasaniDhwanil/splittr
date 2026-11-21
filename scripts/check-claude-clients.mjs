#!/usr/bin/env node
// Fetches Claude's two client identity documents (read-only GETs to claude.ai)
// and exits non-zero if either differs from the copy pinned in
// src/lib/oauth/pinned-clients.json. Splittr never fetches these at request
// time (docs/specs/mcp-oauth.md A4); run this before launch and now and then.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pinned = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/lib/oauth/pinned-clients.json', import.meta.url)), 'utf8')
);
const FIELDS = ['client_id', 'redirect_uris', 'token_endpoint_auth_method', 'grant_types', 'response_types'];

let failed = false;
for (const client of pinned) {
  let doc;
  try {
    const res = await fetch(client.client_id, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    doc = await res.json();
  } catch (error) {
    console.error(`FAIL ${client.client_id}: could not fetch (${error.message})`);
    failed = true;
    continue;
  }
  const diffs = FIELDS.filter((field) => JSON.stringify(doc[field]) !== JSON.stringify(client[field]));
  if (diffs.length) {
    failed = true;
    console.error(`DIFF ${client.client_id}`);
    for (const field of diffs) {
      console.error(`  ${field}: pinned ${JSON.stringify(client[field])}, claude.ai ${JSON.stringify(doc[field])}`);
    }
  } else {
    console.log(`OK   ${client.client_id}`);
  }
}
process.exit(failed ? 1 : 0);
