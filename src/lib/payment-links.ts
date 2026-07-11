import { Bill } from '@/types';

export interface PaymentOption {
  key: 'venmo' | 'cashapp' | 'paypal';
  label: string;
  handle: string;
  url: string;
  color: string; // brand color for the button
}

function cleanHandle(handle: string): string {
  return handle.trim().replace(/^[@$]/, '');
}

export interface PaymentHandles {
  venmo_handle?: string | null;
  cashapp_handle?: string | null;
  paypal_handle?: string | null;
}

export function getPaymentOptions(source: PaymentHandles, amount: number, note: string): PaymentOption[] {
  const options: PaymentOption[] = [];
  const amt = Math.max(0, amount).toFixed(2);

  if (source.venmo_handle) {
    const handle = cleanHandle(source.venmo_handle);
    options.push({
      key: 'venmo',
      label: 'Venmo',
      handle: `@${handle}`,
      url: `https://venmo.com/${encodeURIComponent(handle)}?txn=pay&amount=${amt}&note=${encodeURIComponent(note)}`,
      color: '#008CFF',
    });
  }

  if (source.cashapp_handle) {
    const handle = cleanHandle(source.cashapp_handle);
    options.push({
      key: 'cashapp',
      label: 'Cash App',
      handle: `$${handle}`,
      url: `https://cash.app/$${encodeURIComponent(handle)}/${amt}`,
      color: '#00D632',
    });
  }

  if (source.paypal_handle) {
    const handle = cleanHandle(source.paypal_handle);
    options.push({
      key: 'paypal',
      label: 'PayPal',
      handle: `@${handle}`,
      url: `https://paypal.me/${encodeURIComponent(handle)}/${amt}`,
      color: '#0070BA',
    });
  }

  return options;
}

export function billHasPaymentMethods(bill: Bill): boolean {
  return Boolean(bill.venmo_handle || bill.cashapp_handle || bill.paypal_handle);
}
