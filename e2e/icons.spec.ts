import { test, expect } from '@playwright/test';

// Unauthenticated, read-only: the brand icon set and manifest are served.
test.describe('icons and manifest', () => {
  test('home HTML links the SVG icon and an apple-touch-icon', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    const html = await res.text();

    const links = html.match(/<link\b[^>]*>/gi) ?? [];
    const rel = (tag: string) => /\brel=["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const href = (tag: string) => /\bhref=["']?([^"'\s>]+)/i.exec(tag)?.[1] ?? '';

    const icons = links.filter((l) => rel(l) === 'icon');
    expect(icons.some((l) => /\/icon\.svg(\?|$)/.test(href(l))), 'no <link rel="icon"> pointing at icon.svg').toBe(
      true
    );
    expect(links.some((l) => rel(l) === 'apple-touch-icon'), 'no apple-touch-icon link').toBe(true);
  });

  test('/icon.svg is served as image/svg+xml', async ({ request }) => {
    const res = await request.get('/icon.svg');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/svg+xml');
  });

  for (const asset of ['/favicon.ico', '/apple-icon.png', '/icon-192.png', '/icon-512.png', '/manifest.json']) {
    test(`${asset} is 200`, async ({ request }) => {
      const res = await request.get(asset);
      expect(res.status()).toBe(200);
    });
  }
});
