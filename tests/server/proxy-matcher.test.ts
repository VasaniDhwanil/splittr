import { describe, expect, it } from 'vitest';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config } from '@/proxy';
import nextConfig from '../../next.config';

// The session proxy must never run for the agent endpoint: that route
// authenticates with a bearer token only and may not read or set cookies.
const runsOn = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig, url });

describe('session proxy matcher', () => {
  it('skips the agent endpoint', () => {
    expect(runsOn('/api/mcp')).toBe(false);
    expect(runsOn('/api/mcp/anything')).toBe(false);
  });

  it('still covers pages and the cookie-authenticated API', () => {
    expect(runsOn('/')).toBe(true);
    expect(runsOn('/profile')).toBe(true);
    expect(runsOn('/api/bills/mine')).toBe(true);
    expect(runsOn('/api/agent-tokens')).toBe(true);
  });
});
