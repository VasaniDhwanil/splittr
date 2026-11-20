import { describe, expect, it } from 'vitest';
import { buildAgentCodeEmail, buildAgentTokenCreatedEmail, buildAgentTokenStoppedEmail } from '@/lib/agent-emails';

const hostile = '<img src=x onerror=alert(1)>"&\'';

describe('agent emails', () => {
  it('escape the token name and the reason in the html body', () => {
    const emails = [
      buildAgentCodeEmail({ tokenName: hostile, scopes: ['read'], code: '123456', ip: '1.2.3.4', minutes: 10 }),
      buildAgentTokenCreatedEmail({ tokenName: hostile, scopes: ['read', 'bills:write'], ip: '1.2.3.4', revokeUrl: 'https://www.splittr.cash/agent-tokens/revoke?s=abc' }),
      buildAgentTokenStoppedEmail({ tokenName: hostile, state: 'suspended', reason: hostile, profileUrl: 'https://www.splittr.cash/profile' }),
    ];
    for (const email of emails) {
      expect(email.html).not.toContain('<img');
      expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
  });

  it('escape a hostile client address', () => {
    const email = buildAgentCodeEmail({ tokenName: 'x', scopes: ['read'], code: '123456', ip: '<script>1</script>', minutes: 10 });
    expect(email.html).not.toContain('<script>');
  });

  it('carry the code and the revoke link in both html and text', () => {
    const code = buildAgentCodeEmail({ tokenName: 'Claude', scopes: ['read'], code: '042042', ip: 'unknown', minutes: 10 });
    expect(code.html).toContain('042042');
    expect(code.text).toContain('042042');
    const created = buildAgentTokenCreatedEmail({ tokenName: 'Claude', scopes: ['read'], ip: 'unknown', revokeUrl: 'https://www.splittr.cash/agent-tokens/revoke?s=abc' });
    expect(created.html).toContain('https://www.splittr.cash/agent-tokens/revoke?s=abc');
    expect(created.text).toContain('https://www.splittr.cash/agent-tokens/revoke?s=abc');
  });

  it('list what the scopes allow, and use no em-dashes', () => {
    const email = buildAgentCodeEmail({ tokenName: 'Claude', scopes: ['read', 'bills:write'], code: '123456', ip: 'unknown', minutes: 10 });
    expect(email.text).toContain('Read your bills');
    expect(email.text).toContain('Propose new bills');
    expect(email.html + email.text).not.toContain('—');
  });
});
