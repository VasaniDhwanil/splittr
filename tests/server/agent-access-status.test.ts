import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/agent-access/status/route';

const KEYS = ['MCP_ENABLED', 'AGENT_TOKEN_PEPPER', 'MCP_OAUTH_ENABLED', 'OAUTH_ISSUER', 'VERCEL_ENV'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
}

const ON = {
  MCP_ENABLED: 'true',
  AGENT_TOKEN_PEPPER: 'local-test-pepper-0123456789-abcdefghijk',
  MCP_OAUTH_ENABLED: 'true',
  VERCEL_ENV: 'production',
};

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('GET /api/agent-access/status', () => {
  it('says enabled when agent access and OAuth are both on', async () => {
    setEnv(ON);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('says disabled when agent access is off', async () => {
    setEnv({ ...ON, MCP_ENABLED: 'false' });
    expect(await (await GET()).json()).toEqual({ enabled: false });
  });

  it('says disabled when OAuth is off', async () => {
    setEnv({ ...ON, MCP_OAUTH_ENABLED: 'false' });
    expect(await (await GET()).json()).toEqual({ enabled: false });
  });

  it('needs no sign-in', async () => {
    setEnv(ON);
    expect((await GET()).status).toBe(200);
  });
});
