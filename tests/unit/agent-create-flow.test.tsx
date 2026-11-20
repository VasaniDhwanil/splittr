import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateTokenDialog } from '@/components/agent/create-token-dialog';
import { mockFetch } from './helpers-fetch';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const TOKEN = 'spl_pat_TESTTOKENVALUE1234567890abcdefghijklmnop';
const URL_ = 'https://www.splittr.cash/api/mcp';
const MINTED = {
  token: TOKEN,
  id: 't1',
  name: 'My laptop',
  scopes: ['read'],
  last4: 'mnop',
  expires_at: '2026-12-31T00:00:00Z',
};

function open(onCreated = vi.fn()) {
  const onOpenChange = vi.fn();
  render(<CreateTokenDialog open onOpenChange={onOpenChange} mcpUrl={URL_} onCreated={onCreated} />);
  return { onCreated, onOpenChange };
}

async function toCodeStep(extraRoutes: Parameters<typeof mockFetch>[0]) {
  const fx = mockFetch({
    'POST /api/agent-tokens': { body: { ok: true, code_expires_at: '2026-01-01T12:10:00Z' } },
    ...extraRoutes,
  });
  const cbs = open();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My laptop' } });
  fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
  await screen.findByLabelText('Code');
  return { fx, ...cbs };
}

async function enterCode(code: string) {
  fireEvent.change(screen.getByLabelText('Code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('create token flow', () => {
  it('sends the name, scopes and expiry, with read on and proposing off by default', async () => {
    const { fx } = await toCodeStep({});
    const body = JSON.parse(String(fx.calls[0].init?.body));
    expect(body).toEqual({ name: 'My laptop', scopes: ['read'], expires_in_days: 30 });
  });

  it('turns on proposing and a 7 day expiry when chosen', async () => {
    const fx = mockFetch({ 'POST /api/agent-tokens': { body: { ok: true, code_expires_at: '2026-01-01T12:10:00Z' } } });
    open();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Propose bills' }));
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await screen.findByLabelText('Code');
    expect(JSON.parse(String(fx.calls[0].init?.body))).toEqual({
      name: 'x',
      scopes: ['read', 'bills:write'],
      expires_in_days: 7,
    });
  });

  it('asks for a name before calling anything', () => {
    const fx = mockFetch({});
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/name/i);
    expect(fx.calls).toHaveLength(0);
  });

  it('the code box is a one-time-code field and keeps digits only', async () => {
    await toCodeStep({});
    const input = screen.getByLabelText('Code') as HTMLInputElement;
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(input, { target: { value: '12a3 4567' } });
    expect(input.value).toBe('123456');
  });

  it('shows attempts left after a wrong code and clears the box', async () => {
    await toCodeStep({
      'POST /api/agent-tokens/verify': { status: 400, body: { error: 'x', code: 'wrong_code', attempts_left: 3 } },
    });
    await enterCode('111111');
    expect(await screen.findByRole('alert')).toHaveTextContent('3 tries left');
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('');
  });

  it.each([
    ['expired', 400, /expired/i],
    ['no_pending', 400, /no code waiting/i],
    ['too_many_attempts', 400, /too many wrong tries/i],
    ['token_limit', 409, /5 active/i],
    ['locked', 429, /locked/i],
  ])('verify error %s gets its own message', async (code, status, pattern) => {
    await toCodeStep({ 'POST /api/agent-tokens/verify': { status, body: { error: 'x', code } } });
    await enterCode('222222');
    expect(await screen.findByRole('alert')).toHaveTextContent(pattern);
  });

  it.each([
    ['token_limit', 409, /5 active/i],
    ['locked', 429, /locked/i],
    ['rate_limited', 429, /too many codes/i],
    ['email_unavailable', 503, /could not send the email/i],
  ])('request error %s gets its own message and stays on the first step', async (code, status, pattern) => {
    mockFetch({ 'POST /api/agent-tokens': { status, body: { error: 'x', code, retry_after: 120 } } });
    open();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(pattern);
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();
  });

  it('can ask for a new code', async () => {
    const { fx } = await toCodeStep({});
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await waitFor(() => expect(fx.calls.filter((c) => c.key === 'POST /api/agent-tokens')).toHaveLength(2));
    expect(await screen.findByText(/new code is on its way/i)).toBeInTheDocument();
  });

  it('shows the token once, with the warnings, and keeps it out of storage and the URL', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { onCreated, onOpenChange } = await toCodeStep({
      'POST /api/agent-tokens/verify': { body: MINTED },
    });
    await enterCode('123456');
    expect(await screen.findByTestId('agent-token-value')).toHaveTextContent(TOKEN);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith();

    expect(screen.getByText(/will not show it again/i)).toBeInTheDocument();
    expect(screen.getByText(/out of files that get shared or committed/i)).toBeInTheDocument();
    expect(screen.getByText(/connector that a whole team shares on claude\.ai/i)).toBeInTheDocument();

    // The token is in no snippet: those use an environment variable.
    expect(screen.getByTestId('agent-setup-snippet').textContent).toContain('${SPLITTR_TOKEN}');
    expect(document.body.textContent?.split(TOKEN).length).toBe(2);

    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    expect(window.location.href).not.toContain('spl_pat_');

    // The only way out is the button.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('shows the generic form for other clients', async () => {
    await toCodeStep({ 'POST /api/agent-tokens/verify': { body: MINTED } });
    await enterCode('123456');
    await screen.findByTestId('agent-token-value');
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
    expect(screen.getByTestId('agent-setup-snippet')).toHaveTextContent(`URL: ${URL_}`);
    expect(screen.getByTestId('agent-setup-snippet')).toHaveTextContent('Header: Authorization: Bearer <your token>');
  });

  it('drops the token when the dialog is closed and reopened', async () => {
    mockFetch({
      'POST /api/agent-tokens': { body: { ok: true, code_expires_at: '2026-01-01T12:10:00Z' } },
      'POST /api/agent-tokens/verify': { body: MINTED },
    });
    const onOpenChange = vi.fn();
    const { rerender } = render(<CreateTokenDialog open onOpenChange={onOpenChange} mcpUrl={URL_} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await screen.findByLabelText('Code');
    await enterCode('123456');
    await screen.findByTestId('agent-token-value');
    rerender(<CreateTokenDialog open={false} onOpenChange={onOpenChange} mcpUrl={URL_} onCreated={() => {}} />);
    rerender(<CreateTokenDialog open onOpenChange={onOpenChange} mcpUrl={URL_} onCreated={() => {}} />);
    expect(screen.queryByTestId('agent-token-value')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(TOKEN);
  });
});
