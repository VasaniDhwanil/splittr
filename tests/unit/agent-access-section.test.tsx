import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentAccess } from '@/components/agent/agent-access';
import { mockFetch } from './helpers-fetch';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: push }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const base = {
  scopes: ['read'],
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  last_used_at: null,
  last_used_ip: null,
  suspended_reason: null,
  revoked_reason: null,
};
const TOKENS = [
  { ...base, id: 'a', name: 'Active one', last4: 'aaaa', status: 'active', scopes: ['read', 'bills:write'], last_used_at: '2026-01-02T00:00:00Z', last_used_ip: '203.0.113.9' },
  { ...base, id: 'b', name: 'Paused one', last4: 'bbbb', status: 'suspended', suspended_reason: 'Three bills declined in an hour' },
  { ...base, id: 'c', name: 'Old one', last4: 'cccc', status: 'expired' },
  { ...base, id: 'd', name: 'Gone one', last4: 'dddd', status: 'revoked', revoked_reason: 'user' },
];
const LIST = { body: { enabled: true, mcp_url: 'https://www.splittr.cash/api/mcp', tokens: TOKENS } };

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe('AgentAccess section', () => {
  it('renders nothing when the feature is off', async () => {
    const fx = mockFetch({ 'GET /api/agent-tokens': { body: { enabled: false, mcp_url: 'x', tokens: [] } } });
    const { container } = render(<AgentAccess />);
    await waitFor(() => expect(fx.calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['a server error', { status: 500, body: { error: 'x' } }],
    ['a sign-in error', { status: 401, body: { error: 'x' } }],
  ])('renders nothing after %s', async (_n, route) => {
    const fx = mockFetch({ 'GET /api/agent-tokens': route });
    const { container } = render(<AgentAccess />);
    await waitFor(() => expect(fx.calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the request itself fails', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fn);
    const { container } = render(<AgentAccess />);
    await waitFor(() => expect(fn).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lists tokens with plain scope labels and each state', async () => {
    mockFetch({ 'GET /api/agent-tokens': LIST });
    render(<AgentAccess />);
    expect(await screen.findByText('https://www.splittr.cash/api/mcp')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Your agent tokens' });
    const rows = within(list).getAllByRole('listitem', { name: '' }).filter((li) => li.parentElement === list);
    expect(rows).toHaveLength(4);

    expect(within(rows[0]).getByText('Read your bills, groups and balances')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Propose new bills (each one waits for your approval)')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Active')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/from 203\.0\.113\.9/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('Paused: Three bills declined in an hour')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'Turn back on' })).toBeInTheDocument();
    expect(within(rows[1]).getByText('Never used')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Expired', { selector: 'span span' })).toBeInTheDocument();
    expect(within(rows[3]).getByText('Revoked by you')).toBeInTheDocument();
    // Finished tokens have nothing to press.
    expect(within(rows[2]).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rows[3]).queryByRole('button')).not.toBeInTheDocument();
  });

  it('asks before revoking, then revokes', async () => {
    const fx = mockFetch({
      'GET /api/agent-tokens': LIST,
      'DELETE /api/agent-tokens/a': { body: { ok: true } },
    });
    render(<AgentAccess />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Active one' }));
    expect(fx.calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(fx.calls.some((c) => c.key === 'DELETE /api/agent-tokens/a')).toBe(true));
  });

  it('turns a paused token back on', async () => {
    const fx = mockFetch({
      'GET /api/agent-tokens': LIST,
      'POST /api/agent-tokens/b/resume': { body: { ok: true } },
    });
    render(<AgentAccess />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn back on' }));
    await waitFor(() => expect(fx.calls.some((c) => c.key === 'POST /api/agent-tokens/b/resume')).toBe(true));
  });

  it('revoke all explains the sign-out, asks first, then goes to sign-in', async () => {
    const fx = mockFetch({
      'GET /api/agent-tokens': LIST,
      'POST /api/agent-tokens/revoke-all': { body: { revoked: 2, signed_out: true } },
    });
    render(<AgentAccess />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke all and sign out everywhere' }));
    expect(screen.getByText(/signed out on every device, including this one/i)).toBeInTheDocument();
    expect(fx.calls.some((c) => c.key.includes('revoke-all'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all and sign out' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/signin'));
  });

  it('does not go to sign-in when revoke all fails', async () => {
    mockFetch({
      'GET /api/agent-tokens': LIST,
      'POST /api/agent-tokens/revoke-all': { status: 500, body: { error: 'x' } },
    });
    render(<AgentAccess />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke all and sign out everywhere' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all and sign out' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke all and sign out' })).not.toBeDisabled());
    expect(push).not.toHaveBeenCalled();
  });

  it('shows OAuth connections as connections, with the Connect Claude explainer and personal tokens as the secondary option', async () => {
    const oauth = [
      { ...base, id: 'o1', name: 'Claude', kind: 'oauth', destination: 'claude.ai', last4: null, status: 'active', scopes: ['read', 'bills:write'], last_used_at: '2026-01-02T00:00:00Z' },
      { ...base, id: 'o2', name: 'Claude Code', kind: 'oauth', destination: 'loopback', last4: null, status: 'suspended', suspended_reason: 'Three bills declined in an hour' },
      { ...base, id: 'o3', name: 'Claude', kind: 'oauth', destination: 'claude.ai', last4: null, status: 'revoked', revoked_reason: 'user' },
    ];
    const fx = mockFetch({
      'GET /api/agent-tokens': { body: { enabled: true, mcp_url: 'https://www.splittr.cash/api/mcp', tokens: [...oauth, TOKENS[0]] } },
      'POST /api/agent-tokens/o2/resume': { body: { ok: true } },
      'DELETE /api/agent-tokens/o1': { body: { ok: true } },
    });
    render(<AgentAccess />);
    expect((await screen.findAllByText('Claude (claude.ai)')).length).toBe(2);
    expect(screen.getByText('Claude Code on a computer')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Your Claude connections' });
    expect(within(list).getAllByText('Connected')).toHaveLength(3);
    expect(within(list).queryByText(/\.\.\./)).toBeNull(); // no last4 for connections
    expect(within(list).getByText('Paused: Three bills declined in an hour')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Your agent tokens' })).toHaveTextContent('Active one');
    // The explainer
    expect(screen.getByText('Connect Claude')).toBeInTheDocument();
    expect(screen.getByText('claude mcp add --transport http splittr https://www.splittr.cash/api/mcp')).toBeInTheDocument();
    expect(screen.getByText(/Add custom connector/)).toBeInTheDocument();
    expect(screen.getByText(/with www, and nothing after/)).toBeInTheDocument();
    expect(screen.getByText(/For other apps, or if you prefer not to sign in/)).toBeInTheDocument();
    // Turn back on a paused connection
    fireEvent.click(within(list).getByRole('button', { name: 'Turn back on' }));
    await waitFor(() => expect(fx.calls.some((c) => c.key === 'POST /api/agent-tokens/o2/resume')).toBe(true));
    // Revoke asks first
    fireEvent.click(within(list).getByRole('button', { name: 'Revoke Claude (claude.ai)' }));
    expect(await screen.findByText('Revoke this connection?')).toBeInTheDocument();
    expect(fx.calls.some((c) => c.key === 'DELETE /api/agent-tokens/o1')).toBe(false);
  });
});
