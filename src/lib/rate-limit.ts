/**
 * In-memory sliding-window rate limiter.
 *
 * Scope: per serverless instance — on Vercel each warm lambda keeps its own
 * counters, so this throttles bursts and casual abuse rather than being a
 * global guarantee. For hard multi-instance limits, swap the store for
 * Upstash Redis (@upstash/ratelimit) without changing call sites.
 */

interface Window {
  timestamps: number[];
}

const buckets = new Map<string, Window>();
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // Cheap protection against unbounded growth from spoofed keys
  if (buckets.size > MAX_BUCKETS) buckets.clear();

  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((oldest + windowMs - now) / 1000),
    };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: limit - bucket.timestamps.length, retryAfterSeconds: 0 };
}

/** Client IP as seen through Vercel/proxies. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
