/**
 * The one place a post-sign-in redirect target is checked: same-site paths
 * only, anything else becomes "/". The URL parser strips tabs and newlines
 * and treats backslashes as slashes, so "/\t/evil.com" would go off-site if
 * it were only prefix-tested; instead the value is resolved against a fixed
 * base and must stay on that origin. Control characters and backslashes are
 * refused outright, raw and percent-decoded (something downstream may decode).
 */
const BASE = 'http://splittr.invalid';
const FORBIDDEN = /[\u0000-\u001f\u007f\\]/;

export function safeNext(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return '/';
  }
  if (FORBIDDEN.test(raw) || FORBIDDEN.test(decoded) || decoded.startsWith('//')) return '/';
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE) return '/';
    const out = url.pathname + url.search + url.hash;
    return out.startsWith('//') ? '/' : out;
  } catch {
    return '/';
  }
}
