/**
 * Per-address throttle for token-endpoint requests that fail before a grant
 * is identified (malformed, unknown client, unknown or forged code or token).
 * In memory on purpose: it only has to blunt guessing, and it keeps the
 * database out of it. Requests that name a real grant are limited per grant.
 */
const WINDOW_MS = 60_000;
export const MAX_FAILURES_PER_MINUTE = 30;
const MAX_ADDRESSES = 10_000;

const failures = new Map<string, number[]>();

const recent = (ip: string, now: number) => (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);

/** True when this address has used up its failures for the minute. */
export function overFailureLimit(ip: string, now: number = Date.now()): boolean {
  return recent(ip, now).length >= MAX_FAILURES_PER_MINUTE;
}

export function recordFailure(ip: string, now: number = Date.now()): void {
  if (failures.size > MAX_ADDRESSES) failures.clear();
  failures.set(ip, [...recent(ip, now), now]);
}

/** For tests. */
export function resetFailures(): void {
  failures.clear();
}
