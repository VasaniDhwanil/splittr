import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectPage } from '@/components/agent/connect-page';
import { ConnectEntryCard } from '@/components/agent/connect-entry-card';
import { ConnectFooterLink } from '@/components/landing/connect-footer-link';
import { AgentAccess } from '@/components/agent/agent-access';
import Home from '@/app/page';
import { metadata } from '@/app/connect/page';
import { mockFetch } from './helpers-fetch';

const auth = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: auth.user } }),
      signOut: async () => ({}),
    },
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const URL_ = 'https://www.splittr.cash/api/mcp';
const ON = { 'GET /api/agent-access/status': { body: { enabled: true } } };
const OFF = { 'GET /api/agent-access/status': { body: { enabled: false } } };

const connection = {
  id: 'c1',
  name: 'Claude',
  kind: 'oauth',
  destination: 'claude.ai',
  last4: null,
  scopes: ['read', 'bills:write'],
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  last_used_at: null,
  last_used_ip: null,
  status: 'active',
  suspended_reason: null,
  revoked_reason: null,
};
const tokens = (rows: unknown[]) => ({
  'GET /api/agent-tokens': { body: { enabled: true, mcp_url: URL_, tokens: rows } },
});

const writeText = vi.fn(async () => {});

beforeEach(() => {
  auth.user = null;
  localStorage.clear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  writeText.mockClear();
});

describe('connect page', () => {
  it('shows a Coming soon state, and no instructions, when the feature is off', async () => {
    mockFetch(OFF);
    render(<ConnectPage />);
    expect(await screen.findByRole('heading', { name: 'Coming soon' })).toBeInTheDocument();
    expect(screen.queryByText(URL_)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy address' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Use with Claude' })).toBeNull();
  });

  it('shows Coming soon when the status call fails', async () => {
    mockFetch({ 'GET /api/agent-access/status': { status: 500, body: {} } });
    render(<ConnectPage />);
    expect(await screen.findByRole('heading', { name: 'Coming soon' })).toBeInTheDocument();
  });

  it('shows the steps, the examples and the safety facts to a signed-out visitor', async () => {
    const fx = mockFetch(ON);
    render(<ConnectPage />);
    expect(await screen.findByRole('heading', { name: 'Use Splittr from Claude' })).toBeInTheDocument();
    expect(screen.getByText('What do I owe Sam this month?')).toBeInTheDocument();
    expect(screen.getByText('Split this receipt with Priya and Alex.')).toBeInTheDocument();
    expect(screen.getByText(/Claude can only propose bills/)).toBeInTheDocument();
    expect(screen.getByText(/disconnect at any time on your profile/)).toBeInTheDocument();
    expect(screen.getByText(URL_)).toBeInTheDocument();
    expect(screen.getByText(/Type it exactly as shown/)).toBeInTheDocument();
    expect(screen.getByText('claude.ai, Desktop and mobile')).toBeInTheDocument();
    expect(screen.getByText(/Add custom connector/)).toBeInTheDocument();
    expect(screen.getByText(`claude mcp add --transport http splittr ${URL_}`)).toBeInTheDocument();
    expect(screen.getByText(/Claude will ask you to sign in to Splittr/)).toBeInTheDocument();
    expect(screen.queryByText('Your connections')).toBeNull();
    expect(fx.calls.map((c) => c.key)).not.toContain('GET /api/agent-tokens');
  });

  it('lists a signed-in visitor’s Claude connections and links to the profile', async () => {
    auth.user = { id: 'u1', email: 'me@example.com' };
    mockFetch({
      ...ON,
      ...tokens([
        connection,
        { ...connection, id: 'c2', destination: 'loopback', status: 'revoked' },
        { ...connection, id: 'p1', name: 'Cursor', kind: 'pat', destination: null, last4: 'abcd' },
      ]),
    });
    render(<ConnectPage />);
    const list = await screen.findByRole('list', { name: 'Your Claude connections' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Claude (claude.ai)')).toBeInTheDocument();
    expect(within(list).getByText(/Never used/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage on your profile' })).toHaveAttribute('href', '/profile');
    expect(screen.queryByText(/Claude will ask you to sign in/)).toBeNull();
  });

  it('says so when a signed-in visitor has no connections', async () => {
    auth.user = { id: 'u1', email: 'me@example.com' };
    mockFetch({ ...ON, ...tokens([]) });
    render(<ConnectPage />);
    expect(await screen.findByText(/No Claude connections yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage on your profile' })).toBeInTheDocument();
  });

  it('uses the address the API returns', async () => {
    auth.user = { id: 'u1', email: 'me@example.com' };
    mockFetch({
      ...ON,
      'GET /api/agent-tokens': { body: { enabled: true, mcp_url: 'https://example.test/api/mcp', tokens: [] } },
    });
    render(<ConnectPage />);
    expect(await screen.findByText('https://example.test/api/mcp')).toBeInTheDocument();
  });

  it('copies the address and the command', async () => {
    mockFetch(ON);
    render(<ConnectPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy address' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_));
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`claude mcp add --transport http splittr ${URL_}`)
    );
  });

  it('is not indexed and has a title and description', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toBe('Use Splittr from Claude');
    expect(String(metadata.description)).toMatch(/Claude/);
  });

  it('uses no em-dashes in its copy', async () => {
    mockFetch(ON);
    const { container } = render(<ConnectPage />);
    await screen.findByRole('heading', { name: 'Use Splittr from Claude' });
    expect(container.textContent).not.toMatch(/—/);
  });
});

describe('entry points', () => {
  it('home card and footer link appear when the feature is on', async () => {
    mockFetch(ON);
    render(
      <>
        <ConnectEntryCard />
        <ConnectFooterLink />
      </>
    );
    expect(await screen.findByRole('link', { name: /Use Splittr from Claude/ })).toHaveAttribute('href', '/connect');
    expect(screen.getByRole('link', { name: 'Use with Claude' })).toHaveAttribute('href', '/connect');
  });

  it('home card and footer link stay hidden when the feature is off', async () => {
    const fx = mockFetch(OFF);
    const { container } = render(
      <>
        <ConnectEntryCard />
        <ConnectFooterLink />
      </>
    );
    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('stay hidden when the status call fails', async () => {
    const fx = mockFetch({ 'GET /api/agent-access/status': { status: 500, body: {} } });
    const { container } = render(<ConnectEntryCard />);
    await waitFor(() => expect(fx.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('the signed-in home page shows the card only when on', async () => {
    auth.user = { id: 'u1', email: 'me@example.com' };
    mockFetch({ ...ON, 'GET /api/bills/mine': { body: [] }, 'GET /api/groups': { body: [] } });
    const { unmount } = render(<Home />);
    expect(await screen.findByText('Use Splittr from Claude')).toBeInTheDocument();
    unmount();

    mockFetch({ ...OFF, 'GET /api/bills/mine': { body: [] }, 'GET /api/groups': { body: [] } });
    render(<Home />);
    await screen.findByText('Your Groups');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Use Splittr from Claude')).toBeNull();
  });

  it('the profile link to /connect shows only when on', async () => {
    const list = tokens([]);
    mockFetch({ ...ON, ...list });
    const { unmount } = render(<AgentAccess />);
    expect(await screen.findByRole('link', { name: 'Open the connect page' })).toHaveAttribute('href', '/connect');
    unmount();

    mockFetch({ ...OFF, ...list });
    render(<AgentAccess />);
    await screen.findByText('Connect Claude');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('link', { name: 'Open the connect page' })).toBeNull();
  });
});
