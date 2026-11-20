// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  TOKEN_PREFIX,
  agentPepper,
  generateAgentToken,
  generateEmailCode,
  hashAgentToken,
  hmacEmailCode,
  isWellFormedAgentToken,
  parseScopes,
} from '@/lib/agent-tokens';

describe('agent token format', () => {
  it('is a recognisable prefix plus 256 random bits', () => {
    const { token, hash, last4 } = generateAgentToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token).toMatch(/^spl_pat_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64url')).toHaveLength(32);
    expect(last4).toBe(token.slice(-4));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(TOKEN_PREFIX.length));
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateAgentToken().token));
    expect(tokens.size).toBe(200);
  });

  it('hashes deterministically', () => {
    const { token, hash } = generateAgentToken();
    expect(hashAgentToken(token)).toBe(hash);
    expect(hashAgentToken(token + 'x')).not.toBe(hash);
  });

  it('rejects anything that is not exactly a token', () => {
    const { token } = generateAgentToken();
    expect(isWellFormedAgentToken(token)).toBe(true);
    for (const bad of [
      '',
      null,
      undefined,
      42,
      token.slice(0, -1),
      token + 'A',
      ` ${token}`,
      token.replace('spl_pat_', 'spl_pat-'),
      token.replace('spl_pat_', ''),
      'spl_pat_' + '!'.repeat(43),
      `Bearer ${token}`,
    ]) {
      expect(isWellFormedAgentToken(bad)).toBe(false);
    }
  });
});

describe('email codes', () => {
  it('are six digits', () => {
    for (let i = 0; i < 200; i++) expect(generateEmailCode()).toMatch(/^\d{6}$/);
  });

  it('are stored as an HMAC bound to the account', () => {
    const pepper = 'p'.repeat(32);
    const a = hmacEmailCode(pepper, 'user-a', '123456');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacEmailCode(pepper, 'user-a', '123456')).toBe(a);
    expect(hmacEmailCode(pepper, 'user-b', '123456')).not.toBe(a);
    expect(hmacEmailCode(pepper, 'user-a', '123457')).not.toBe(a);
    expect(hmacEmailCode('q'.repeat(32), 'user-a', '123456')).not.toBe(a);
  });
});

describe('the server secret', () => {
  it('counts only when it is long enough', () => {
    expect(agentPepper({})).toBeNull();
    expect(agentPepper({ AGENT_TOKEN_PEPPER: '' })).toBeNull();
    expect(agentPepper({ AGENT_TOKEN_PEPPER: 'short' })).toBeNull();
    expect(agentPepper({ AGENT_TOKEN_PEPPER: 'x'.repeat(31) })).toBeNull();
    expect(agentPepper({ AGENT_TOKEN_PEPPER: 'x'.repeat(32) })).toBe('x'.repeat(32));
  });
});

describe('scopes', () => {
  it('accepts the known scopes without duplicates', () => {
    expect(parseScopes(['read'])).toEqual(['read']);
    expect(parseScopes(['bills:write', 'read', 'read'])).toEqual(['read', 'bills:write']);
  });

  it('refuses anything else', () => {
    for (const bad of [[], ['admin'], ['read', 'payments:write'], 'read', null, [1], ['READ']]) {
      expect(parseScopes(bad)).toBeNull();
    }
  });
});
