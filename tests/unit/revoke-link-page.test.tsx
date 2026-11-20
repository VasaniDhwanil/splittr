import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RevokeLinkPage from '@/app/agent-tokens/revoke/page';
import { mockFetch } from './helpers-fetch';

let search = 's=SECRET123';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }));

afterEach(() => {
  vi.unstubAllGlobals();
  search = 's=SECRET123';
});

describe('revoke link page', () => {
  it('makes no request when it loads', async () => {
    const fx = mockFetch({});
    render(<RevokeLinkPage />);
    expect(await screen.findByRole('button', { name: 'Revoke all agent tokens' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(fx.fn).not.toHaveBeenCalled();
    expect(screen.getByText(/every agent token on the account that email was sent for/i)).toBeInTheDocument();
  });

  it('posts the secret in the body, not the URL, when the button is pressed', async () => {
    const fx = mockFetch({ 'POST /api/agent-tokens/revoke-link': { body: { revoked: 3 } } });
    render(<RevokeLinkPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke all agent tokens' }));
    expect(await screen.findByText('3 tokens revoked')).toBeInTheDocument();
    expect(fx.calls).toHaveLength(1);
    expect(fx.calls[0].key).toBe('POST /api/agent-tokens/revoke-link');
    expect(JSON.parse(String(fx.calls[0].init?.body))).toEqual({ secret: 'SECRET123' });
    expect(screen.getByText(/Revoke all and sign out everywhere/)).toBeInTheDocument();
  });

  it('says so when it was already used (zero revoked)', async () => {
    mockFetch({ 'POST /api/agent-tokens/revoke-link': { body: { revoked: 0 } } });
    render(<RevokeLinkPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke all agent tokens' }));
    expect(await screen.findByText('No tokens left to revoke')).toBeInTheDocument();
  });

  it('404 says the link is not valid or already used', async () => {
    mockFetch({ 'POST /api/agent-tokens/revoke-link': { status: 404, body: {} } });
    render(<RevokeLinkPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke all agent tokens' }));
    expect(await screen.findByText('This link does not work')).toBeInTheDocument();
    expect(screen.getByText(/not valid, or it was already used/i)).toBeInTheDocument();
  });

  it('a link with no secret has no button and calls nothing', async () => {
    search = '';
    const fx = mockFetch({});
    render(<RevokeLinkPage />);
    expect(await screen.findByText('This link does not work')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(fx.fn).not.toHaveBeenCalled();
  });

  it('a network failure can be retried', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<RevokeLinkPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke all agent tokens' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Revoke all agent tokens' })).not.toBeDisabled();
  });
});
