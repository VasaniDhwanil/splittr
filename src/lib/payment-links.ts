export interface PaymentOption {
  key: 'venmo' | 'cashapp' | 'paypal';
  label: string;
  handle: string;
  url: string;
  /** Native-app deep link, tried first on phones; `url` is the fallback. */
  appUrl?: string;
  color: string; // brand color for the button
}

function cleanHandle(handle: string): string {
  return handle.trim().replace(/^[@$]/, '');
}

export interface PaymentHandles {
  venmo_handle?: string | null;
  cashapp_handle?: string | null;
  paypal_handle?: string | null;
  /** Normalized email (lowercase) or US phone (+1XXXXXXXXXX). */
  zelle_handle?: string | null;
  /** Signed URL for the owner's uploaded Zelle QR screenshot. */
  zelle_qr_url?: string | null;
}

export function getPaymentOptions(source: PaymentHandles, amount: number, note: string): PaymentOption[] {
  const options: PaymentOption[] = [];
  const amt = Math.max(0, amount).toFixed(2);

  if (source.venmo_handle) {
    const handle = cleanHandle(source.venmo_handle);
    const query = `txn=pay&recipients=${encodeURIComponent(handle)}&amount=${amt}&note=${encodeURIComponent(note)}`;
    options.push({
      key: 'venmo',
      label: 'Venmo',
      handle: `@${handle}`,
      url: `https://account.venmo.com/pay?${query}`,
      appUrl: `venmo://paycharge?${query}`,
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

export function billHasPaymentMethods(source: PaymentHandles): boolean {
  return Boolean(
    source.venmo_handle || source.cashapp_handle || source.paypal_handle || source.zelle_handle || source.zelle_qr_url
  );
}

export function isMobileUserAgent(ua: string): boolean {
  return /iPhone|iPad|iPod|Android/i.test(ua);
}

export interface OpenEnv {
  userAgent: string;
  navigate: (url: string) => void;
  isHidden: () => boolean;
  schedule: (fn: () => void, ms: number) => void;
}

/** How long to wait for the native app to take over before using the web link. */
export const APP_LAUNCH_GRACE_MS = 1500;

/**
 * On phones, try the native app first; if the page is still in the
 * foreground after a beat (app not installed), fall back to the web link.
 * Returns false when the caller should let the plain <a href> open instead.
 */
export function openPaymentOption(option: PaymentOption, env: OpenEnv): boolean {
  if (!option.appUrl || !isMobileUserAgent(env.userAgent)) return false;
  env.navigate(option.appUrl);
  env.schedule(() => {
    if (!env.isHidden()) env.navigate(option.url);
  }, APP_LAUNCH_GRACE_MS);
  return true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Zelle has no deep link, so all we keep is the recipient: an email or a US
 * phone number. Returns the normalized form, or null when it is neither.
 */
export function normalizeZelleHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.includes('@')) {
    const email = value.toLowerCase();
    return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
  }
  if (!/^[\d\s()+.\-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export const ZELLE_INPUT_ERROR = 'Zelle needs an email or a US phone number';

/**
 * A zelle_handle field from a request body: omitted leaves it unchanged
 * (value undefined), null/blank clears it, anything else must normalize.
 */
export function parseZelleInput(raw: unknown): { ok: true; value: string | null | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || (typeof raw === 'string' && !raw.trim())) return { ok: true, value: null };
  const value = normalizeZelleHandle(raw);
  return value ? { ok: true, value } : { ok: false };
}

export interface ZelleInfo {
  kind: 'email' | 'phone' | null;
  display: string | null;
  /** What the payer pastes into their bank app's Zelle recipient field. */
  copyValue: string | null;
  qrUrl: string | null;
}

export function getZelleInfo(source: PaymentHandles): ZelleInfo | null {
  const handle = source.zelle_handle || null;
  const qrUrl = source.zelle_qr_url || null;
  if (!handle && !qrUrl) return null;
  if (!handle) return { kind: null, display: null, copyValue: null, qrUrl };
  const phone = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(handle);
  if (phone) {
    return { kind: 'phone', display: `(${phone[1]}) ${phone[2]}-${phone[3]}`, copyValue: phone.slice(1).join(''), qrUrl };
  }
  return { kind: 'email', display: handle, copyValue: handle, qrUrl };
}
