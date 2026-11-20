import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Home from '@/app/page';
import { mockFetch } from './helpers-fetch';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'me@example.com' } } }),
      signOut: async () => ({}),
    },
  }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  short_code: id.toUpperCase(),
  status: 'active',
  subtotal: 10,
  tax: 1,
  tip_amount: 2,
  created_at: new Date(Date.now() - 3600_000).toISOString(),
  ...extra,
});

const routes = (mine: unknown[]) => ({
  'GET /api/bills/mine': { body: mine },
  'GET /api/groups': { body: [] },
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('home page and agent proposals', () => {
  it('keeps pending rows out of the normal list and shows them under their own heading', async () => {
    mockFetch(
      routes([
        row('p1', 'Proposed dinner', { approval: 'pending', created_via: 'agent', approval_expires_at: new Date(Date.now() + 5 * 3600_000).toISOString() }),
        row('n1', 'Normal lunch', { approval: 'none', created_via: 'web', approval_expires_at: null }),
      ])
    );
    render(<Home />);
    const section = await screen.findByRole('region', { name: 'Waiting for your approval' });
    const pendingLink = within(section).getByRole('link', { name: 'Proposed dinner' });
    expect(pendingLink).toHaveAttribute('href', '/approve/p1');
    expect(within(section).getByText(/Expires in 5 hours/)).toBeInTheDocument();

    const normal = await screen.findByRole('link', { name: 'Normal lunch' });
    expect(normal).toHaveAttribute('href', '/bill/n1');
    // The proposal appears once, and never as a bill link.
    expect(screen.getAllByText('Proposed dinner')).toHaveLength(1);
    expect(document.querySelector('a[href="/bill/p1"]')).toBeNull();
  });

  it('labels approved agent bills quietly', async () => {
    mockFetch(routes([row('a1', 'Agent dinner', { approval: 'none', created_via: 'agent' }), row('w1', 'Web lunch', { approval: 'none', created_via: 'web' })]));
    render(<Home />);
    await screen.findByRole('link', { name: 'Agent dinner' });
    expect(screen.getAllByText('Created by your agent')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Waiting for your approval' })).not.toBeInTheDocument();
  });

  it('works with rows from an older database that lack the new fields', async () => {
    mockFetch(routes([row('o1', 'Old bill one'), row('o2', 'Old bill two')]));
    render(<Home />);
    expect(await screen.findByRole('link', { name: 'Old bill one' })).toHaveAttribute('href', '/bill/o1');
    expect(screen.getByRole('link', { name: 'Old bill two' })).toBeInTheDocument();
    expect(screen.queryByText('Waiting for your approval')).not.toBeInTheDocument();
    expect(screen.queryByText('Created by your agent')).not.toBeInTheDocument();
  });

  it('shows no section when nothing is pending', async () => {
    mockFetch(routes([row('n1', 'Normal lunch', { approval: 'none' })]));
    render(<Home />);
    await screen.findByRole('link', { name: 'Normal lunch' });
    await waitFor(() => expect(screen.queryByText('Waiting for your approval')).not.toBeInTheDocument());
  });
});
