import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as revoke } from '@/app/api/oauth/revoke/route';
import { generateAgentToken } from '@/lib/agent-tokens';
import { resetFailures } from '@/lib/oauth/throttle';
import { billExists, insertProposal } from './helpers/agent';
import { createUser, db } from './helpers/db';
import {
  CLAUDE_CODE_CLIENT_ID,
  HOSTED_CLIENT_ID,
  connect,
  enableOAuth,
  formRequest,
  grantRow,
  oauthTokens,
} from './helpers/oauth-server';

let restore: () => void;
beforeAll(() => {
  restore = enableOAuth();
});
afterAll(() => restore());
beforeEach(() => resetFailures());
afterEach(() => vi.restoreAllMocks());

const post = (fields: Record<string, string> | string, headers: Record<string, string> = {}) =>
  revoke(formRequest('/api/oauth/revoke', fields, headers));

describe('POST /api/oauth/revoke (RFC 7009)', () => {
  for (const which of ['access', 'refresh'] as const) {
    it(`revoking the ${which} token revokes the grant, both tokens, the proposals; the hint is only a hint`, async () => {
      const user = await createUser('rev');
      const { pair, grantId } = await connect(user);
      const proposal = await insertProposal(user, grantId);
      // a wrong hint still works
      const res = await post({ token: pair[which], token_type_hint: which === 'access' ? 'refresh_token' : 'access_token', client_id: CLAUDE_CODE_CLIENT_ID });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await grantRow(grantId)).toMatchObject({ revoked_reason: 'oauth_revoked' });
      expect(await oauthTokens(grantId)).toHaveLength(0);
      expect(await billExists(proposal)).toBe(false);
      const { data } = await db().from('agent_audit_log').select('tool, outcome').eq('token_id', grantId);
      expect(data).toEqual([{ tool: 'oauth', outcome: 'revoked_by_client' }]);
    });
  }

  it('revokes only that grant', async () => {
    const user = await createUser('rev2');
    const a = await connect(user);
    const b = await connect(user);
    await post({ token: a.pair.access, client_id: CLAUDE_CODE_CLIENT_ID });
    expect((await grantRow(b.grantId)).revoked_at).toBeNull();
    expect(await oauthTokens(b.grantId)).toHaveLength(2);
  });

  it('is 200 for unknown, malformed, forged, already revoked, personal and foreign-client tokens, changing nothing', async () => {
    const user = await createUser('rev3');
    const { pair, grantId } = await connect(user);
    const generate = (await import('@/lib/oauth/tokens')).generateOAuthTokenPair;
    const from = vi.spyOn(db(), 'from');
    const rpc = vi.spyOn(db(), 'rpc');
    for (const token of ['junk', 'spl_oat_', generateAgentToken().token, `${pair.access}x`, pair.access.slice(0, -1) + 'A'.repeat(1)]) {
      const res = await post({ token, client_id: CLAUDE_CODE_CLIENT_ID });
      expect(res.status, token).toBe(200);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    // well-formed but unknown
    expect((await post({ token: generate().access, client_id: CLAUDE_CODE_CLIENT_ID })).status).toBe(200);
    // another client's id cannot revoke it
    expect((await post({ token: pair.access, client_id: HOSTED_CLIENT_ID })).status).toBe(200);
    expect((await grantRow(grantId)).revoked_at).toBeNull();
    // twice
    expect((await post({ token: pair.access, client_id: CLAUDE_CODE_CLIENT_ID })).status).toBe(200);
    expect((await post({ token: pair.access, client_id: CLAUDE_CODE_CLIENT_ID })).status).toBe(200);
  });

  it('refuses a missing token or client_id, an unknown client, a JSON body and a repeated parameter', async () => {
    const { pair } = await connect(await createUser('rev4'));
    expect((await post({ client_id: CLAUDE_CODE_CLIENT_ID })).status).toBe(400);
    expect((await post({ token: pair.access })).status).toBe(400);
    const unknown = await post({ token: pair.access, client_id: 'https://evil.example/c' });
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error).toBe('invalid_client');
    expect((await post(`token=${pair.access}&token=${pair.access}&client_id=${encodeURIComponent(CLAUDE_CODE_CLIENT_ID)}`)).status).toBe(400);
    const { NextRequest } = await import('next/server');
    const json = await revoke(
      new NextRequest('http://localhost:3199/api/oauth/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: pair.access, client_id: CLAUDE_CODE_CLIENT_ID }),
      })
    );
    expect(json.status).toBe(400);
    expect((await post({ token: pair.access, client_id: CLAUDE_CODE_CLIENT_ID }, { authorization: 'Basic eDp5' })).status).toBe(200);
  });

  it('is 503 on a database error, and revokes nothing', async () => {
    const { pair, grantId } = await connect(await createUser('rev5'));
    vi.spyOn(db(), 'rpc').mockResolvedValue({ data: null, error: { message: 'down', code: '57P01', details: '', hint: '' } } as never);
    const res = await post({ token: pair.refresh, client_id: CLAUDE_CODE_CLIENT_ID });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    vi.restoreAllMocks();
    expect((await grantRow(grantId)).revoked_at).toBeNull();
  });

  it('is 503 when OAuth is off', async () => {
    const off = enableOAuth();
    delete process.env.MCP_OAUTH_ENABLED;
    expect((await post({ token: 'x', client_id: CLAUDE_CODE_CLIENT_ID })).status).toBe(503);
    off();
    restore = enableOAuth();
  });
});
