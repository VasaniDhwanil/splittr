import { generateAgentToken, hmacEmailCode } from '@/lib/agent-tokens';
import { db } from './db';
import type { TestUser } from './session';

export const TEST_PEPPER = 'test-pepper-0123456789-0123456789-abcdef';

/** Turns the feature on for a test file; returns a function that puts the environment back. */
export function enableAgentAccess(): () => void {
  const before = { enabled: process.env.MCP_ENABLED, pepper: process.env.AGENT_TOKEN_PEPPER };
  process.env.MCP_ENABLED = 'true';
  process.env.AGENT_TOKEN_PEPPER = TEST_PEPPER;
  return () => {
    for (const [key, value] of [
      ['MCP_ENABLED', before.enabled],
      ['AGENT_TOKEN_PEPPER', before.pepper],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/** Writes the account's pending row as POST /api/agent-tokens would. */
export async function seedPending(
  user: TestUser,
  opts: {
    code?: string;
    name?: string;
    scopes?: string[];
    days?: number;
    attempts?: number;
    expiresAt?: Date;
    consumed?: boolean;
  } = {}
) {
  const { error } = await db()
    .from('agent_token_pending')
    .upsert({
      user_id: user.id,
      name: opts.name ?? 'My agent',
      scopes: opts.scopes ?? ['read'],
      expires_in_days: opts.days ?? 30,
      code_hmac: hmacEmailCode(TEST_PEPPER, user.id, opts.code ?? '123456'),
      attempts: opts.attempts ?? 0,
      created_at: new Date().toISOString(),
      expires_at: (opts.expiresAt ?? new Date(Date.now() + 10 * 60_000)).toISOString(),
      consumed_at: opts.consumed ? new Date().toISOString() : null,
    });
  if (error) throw new Error(`seedPending failed: ${error.message}`);
}

/** Calls mint_agent_token directly, the way the verify route does. */
export async function callMint(user: TestUser, code: string) {
  const minted = generateAgentToken();
  const { data, error } = await db().rpc('mint_agent_token', {
    p_user_id: user.id,
    p_code_hmac: hmacEmailCode(TEST_PEPPER, user.id, code),
    p_token_hash: minted.hash,
    p_last4: minted.last4,
    p_revoke_link_hash: 'x'.repeat(64),
  });
  if (error) throw new Error(`mint_agent_token failed: ${error.message}`);
  return { result: data as { status: string; attempts_left?: number; id?: string }, minted };
}

export async function insertToken(
  user: TestUser,
  opts: { name?: string; scopes?: string[]; expiresAt?: Date; revokedAt?: Date | null; suspendedAt?: Date | null; revokeLinkHash?: string } = {}
) {
  const minted = generateAgentToken();
  const { data, error } = await db()
    .from('agent_tokens')
    .insert({
      user_id: user.id,
      name: opts.name ?? 'Seeded',
      token_hash: minted.hash,
      last4: minted.last4,
      scopes: opts.scopes ?? ['read'],
      expires_at: (opts.expiresAt ?? new Date(Date.now() + 86_400_000)).toISOString(),
      revoked_at: opts.revokedAt?.toISOString() ?? null,
      suspended_at: opts.suspendedAt?.toISOString() ?? null,
      revoke_link_hash: opts.revokeLinkHash ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertToken failed: ${error?.message}`);
  return { id: data.id as string, token: minted.token, hash: minted.hash };
}

export const activeTokens = async (user: TestUser) => {
  const { data } = await db().from('agent_tokens').select('id').eq('user_id', user.id).is('revoked_at', null);
  return data ?? [];
};
