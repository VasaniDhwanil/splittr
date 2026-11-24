import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreatePage from '@/app/create/page';
import { mockFetch } from './helpers-fetch';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('@/lib/prepare-receipt-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/prepare-receipt-image')>()),
  prepareReceiptImage: async (file: File) => file,
}));

const ITEMS = [
  { name: 'Burger', price: 40, quantity: 1 },
  { name: 'Fries', price: 20, quantity: 2 },
];

function scanReceipt(tip: number) {
  const fx = mockFetch({
    'POST /api/scan': { body: { is_receipt: true, items: ITEMS, subtotal: 80, tax: 6, tip, total: 86 + tip } },
    'POST /api/bills': {
      body: { id: 'b1', short_code: 'abc123', creator_participant_id: 'p1', creator_token: 't1' },
    },
  });
  const { container } = render(<CreatePage />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
  return fx;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('create page: tip from a scanned receipt', () => {
  it('shows the tip the bill charged as an exact amount and sends it with the bill', async () => {
    const fx = scanReceipt(12.4);
    expect(await screen.findByText('Tip amount')).toBeTruthy();
    expect((screen.getByLabelText('Or an exact amount') as HTMLInputElement).value).toBe('12.4');
    expect(screen.getByText('$12.40')).toBeTruthy();
    // no percentage is selected while an exact tip is set
    expect(screen.getByRole('radio', { name: '18%' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Tip (exact)')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Tip split' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Bill name'), { target: { value: 'Dinner' } });
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Dhwanil' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create bill' }));
    await waitFor(() => expect(fx.calls.some((c) => c.key === 'POST /api/bills')).toBe(true));
    const body = JSON.parse(String(fx.calls.find((c) => c.key === 'POST /api/bills')!.init?.body));
    expect(body.tip_amount).toBe(12.4);
  });

  it('keeps the 18% default when the bill shows no tip', async () => {
    scanReceipt(0);
    expect(await screen.findByText('Tip amount')).toBeTruthy();
    expect((screen.getByLabelText('Or an exact amount') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('radio', { name: '18%' }).getAttribute('aria-checked')).toBe('true');
    // (80 + 6) * 18%
    expect(screen.getByText('$15.48')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Tip (18%)')).toBeTruthy();
  });
});
