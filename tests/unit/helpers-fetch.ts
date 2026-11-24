import { vi } from 'vitest';

type Handler = { status?: number; body?: unknown } | ((init?: RequestInit) => { status?: number; body?: unknown });

/** Stubs global fetch with `METHOD /path` routes. Unlisted routes answer 500 and are recorded. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { key: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
    calls.push({ key, init });
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ error: `unmocked ${key}` }), { status: 500 });
    const out = typeof route === 'function' ? route(init) : route;
    return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200 });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}
