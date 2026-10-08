// Payment deep links + Zelle helpers.
// Run: npx tsx scripts/payment-links-test.ts

import {
  getPaymentOptions,
  billHasPaymentMethods,
  isMobileUserAgent,
  normalizeZelleHandle,
  getZelleInfo,
  parseZelleInput,
  openPaymentOption,
} from '../src/lib/payment-links';
import { sniffImageType, validateQrUpload, MAX_QR_BYTES } from '../src/lib/zelle-qr';

let failures = 0;
function expect(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`PASS: ${name}`);
  else { console.log(`FAIL: ${name} ${detail}`); failures++; }
}
function eq<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  expect(name, a === e, `\n  expected ${e}\n  got      ${a}`);
}

// ---------- Venmo ----------
const NOTE = 'Splittr: Tacos & beer';
const [venmo] = getPaymentOptions({ venmo_handle: '@jane-doe' }, 12.3, NOTE);
eq('venmo strips @ from handle for display', venmo.handle, '@jane-doe');
eq(
  'venmo web link uses account.venmo.com/pay with amount + note',
  venmo.url,
  'https://account.venmo.com/pay?txn=pay&recipients=jane-doe&amount=12.30&note=Splittr%3A%20Tacos%20%26%20beer'
);
eq(
  'venmo app link opens the Venmo app prefilled',
  venmo.appUrl,
  'venmo://paycharge?txn=pay&recipients=jane-doe&amount=12.30&note=Splittr%3A%20Tacos%20%26%20beer'
);
eq('venmo amount is never negative', getPaymentOptions({ venmo_handle: 'x' }, -5, '')[0].appUrl,
  'venmo://paycharge?txn=pay&recipients=x&amount=0.00&note=');
const [weird] = getPaymentOptions({ venmo_handle: ' a&b=c ' }, 1, '');
expect('venmo handle is URL-encoded', weird.appUrl!.includes('recipients=a%26b%3Dc'), weird.appUrl);

// ---------- Cash App / PayPal regressions ----------
const [cash] = getPaymentOptions({ cashapp_handle: '$bob' }, 7, NOTE);
eq('cash app link unchanged', cash.url, 'https://cash.app/$bob/7.00');
expect('cash app has no separate app link', cash.appUrl === undefined);
const [pp] = getPaymentOptions({ paypal_handle: 'bobpp' }, 7.5, NOTE);
eq('paypal link unchanged', pp.url, 'https://paypal.me/bobpp/7.50');
eq('option order is venmo, cashapp, paypal',
  getPaymentOptions({ venmo_handle: 'a', cashapp_handle: 'b', paypal_handle: 'c', zelle_handle: 'z@z.com' }, 1, '').map((o) => o.key),
  ['venmo', 'cashapp', 'paypal']);

// ---------- Mobile detection ----------
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
expect('iPhone is mobile', isMobileUserAgent(IPHONE));
expect('Android is mobile', isMobileUserAgent(ANDROID));
expect('desktop Mac is not mobile', !isMobileUserAgent(MAC));
expect('empty UA is not mobile', !isMobileUserAgent(''));

// ---------- Opening a payment option ----------
function harness(ua: string, hiddenAfterLaunch: boolean) {
  const nav: string[] = [];
  let timer: (() => void) | null = null;
  let hidden = false;
  const handled = openPaymentOption(venmo, {
    userAgent: ua,
    navigate: (u) => { nav.push(u); if (u.startsWith('venmo://')) hidden = hiddenAfterLaunch; },
    isHidden: () => hidden,
    schedule: (fn) => { timer = fn; },
  });
  return { handled, nav, fire: () => timer?.() };
}
const desk = harness(MAC, false);
expect('desktop: not handled (plain web link opens)', !desk.handled && desk.nav.length === 0);
const phoneApp = harness(IPHONE, true);
eq('phone: launches the app first', phoneApp.nav, [venmo.appUrl]);
phoneApp.fire();
eq('phone with app: no web fallback after app took over', phoneApp.nav, [venmo.appUrl]);
const phoneNoApp = harness(ANDROID, false);
phoneNoApp.fire();
eq('phone without app: falls back to the web link', phoneNoApp.nav, [venmo.appUrl, venmo.url]);
expect('phone: click is handled', phoneNoApp.handled);
const cashPhone = openPaymentOption(cash, { userAgent: IPHONE, navigate: () => {}, isHidden: () => false, schedule: () => {} });
expect('options without appUrl are never intercepted', !cashPhone);

// ---------- Zelle handle normalization ----------
eq('zelle email is trimmed + lowercased', normalizeZelleHandle('  Jane.Doe@Gmail.COM '), 'jane.doe@gmail.com');
eq('zelle 10-digit phone -> +1', normalizeZelleHandle('(555) 123-4567'), '+15551234567');
eq('zelle 11-digit phone with leading 1', normalizeZelleHandle('1-555-123-4567'), '+15551234567');
eq('zelle +1 phone', normalizeZelleHandle('+1 555.123.4567'), '+15551234567');
eq('zelle rejects short phone', normalizeZelleHandle('555-1234'), null);
eq('zelle rejects non-US country code', normalizeZelleHandle('+44 20 7946 0958'), null);
eq('zelle rejects junk', normalizeZelleHandle('venmo-handle'), null);
eq('zelle rejects bad email', normalizeZelleHandle('a@b'), null);
eq('zelle empty -> null', normalizeZelleHandle('   '), null);
eq('zelle non-string -> null', normalizeZelleHandle(42 as unknown), null);
eq('zelle rejects overlong email', normalizeZelleHandle(`${'a'.repeat(250)}@x.com`), null);

// ---------- Zelle request input (API) ----------
eq('input omitted -> leave unchanged', parseZelleInput(undefined), { ok: true, value: undefined });
eq('input null -> clear', parseZelleInput(null), { ok: true, value: null });
eq('input blank -> clear', parseZelleInput('  '), { ok: true, value: null });
eq('input valid -> normalized', parseZelleInput('555-123-4567'), { ok: true, value: '+15551234567' });
eq('input invalid -> error', parseZelleInput('nope'), { ok: false });
eq('input number -> error', parseZelleInput(5551234567), { ok: false });

// ---------- Zelle info for the pay card ----------
eq('no zelle -> null', getZelleInfo({ venmo_handle: 'x' }), null);
eq('zelle email info', getZelleInfo({ zelle_handle: 'jane@x.com' }),
  { kind: 'email', display: 'jane@x.com', copyValue: 'jane@x.com', qrUrl: null });
eq('zelle phone info is formatted for display, digits for copy', getZelleInfo({ zelle_handle: '+15551234567' }),
  { kind: 'phone', display: '(555) 123-4567', copyValue: '5551234567', qrUrl: null });
eq('zelle QR alone still yields info', getZelleInfo({ zelle_qr_url: 'https://x/qr.png' }),
  { kind: null, display: null, copyValue: null, qrUrl: 'https://x/qr.png' });
eq('zelle with both', getZelleInfo({ zelle_handle: 'j@x.com', zelle_qr_url: 'https://x/qr.png' })?.qrUrl, 'https://x/qr.png');

// ---------- billHasPaymentMethods ----------
expect('no handles -> false', !billHasPaymentMethods({}));
expect('zelle handle alone counts', billHasPaymentMethods({ zelle_handle: 'a@b.com' }));
expect('zelle QR alone counts', billHasPaymentMethods({ zelle_qr_url: 'https://x' }));
expect('venmo alone still counts', billHasPaymentMethods({ venmo_handle: 'a' }));

// ---------- QR upload validation ----------
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
eq('sniff png', sniffImageType(PNG), 'image/png');
eq('sniff jpeg', sniffImageType(JPG), 'image/jpeg');
eq('sniff webp', sniffImageType(WEBP), 'image/webp');
eq('sniff gif rejected', sniffImageType(GIF), null);
eq('sniff svg rejected', sniffImageType(SVG), null);
eq('sniff tiny buffer', sniffImageType(new Uint8Array([0x89])), null);

eq('valid png upload', validateQrUpload(PNG), { ok: true, contentType: 'image/png', ext: 'png' });
eq('valid jpeg upload', validateQrUpload(JPG), { ok: true, contentType: 'image/jpeg', ext: 'jpg' });
eq('svg disguised as png rejected', validateQrUpload(SVG), { ok: false, error: 'Upload a PNG, JPEG, or WebP image' });
eq('empty upload rejected', validateQrUpload(new Uint8Array()), { ok: false, error: 'The image is empty' });
const big = new Uint8Array(MAX_QR_BYTES + 1); big.set(PNG);
eq('oversized upload rejected', validateQrUpload(big), { ok: false, error: 'The image must be under 2 MB' });
const atLimit = new Uint8Array(MAX_QR_BYTES); atLimit.set(PNG);
expect('upload exactly at the limit is accepted', validateQrUpload(atLimit).ok);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
