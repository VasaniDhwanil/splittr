/**
 * Regression test for joining a bill by typing a name (the "removed by the
 * host" effect used to un-join a guest the moment they joined), plus the
 * duplicate-name "that's me" path and the host splitting an item.
 *
 * LOCAL ONLY. It creates and deletes real bills, so it skips itself unless the
 * base URL's host is localhost or 127.0.0.1. The Playwright config defaults to
 * production, so BASE_URL must be set explicitly.
 *
 * Run it (from the repo root, with a local server already running on 3199 that
 * was started after `source scripts/local-env.sh`, see AGENTS.md):
 *
 *   export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
 *   BASE_URL=http://localhost:3199 npx playwright test e2e/local-bill-join.spec.ts --project=desktop --no-deps
 *
 * `--no-deps` matters: it skips the `setup` project, which reads the
 * production service key from .env.local and would mint real sessions.
 *
 * The bill is created through POST /api/bills from the host's browser context
 * (not by driving the /create form, which needs a receipt or typed items and is
 * brittle), then the host context gets the same localStorage keys /create sets.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL } from './fixtures/env';

const isLocal = ['localhost', '127.0.0.1'].includes(new URL(BASE_URL).hostname);

test.describe('bill join (local only)', () => {
  test.skip(!isLocal, `refusing to run against ${BASE_URL}: this spec creates and deletes data, local servers only`);
  test.describe.configure({ mode: 'serial' });

  let billId = '';
  let creatorToken = '';
  let host: { context: BrowserContext; page: Page };
  const contexts: BrowserContext[] = [];

  async function newContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ baseURL: BASE_URL });
    contexts.push(context);
    return { context, page: await context.newPage() };
  }

  test.beforeAll(async ({ browser }) => {
    host = await newContext(browser);
    const res = await host.context.request.post(`${BASE_URL}/api/bills`, {
      data: {
        name: `e2e join ${Date.now()}`,
        creator_name: 'Hostess',
        items: [
          { name: 'Ramen', price: 12, quantity: 1 },
          { name: 'Gyoza', price: 8, quantity: 1 },
        ],
        tax: 0,
        tip_percent: 0,
      },
    });
    expect(res.status(), `create bill: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as { id: string; creator_participant_id: string; creator_token: string };
    billId = body.id;
    creatorToken = body.creator_token;
    // What /create stores before redirecting to the bill
    await host.page.goto('/');
    await host.page.evaluate(
      ([id, pid, token]) => {
        localStorage.setItem(`splittr-participant-${id}`, pid);
        localStorage.setItem(`splittr-creator-token-${id}`, token);
      },
      [billId, body.creator_participant_id, creatorToken]
    );
  });

  test.afterAll(async () => {
    try {
      if (billId) {
        const res = await host.context.request.delete(`${BASE_URL}/api/bills/${billId}`, {
          headers: { 'X-Creator-Token': creatorToken },
        });
        if (![200, 404].includes(res.status())) {
          throw new Error(`cleanup: deleting bill ${billId} returned HTTP ${res.status()}`);
        }
      }
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  const storedId = (page: Page) => page.evaluate((id) => localStorage.getItem(`splittr-participant-${id}`), billId);

  test('(a) a guest who joins by typing a name stays joined, claims and unclaims', async ({ browser }) => {
    const { page } = await newContext(browser);
    const badJoins: string[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('/api/participants') && r.request().method() === 'POST' && r.status() === 400) {
        badJoins.push(r.url());
      }
    });

    await page.goto(`/bill/${billId}`);
    await expect(page.getByText('Ramen')).toBeVisible();

    // Anonymous: tapping "Join this bill" goes straight to the dialog
    await page.getByRole('button', { name: 'Join this bill' }).click();
    await page.getByLabel("What's your name?").fill('Sam');
    const joinRes = page.waitForResponse((r) => r.url().endsWith('/api/participants') && r.request().method() === 'POST');
    await page.getByRole('button', { name: "Let's go!" }).click();
    expect((await joinRes).status()).toBe(200);

    // Joined, and still joined once the page has settled (the old bug un-joined here)
    await expect(page.getByRole('button', { name: 'Join this bill' })).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await expect(page.getByText('You were removed from this bill by the host.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Join this bill' })).toHaveCount(0);
    await expect(page.locator('ul').getByText('you', { exact: true })).toBeVisible();
    const id = await storedId(page);
    expect(id).toBeTruthy();

    await page.reload();
    await expect(page.getByText('Ramen')).toBeVisible();
    await expect(page.locator('ul').getByText('you', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join this bill' })).toHaveCount(0);
    expect(await storedId(page)).toBe(id);

    // Claim an item, then unclaim it
    await page.getByText('Ramen').click();
    const claimRes = page.waitForResponse((r) => r.url().includes('/api/claims/batch') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Claim it for yourself' }).click();
    expect((await claimRes).status()).toBe(200);
    const unclaimRes = page.waitForResponse((r) => r.url().includes('/api/claims?') && r.request().method() === 'DELETE');
    await page.getByRole('button', { name: 'unclaim' }).click();
    expect((await unclaimRes).status()).toBe(200);

    // The anonymous visitor never fired the no-name join request
    expect(badJoins, 'POST /api/participants answered 400 for an anonymous visitor').toEqual([]);
  });

  test('(a2) a signed-out visitor tapping an item gets the join dialog without a 400', async ({ browser }) => {
    const { page } = await newContext(browser);
    const participantPosts: number[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('/api/participants') && r.request().method() === 'POST') participantPosts.push(r.status());
    });
    await page.goto(`/bill/${billId}`);
    await expect(page.getByText('Gyoza')).toBeVisible();
    await page.getByText('Gyoza').click();
    await expect(page.getByRole('dialog', { name: 'Join this bill' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(participantPosts).toEqual([]);
  });

  test('(b) the same name on another device: "that\'s me" cannot claim until it joins on this device', async ({ browser }) => {
    const { page } = await newContext(browser);
    await page.goto(`/bill/${billId}`);
    await expect(page.getByText('Ramen')).toBeVisible();

    await page.getByRole('button', { name: 'Join this bill' }).click();
    await page.getByLabel("What's your name?").fill('Sam');
    await page.getByRole('button', { name: "Let's go!" }).click();
    await page.getByRole('button', { name: "Yes, that's me" }).click();
    await expect(page.getByRole('button', { name: 'Join this bill' })).toHaveCount(0);

    // Try to claim: the server wants proof of being on the bill from this device
    await page.getByText('Ramen').click();
    const claimRes = page.waitForResponse((r) => r.url().includes('/api/claims/batch') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Claim it for yourself' }).click();
    expect((await claimRes).status()).toBe(403);
    await expect(page.getByText('Join the bill on this device to change who had what.')).toBeVisible();
    const dialog = page.getByRole('dialog', { name: 'Join this bill' });
    await expect(dialog).toBeVisible();

    // Joining on this device works, and so does claiming afterwards
    await dialog.getByLabel("What's your name?").fill('Sam');
    const joinRes = page.waitForResponse((r) => r.url().endsWith('/api/participants') && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: "Let's go!" }).click();
    expect((await joinRes).status()).toBe(200);
    await expect(dialog).toHaveCount(0);

    await page.getByText('Ramen').click();
    const claimRes2 = page.waitForResponse((r) => r.url().includes('/api/claims/batch') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Claim it for yourself' }).click();
    expect((await claimRes2).status()).toBe(200);
  });

  test('(c) the host can split an item among everyone', async () => {
    const { page } = host;
    await page.goto(`/bill/${billId}`);
    await expect(page.getByText('Gyoza')).toBeVisible();
    await page.getByText('Gyoza').click();
    await page.getByRole('button', { name: 'Everyone', exact: true }).click();
    const batchRes = page.waitForResponse((r) => r.url().includes('/api/claims/batch') && r.request().method() === 'POST');
    await page.getByRole('button', { name: /^Split between \d+ people$/ }).click();
    expect((await batchRes).status()).toBe(200);
  });
});
