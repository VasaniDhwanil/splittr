import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConsentPage from '@/app/oauth/consent/[id]/page';
import { mockFetch } from './helpers-fetch';

const replace = vi.fn();
const signOut = vi.fn(async () => ({ error: null }));
const router = { push: replace, replace };
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'req-1' }),
  useRouter: () => router,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut } }) }));

const assign = vi.fn();
const originalLocation = window.location;
beforeEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.unstubAllGlobals();
  replace.mockClear();
  assign.mockClear();
  signOut.mockClear();
});

const HOSTED = {
  id: 'req-1',
  destination: 'claude.ai',
  destination_label: 'claude.ai',
  redirect_host: 'claude.ai',
  client_name: 'Claude',
  requested_scopes: ['read', 'bills:write'],
  expires_at: '2099-01-01T00:00:00Z',
  account_email: 'me@example.com',
  step_up: { fresh_sign_in_ok: false, code_required: true, code_sent: false },
  existing: [{ id: 'g1', destination: 'claude.ai', connected_at: '2026-03-04T12:00:00Z', scopes: ['read'] }],
  replace_default: true,
};
const CODE_APP = {
  ...HOSTED,
  destination: 'loopback',
  redirect_host: 'localhost',
  client_name: 'Claude Code',
  step_up: { fresh_sign_in_ok: true, code_required: false, code_sent: false },
  existing: [],
  replace_default: false,
};
const GET = 'GET /api/agent-oauth/requests/req-1';
const APPROVE = 'POST /api/agent-oauth/requests/req-1/approve';
const DENY = 'POST /api/agent-oauth/requests/req-1/deny';
const CODE = 'POST /api/agent-oauth/requests/req-1/code';

async function readyHosted(extra: Record<string, unknown> = {}) {
  const fx = mockFetch({ [GET]: { body: HOSTED }, ...extra } as never);
  const view = render(<ConsentPage />);
  await screen.findByText('me@example.com');
  return { fx, view };
}

describe('consent page', () => {
  it('signed out: goes to sign-in with next', async () => {
    mockFetch({ [GET]: { status: 401, body: {} } });
    render(<ConsentPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/signin?next=/oauth/consent/req-1'));
  });

  it('404 shows the expired text and nothing else', async () => {
    mockFetch({ [GET]: { status: 404, body: {} } });
    render(<ConsentPage />);
    expect(
      await screen.findByText('This sign-in request has expired or was opened somewhere else. Go back to Claude and press Connect again.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('posts nothing on load', async () => {
    const { fx } = await readyHosted();
    await new Promise((r) => setTimeout(r, 30));
    expect(fx.calls.map((c) => c.key)).toEqual([GET]);
    expect(assign).not.toHaveBeenCalled();
  });

  it('hosted: names Claude from the destination, shows host, account, warning; client_name is never the heading', async () => {
    await readyHosted();
    expect(screen.getByText('Claude (claude.ai, the Desktop app and the mobile apps)')).toBeInTheDocument();
    expect(screen.getByText('claude.ai', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText(/Only continue if you pressed Connect in Claude on this device in the last few minutes\. If someone sent you this link, stop: approving would give their Claude access to your Splittr\./)).toBeInTheDocument();
    expect(screen.getByText(/calls itself/)).toHaveTextContent('calls itself “Claude”');
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toMatch(/calls itself/);
    expect(screen.getByRole('button', { name: 'Not you? Switch account' })).toBeInTheDocument();
    expect(screen.getByText('This lasts 90 days.', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/any program running on this computer/i)).toBeNull();
  });

  it('loopback: app on this computer, with the extra warning, and the client name stays secondary', async () => {
    mockFetch({ [GET]: { body: { ...CODE_APP, client_name: 'Totally Trusted Bank' } } });
    render(<ConsentPage />);
    await screen.findByText('An app on this computer, such as Claude Code');
    expect(screen.getByText(/any program running on this computer/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toMatch(/Totally Trusted Bank/);
    expect(screen.getByText(/calls itself/)).toHaveTextContent('Totally Trusted Bank');
  });

  it('the write scope is a checkbox, off by default; read has none', async () => {
    await readyHosted();
    const box = screen.getByRole('checkbox', { name: /Propose new bills \(each one waits for your approval on Splittr\)/ });
    expect(box).not.toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2); // propose + replace
    expect(screen.getByText('Read your bills, groups and balances')).toBeInTheDocument();
  });

  it('replace defaults to replace_default and names the date; absent when nothing exists', async () => {
    await readyHosted();
    const replaceBox = screen.getByRole('checkbox', { name: /Replace my existing Claude connection from Mar 4, 2026/ });
    expect(replaceBox).toBeChecked();
    mockFetch({ [GET]: { body: { ...CODE_APP, existing: [{ id: 'g', destination: 'loopback', connected_at: '2026-03-04T12:00:00Z', scopes: ['read'] }] } } });
    render(<ConsentPage />);
    const codeBox = await screen.findByRole('checkbox', { name: /Replace my existing Claude Code connection/ });
    expect(codeBox).not.toBeChecked();
  });

  it('fresh sign-in: says no code is needed and approve is enabled', async () => {
    mockFetch({ [GET]: { body: CODE_APP } });
    render(<ConsentPage />);
    expect(await screen.findByText('You signed in a moment ago, so no extra code is needed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send me a code' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('hosted: send a code, then a 6-digit one-time-code input gates approve', async () => {
    const { fx } = await readyHosted({ [CODE]: { body: { code_expires_at: new Date(Date.now() + 600000).toISOString() } } });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    const input = await screen.findByLabelText('6-digit code');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(input, { target: { value: '12345' } });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(fx.calls.filter((c) => c.key === CODE)).toHaveLength(1);
  });

  it('approve sends scopes, replace and code, then location.assign with the returned URL and no form submit', async () => {
    const url = 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s&iss=x';
    const submit = vi.fn();
    document.addEventListener('submit', submit);
    const { fx } = await readyHosted({
      [CODE]: { body: { code_expires_at: new Date(Date.now() + 600000).toISOString() } },
      [APPROVE]: { body: { redirect_url: url } },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Propose new bills/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(url));
    const call = fx.calls.find((c) => c.key === APPROVE)!;
    expect(JSON.parse(String(call.init?.body))).toEqual({ scopes: ['read', 'bills:write'], replace: true, code: '654321' });
    expect(await screen.findByText('Returning you to Claude…')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    document.removeEventListener('submit', submit);
  });

  it('read only by default: scopes is just read', async () => {
    const { fx } = await (async () => {
      mockFetch({ [GET]: { body: CODE_APP }, [APPROVE]: { body: { redirect_url: 'http://localhost:5/cb?code=1' } } });
      render(<ConsentPage />);
      await screen.findByText('me@example.com');
      return { fx: null };
    })();
    void fx;
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://localhost:5/cb?code=1'));
  });

  it('deny posts and navigates to the returned URL', async () => {
    const url = 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=s';
    const { fx } = await readyHosted({ [DENY]: { body: { redirect_url: url } } });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(url));
    expect(fx.calls.some((c) => c.key === APPROVE)).toBe(false);
  });

  async function approveWithError(status: number, body: unknown) {
    mockFetch({
      [GET]: { body: { ...HOSTED, step_up: { ...HOSTED.step_up, code_sent: true } } },
      [APPROVE]: { status, body },
    });
    render(<ConsentPage />);
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  }

  it('wrong_code: says how many tries are left', async () => {
    await approveWithError(400, { code: 'wrong_code', attempts_left: 3 });
    expect(await screen.findByText('That code is not right. 3 tries left.')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('wrong_code with none left asks for a new code', async () => {
    await approveWithError(400, { code: 'wrong_code', attempts_left: 0 });
    expect(await screen.findByText(/out of tries\. Ask for a new code/)).toBeInTheDocument();
  });

  it('code_required in plain words', async () => {
    await approveWithError(400, { code: 'code_required' });
    expect(await screen.findByText(/Enter the 6-digit code we emailed you/)).toBeInTheDocument();
  });

  it('locked says when it unlocks', async () => {
    await approveWithError(429, { code: 'locked', retry_after: 23 * 3600 });
    expect(await screen.findByText(/It unlocks in about 23 hours/)).toBeInTheDocument();
  });

  it('expired on approve shows the expired text', async () => {
    await approveWithError(400, { code: 'expired' });
    expect(await screen.findByText(/has expired or was opened somewhere else/)).toBeInTheDocument();
  });

  it('grant_limit links to the profile', async () => {
    await approveWithError(409, { code: 'grant_limit' });
    expect(await screen.findByText(/You have 5 connections already\. Remove one on your/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'profile' })).toHaveAttribute('href', '/profile');
  });

  it.each([
    [429, { code: 'rate_limited', retry_after: 1800 }, /asked for too many codes\. Try again in 30 minutes/],
    [503, { code: 'email_unavailable' }, /could not send the email just now/],
  ])('sending a code: %s is handled', async (status, body, text) => {
    mockFetch({ [GET]: { body: HOSTED }, [CODE]: { status, body } });
    render(<ConsentPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('Not you? signs out and goes back through sign-in to this page', async () => {
    await readyHosted();
    fireEvent.click(screen.getByRole('button', { name: 'Not you? Switch account' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/signin?next=/oauth/consent/req-1'));
    expect(signOut).toHaveBeenCalled();
  });
});
