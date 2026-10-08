import { describe, expect, it } from 'vitest';
import {
  getPaymentOptions,
  billHasPaymentMethods,
  isMobileUserAgent,
  normalizeZelleHandle,
  parseZelleInput,
  getZelleInfo,
  openPaymentOption,
  APP_LAUNCH_GRACE_MS,
  type PaymentOption,
} from '@/lib/payment-links';
import { sniffImageType, validateQrUpload, MAX_QR_BYTES } from '@/lib/zelle-qr';

const NOTE = 'Splittr: Tacos & beer';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('getPaymentOptions', () => {
  const [venmo] = getPaymentOptions({ venmo_handle: '@jane-doe' }, 12.3, NOTE);

  it('gives Venmo a prefilled web link and app link', () => {
    expect(venmo.handle).toBe('@jane-doe');
    expect(venmo.url).toBe(
      'https://account.venmo.com/pay?txn=pay&recipients=jane-doe&amount=12.30&note=Splittr%3A%20Tacos%20%26%20beer'
    );
    expect(venmo.appUrl).toBe(
      'venmo://paycharge?txn=pay&recipients=jane-doe&amount=12.30&note=Splittr%3A%20Tacos%20%26%20beer'
    );
  });

  it('never sends a negative amount', () => {
    expect(getPaymentOptions({ venmo_handle: 'x' }, -5, '')[0].appUrl).toBe(
      'venmo://paycharge?txn=pay&recipients=x&amount=0.00&note='
    );
  });

  it('URL-encodes the handle', () => {
    const [weird] = getPaymentOptions({ venmo_handle: ' a&b=c ' }, 1, '');
    expect(weird.appUrl).toContain('recipients=a%26b%3Dc');
  });

  it('keeps Cash App and PayPal links unchanged, without app links', () => {
    const [cash] = getPaymentOptions({ cashapp_handle: '$bob' }, 7, NOTE);
    expect(cash.url).toBe('https://cash.app/$bob/7.00');
    expect(cash.appUrl).toBeUndefined();
    const [pp] = getPaymentOptions({ paypal_handle: 'bobpp' }, 7.5, NOTE);
    expect(pp.url).toBe('https://paypal.me/bobpp/7.50');
  });

  it('orders options venmo, cashapp, paypal and leaves Zelle out', () => {
    const keys = getPaymentOptions(
      { venmo_handle: 'a', cashapp_handle: 'b', paypal_handle: 'c', zelle_handle: 'z@z.com' },
      1,
      ''
    ).map((o) => o.key);
    expect(keys).toEqual(['venmo', 'cashapp', 'paypal']);
  });
});

describe('isMobileUserAgent', () => {
  it.each([
    ['iPhone', IPHONE, true],
    ['Android', ANDROID, true],
    ['desktop Mac', MAC, false],
    ['empty', '', false],
  ])('%s -> %s', (_label, ua, mobile) => {
    expect(isMobileUserAgent(ua)).toBe(mobile);
  });
});

describe('openPaymentOption', () => {
  const [venmo] = getPaymentOptions({ venmo_handle: 'jane' }, 10, '');
  const [cash] = getPaymentOptions({ cashapp_handle: 'bob' }, 10, '');

  function run(option: PaymentOption, ua: string, appTakesOver: boolean) {
    const nav: string[] = [];
    let pending: (() => void) | null = null;
    let delay = 0;
    let hidden = false;
    const handled = openPaymentOption(option, {
      userAgent: ua,
      navigate: (u) => {
        nav.push(u);
        if (u.startsWith('venmo://')) hidden = appTakesOver;
      },
      isHidden: () => hidden,
      schedule: (fn, ms) => {
        pending = fn;
        delay = ms;
      },
    });
    return { handled, nav, delay, fire: () => pending?.() };
  }

  it('leaves desktop clicks to the plain link', () => {
    const r = run(venmo, MAC, false);
    expect(r.handled).toBe(false);
    expect(r.nav).toEqual([]);
  });

  it('opens the app on phones and stays there when it takes over', () => {
    const r = run(venmo, IPHONE, true);
    expect(r.handled).toBe(true);
    expect(r.delay).toBe(APP_LAUNCH_GRACE_MS);
    r.fire();
    expect(r.nav).toEqual([venmo.appUrl]);
  });

  it('falls back to the web link when the app is not installed', () => {
    const r = run(venmo, ANDROID, false);
    r.fire();
    expect(r.nav).toEqual([venmo.appUrl, venmo.url]);
  });

  it('never intercepts options without an app link', () => {
    expect(run(cash, IPHONE, false).handled).toBe(false);
  });
});

describe('normalizeZelleHandle', () => {
  it.each([
    ['  Jane.Doe@Gmail.COM ', 'jane.doe@gmail.com'],
    ['(555) 123-4567', '+15551234567'],
    ['1-555-123-4567', '+15551234567'],
    ['+1 555.123.4567', '+15551234567'],
  ])('accepts %j', (raw, expected) => {
    expect(normalizeZelleHandle(raw)).toBe(expected);
  });

  it.each([
    ['short phone', '555-1234'],
    ['non-US number', '+44 20 7946 0958'],
    ['junk', 'venmo-handle'],
    ['bad email', 'a@b'],
    ['blank', '   '],
    ['overlong email', `${'a'.repeat(250)}@x.com`],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeZelleHandle(raw)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(normalizeZelleHandle(42)).toBeNull();
  });
});

describe('parseZelleInput', () => {
  it('distinguishes omitted, cleared, valid, and invalid', () => {
    expect(parseZelleInput(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseZelleInput(null)).toEqual({ ok: true, value: null });
    expect(parseZelleInput('  ')).toEqual({ ok: true, value: null });
    expect(parseZelleInput('555-123-4567')).toEqual({ ok: true, value: '+15551234567' });
    expect(parseZelleInput('nope')).toEqual({ ok: false });
    expect(parseZelleInput(5551234567)).toEqual({ ok: false });
  });
});

describe('getZelleInfo', () => {
  it('is null without a handle or QR', () => {
    expect(getZelleInfo({ venmo_handle: 'x' })).toBeNull();
  });

  it('describes an email recipient', () => {
    expect(getZelleInfo({ zelle_handle: 'jane@x.com' })).toEqual({
      kind: 'email',
      display: 'jane@x.com',
      copyValue: 'jane@x.com',
      qrUrl: null,
    });
  });

  it('formats a phone for display and copies digits', () => {
    expect(getZelleInfo({ zelle_handle: '+15551234567' })).toEqual({
      kind: 'phone',
      display: '(555) 123-4567',
      copyValue: '5551234567',
      qrUrl: null,
    });
  });

  it('works with a QR alone', () => {
    expect(getZelleInfo({ zelle_qr_url: 'https://x/qr.png' })).toEqual({
      kind: null,
      display: null,
      copyValue: null,
      qrUrl: 'https://x/qr.png',
    });
  });
});

describe('billHasPaymentMethods', () => {
  it('counts Zelle handles and QRs alongside the deep-link apps', () => {
    expect(billHasPaymentMethods({})).toBe(false);
    expect(billHasPaymentMethods({ zelle_handle: 'a@b.com' })).toBe(true);
    expect(billHasPaymentMethods({ zelle_qr_url: 'https://x' })).toBe(true);
    expect(billHasPaymentMethods({ venmo_handle: 'a' })).toBe(true);
  });
});

describe('Zelle QR upload validation', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
  const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

  it('sniffs types by magic bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPG)).toBe('image/jpeg');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(sniffImageType(GIF)).toBeNull();
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89]))).toBeNull();
  });

  it('accepts real images and rejects everything else', () => {
    expect(validateQrUpload(PNG)).toEqual({ ok: true, contentType: 'image/png', ext: 'png' });
    expect(validateQrUpload(JPG)).toEqual({ ok: true, contentType: 'image/jpeg', ext: 'jpg' });
    expect(validateQrUpload(SVG)).toEqual({ ok: false, error: 'Upload a PNG, JPEG, or WebP image' });
    expect(validateQrUpload(new Uint8Array())).toEqual({ ok: false, error: 'The image is empty' });
  });

  it('enforces the 2 MB cap inclusively', () => {
    const atLimit = new Uint8Array(MAX_QR_BYTES);
    atLimit.set(PNG);
    expect(validateQrUpload(atLimit).ok).toBe(true);
    const over = new Uint8Array(MAX_QR_BYTES + 1);
    over.set(PNG);
    expect(validateQrUpload(over)).toEqual({ ok: false, error: 'The image must be under 2 MB' });
  });
});
