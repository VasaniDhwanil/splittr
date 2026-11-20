import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ApprovePage from '@/app/approve/[id]/page';
import { mockFetch } from './helpers-fetch';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'bill-1' }),
  useRouter: () => ({ push, replace: push }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const PROPOSAL = {
  id: 'bill-1',
  name: '<img src=x onerror=alert(1)> Dinner',
  items: [
    { name: '<b>Pasta</b> https://evil.example/x', price: 12.5, quantity: 2 },
    { name: 'Water', price: 0, quantity: 1 },
  ],
  subtotal: 25,
  tax: 2,
  tip_amount: 5,
  total: 32,
  split_mode: 'items',
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2099-01-02T00:00:00Z',
  token_name: 'Claude Code laptop',
  warnings: ['An item name looks like a web address.'],
};

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe('approve page', () => {
  it('signed out: explains and links to sign-in with next', async () => {
    const fx = mockFetch({ 'GET /api/agent-bills/bill-1': { status: 401, body: {} } });
    render(<ApprovePage />);
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/signin?next=/approve/bill-1');
    expect(fx.calls.map((c) => c.key)).toEqual(['GET /api/agent-bills/bill-1']);
  });

  it('renders what the agent wrote as plain text, labelled, with warnings', async () => {
    mockFetch({ 'GET /api/agent-bills/bill-1': { body: PROPOSAL } });
    const { container } = render(<ApprovePage />);
    expect(await screen.findByText('Written by your agent')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)> Dinner')).toBeInTheDocument();
    expect(screen.getByText('<b>Pasta</b> https://evil.example/x')).toBeInTheDocument();
    // Nothing the agent wrote became an element, and nothing became a link.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('a[href*="evil"]')).toBeNull();
    expect(screen.getByText('An item name looks like a web address.')).toBeInTheDocument();
    expect(screen.getByText(/2 × \$12\.50/)).toBeInTheDocument();
    expect(screen.getAllByText('$32.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Claude Code laptop/).length).toBeGreaterThan(0);
    expect(screen.getByText(/This proposal expires/)).toBeInTheDocument();
    expect(screen.getByText(/taps the items they had/i)).toBeInTheDocument();
  });

  it('changes nothing on load: only the one read', async () => {
    const fx = mockFetch({ 'GET /api/agent-bills/bill-1': { body: PROPOSAL } });
    render(<ApprovePage />);
    await screen.findByRole('button', { name: 'Approve' });
    expect(fx.calls.map((c) => c.key)).toEqual(['GET /api/agent-bills/bill-1']);
    expect(push).not.toHaveBeenCalled();
  });

  it('approves only when the button is pressed, then opens the bill', async () => {
    const fx = mockFetch({
      'GET /api/agent-bills/bill-1': { body: PROPOSAL },
      'POST /api/agent-bills/bill-1/approve': { body: { ok: true, bill_id: 'bill-1' } },
    });
    render(<ApprovePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/bill/bill-1'));
    expect(fx.calls.filter((c) => c.key.includes('approve'))).toHaveLength(1);
  });

  it('declines and goes home', async () => {
    mockFetch({
      'GET /api/agent-bills/bill-1': { body: PROPOSAL },
      'POST /api/agent-bills/bill-1/decline': { body: { ok: true } },
    });
    render(<ApprovePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  });

  it('404 on load says nothing to approve and does not guess why', async () => {
    mockFetch({ 'GET /api/agent-bills/bill-1': { status: 404, body: {} } });
    render(<ApprovePage />);
    expect(await screen.findByText('Nothing to approve here')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('410 on approve asks the agent to propose again', async () => {
    mockFetch({
      'GET /api/agent-bills/bill-1': { body: PROPOSAL },
      'POST /api/agent-bills/bill-1/approve': { status: 410, body: { code: 'expired' } },
    });
    render(<ApprovePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/propose the bill again/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('404 on approve shows nothing to approve', async () => {
    mockFetch({
      'GET /api/agent-bills/bill-1': { body: PROPOSAL },
      'POST /api/agent-bills/bill-1/approve': { status: 404, body: {} },
    });
    render(<ApprovePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Nothing to approve here')).toBeInTheDocument();
  });
});
