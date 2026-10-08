import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZellePanel, ZelleChip, onPayLinkClick } from '@/components/pay-links';
import { BalanceRow } from '@/components/groups/balance-row';
import { getPaymentOptions, getZelleInfo } from '@/lib/payment-links';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setUserAgent(ua: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
}

describe('ZellePanel', () => {
  it('copies the phone digits and the amount', async () => {
    render(<ZellePanel zelle={getZelleInfo({ zelle_handle: '+15551234567' })!} amount={23.5} />);

    expect(screen.getByText('Send to phone')).toBeInTheDocument();
    fireEvent.click(screen.getByText('(555) 123-4567'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('5551234567'));

    fireEvent.click(screen.getByText('$23.50'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('23.50'));
  });

  it('labels an email recipient', () => {
    render(<ZellePanel zelle={getZelleInfo({ zelle_handle: 'jane@x.com' })!} amount={5} />);
    expect(screen.getByText('Send to email')).toBeInTheDocument();
    expect(screen.getByText('jane@x.com')).toBeInTheDocument();
  });

  it('reveals the QR on demand', () => {
    render(
      <ZellePanel zelle={getZelleInfo({ zelle_handle: 'j@x.com', zelle_qr_url: 'https://cdn/qr.png' })!} amount={5} />
    );
    expect(screen.queryByAltText('Zelle QR code')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show qr/i }));
    expect(screen.getByAltText('Zelle QR code')).toHaveAttribute('src', 'https://cdn/qr.png');

    fireEvent.click(screen.getByRole('button', { name: /hide qr/i }));
    expect(screen.queryByAltText('Zelle QR code')).not.toBeInTheDocument();
  });

  it('shows a QR-only recipient without a copy-recipient row', () => {
    render(<ZellePanel zelle={getZelleInfo({ zelle_qr_url: 'https://cdn/qr.png' })!} amount={5} />);
    expect(screen.getByRole('button', { name: /show qr/i })).toBeInTheDocument();
    expect(screen.queryByText(/send to/i)).not.toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('has no QR toggle without a QR', () => {
    render(<ZellePanel zelle={getZelleInfo({ zelle_handle: 'j@x.com' })!} amount={5} />);
    expect(screen.queryByRole('button', { name: /show qr/i })).not.toBeInTheDocument();
  });
});

describe('ZelleChip', () => {
  it('copies the bank-pasteable recipient, not the display form', async () => {
    render(<ZelleChip zelle={getZelleInfo({ zelle_handle: '+15551234567' })!} amount={12} name="Jane" />);
    fireEvent.click(screen.getByRole('button', { name: /copy jane's zelle/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('5551234567'));
  });

  it('renders nothing for a QR-only recipient', () => {
    const { container } = render(
      <ZelleChip zelle={getZelleInfo({ zelle_qr_url: 'https://cdn/qr.png' })!} amount={12} name="Jane" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('BalanceRow with Zelle', () => {
  const zelle = getZelleInfo({ zelle_handle: 'jane@x.com' });

  it('offers Zelle when you owe them, and drops the no-handles hint', () => {
    render(
      <BalanceRow name="Jane" isGuest={false} amount={20} payOptions={[]} zelle={zelle} isSettling={false} onSettle={() => {}} />
    );
    expect(screen.getByRole('button', { name: /copy jane's zelle/i })).toBeInTheDocument();
    expect(screen.queryByText(/hasn't added payment handles/i)).not.toBeInTheDocument();
  });

  it('hides Zelle when they owe you', () => {
    render(
      <BalanceRow name="Jane" isGuest={false} amount={-20} payOptions={[]} zelle={zelle} isSettling={false} onSettle={() => {}} />
    );
    expect(screen.queryByRole('button', { name: /zelle/i })).not.toBeInTheDocument();
  });

  it('still shows the no-handles hint when there is nothing to pay with', () => {
    render(
      <BalanceRow name="Jane" isGuest={false} amount={20} payOptions={[]} zelle={null} isSettling={false} onSettle={() => {}} />
    );
    expect(screen.getByText(/hasn't added payment handles/i)).toBeInTheDocument();
  });
});

describe('onPayLinkClick', () => {
  const [venmo] = getPaymentOptions({ venmo_handle: 'jane' }, 10, '');
  const [cash] = getPaymentOptions({ cashapp_handle: 'bob' }, 10, '');

  function clickLink(option: typeof venmo) {
    render(
      <a href={option.url} onClick={onPayLinkClick(option)}>
        pay
      </a>
    );
    // fireEvent returns false when the handler called preventDefault
    return fireEvent.click(screen.getByText('pay'));
  }

  it('lets the web link open on desktop', () => {
    setUserAgent(MAC);
    expect(clickLink(venmo)).toBe(true);
  });

  it('takes over Venmo clicks on phones to try the app', () => {
    setUserAgent(IPHONE);
    vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom: navigation not implemented
    vi.useFakeTimers();
    try {
      expect(clickLink(venmo)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves Cash App links alone on phones', () => {
    setUserAgent(IPHONE);
    expect(clickLink(cash)).toBe(true);
  });
});
