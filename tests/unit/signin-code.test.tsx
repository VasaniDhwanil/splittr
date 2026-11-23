import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignInPage from '@/app/signin/page';
import { safeNext } from '@/lib/safe-next';
import { mockFetch } from './helpers-fetch';

let search = '';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const signInWithOtp = vi.fn(async (_args: unknown) => ({ error: null as { message: string } | null }));
const verifyOtp = vi.fn(async (_args: unknown) => ({ error: null as { message: string } | null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithOtp, verifyOtp } }) }));

const assign = vi.fn();
const originalLocation = window.location;
beforeEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign, origin: 'http://localhost:3199', hash: '' } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.unstubAllGlobals();
  search = '';
  signInWithOtp.mockClear();
  verifyOtp.mockClear();
  assign.mockClear();
});

async function sendEmail() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: /Email me a/ }));
  await screen.findByText('Check your email');
}

describe('safeNext', () => {
  it.each([
    ['/profile', '/profile'],
    ['/oauth/consent/abc', '/oauth/consent/abc'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['evil', '/'],
    ['', '/'],
    [null, '/'],
  ])('%s -> %s', (raw, out) => expect(safeNext(raw as string | null)).toBe(out));
});

describe('sign-in code entry', () => {
  it('offers the code next to the link, verifies it as type email, creates the profile server-side, then goes to next', async () => {
    search = 'next=/profile';
    const fx = mockFetch({ 'POST /auth/finish': { body: { ok: true } } });
    render(<SignInPage />);
    await sendEmail();
    expect(screen.getByText(/Or open the link in the email on this device/)).toBeInTheDocument();
    const input = screen.getByLabelText('Enter the 6-digit code from the email');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(input, { target: { value: '12ab3456789' } });
    expect(input).toHaveValue('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/profile'));
    expect(verifyOtp).toHaveBeenCalledWith({ email: 'me@example.com', token: '123456', type: 'email' });
    expect(fx.calls.map((c) => c.key)).toEqual(['POST /auth/finish']);
  });

  it('a wrong code shows a plain message and does not navigate', async () => {
    verifyOtp.mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } });
    render(<SignInPage />);
    await sendEmail();
    fireEvent.change(screen.getByLabelText('Enter the 6-digit code from the email'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right or has expired');
    expect(assign).not.toHaveBeenCalled();
  });

  it('sanitises next: an off-site address ends at the home page', async () => {
    search = 'next=//evil.example/x';
    mockFetch({ 'POST /auth/finish': { body: { ok: true } } });
    render(<SignInPage />);
    await sendEmail();
    fireEvent.change(screen.getByLabelText('Enter the 6-digit code from the email'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(String((signInWithOtp.mock.calls[0]?.[0] as { options: { emailRedirectTo: string } }).options.emailRedirectTo)).toContain('next=%2F');
  });

  it('leads with the code and says why when next is a consent page', async () => {
    search = 'next=/oauth/consent/req-1';
    render(<SignInPage />);
    expect(screen.getByText(/keeps you in the window Claude opened/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeInTheDocument();
    await sendEmail();
    expect(screen.getByText('We sent a 6-digit code and a sign-in link to')).toBeInTheDocument();
    expect(screen.getByText(/Use the code, not the link/)).toBeInTheDocument();
    expect(screen.getByLabelText('Enter the 6-digit code from the email')).toHaveFocus();
  });

  it('does not lead with the code for an ordinary page', async () => {
    search = 'next=/profile';
    render(<SignInPage />);
    expect(screen.getByRole('button', { name: 'Email me a link' })).toBeInTheDocument();
    await sendEmail();
    expect(screen.queryByText(/Use the code, not the link/)).toBeNull();
  });
});
