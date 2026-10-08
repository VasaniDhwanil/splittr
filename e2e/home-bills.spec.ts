import { test, expect, type APIRequestContext } from '@playwright/test';
import { BASE_URL, HOST_STATE, NO_AUTH_REASON, WRITES_ENABLED, WRITES_SKIP_REASON, hasState } from './fixtures/env';
import { createBill, deleteBill, usd, type CreatedBill } from './fixtures/helpers';

// The host's home "Your Bills" list: row content, archive, and the archived toggle.
test.describe('home bills list (writes)', () => {
  test.skip(!WRITES_ENABLED, WRITES_SKIP_REASON);
  test.use({ storageState: async ({}, use) => use(hasState(HOST_STATE) ? HOST_STATE : undefined) });

  let api: APIRequestContext | undefined;
  let bill: CreatedBill | undefined;
  let billName = '';
  // 12.00 + 2 x 4.00, no tax or tip
  const total = usd(20);

  test.beforeAll(async ({ playwright }, testInfo) => {
    test.skip(!hasState(HOST_STATE), NO_AUTH_REASON);
    api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: HOST_STATE });
    billName = `e2e home ${Date.now()} ${testInfo.project.name}`;
    bill = await createBill(api, billName, [
      { name: 'Probe burger', price: 12.0, quantity: 1 },
      { name: 'Probe fries', price: 4.0, quantity: 2 },
    ]);
  });

  test.afterAll(async () => {
    try {
      if (api && bill) await deleteBill(api, bill);
    } finally {
      await api?.dispose();
    }
  });

  test('bill row shows name, Host and total; archive hides it; toggle reveals it', async ({ page }) => {
    const b = bill!;

    // Mirror what /create does in the browser: the bill goes into
    // splittr-my-bills, which is what makes home load its details (total).
    // Only seeded once so later navigations keep the page's own writes.
    await page.addInitScript(
      ({ id, name, short_code }) => {
        try {
          const key = 'splittr-my-bills';
          const list = JSON.parse(localStorage.getItem(key) || '[]') as { id: string }[];
          if (!list.some((x) => x.id === id)) {
            list.unshift({ id, name, short_code, created_at: new Date().toISOString(), role: 'creator' } as never);
            localStorage.setItem(key, JSON.stringify(list.slice(0, 20)));
          }
        } catch {
          /* storage unavailable: the test will fail on the missing total */
        }
      },
      { id: b.id, name: billName, short_code: b.short_code }
    );

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your Bills' })).toBeVisible();

    const link = page.locator(`a[href="/bill/${b.id}"]`);
    const row = link.locator(
      'xpath=ancestor::div[.//button[@aria-label="Archive bill" or @aria-label="Restore bill"]][1]'
    );

    await expect(link).toHaveText(billName);
    await expect(row).toContainText('Host');
    await expect(row).toContainText(total);

    // Archive: the row disappears and the toggle offers exactly this one bill
    await row.getByRole('button', { name: 'Archive bill' }).click();
    await expect(link).toHaveCount(0);
    const toggle = page.getByRole('button', { name: /Show 1 archived bill$/ });
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(link).toBeVisible();
    await expect(row).toContainText('Archived');
    await expect(row.getByRole('button', { name: 'Restore bill' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Hide 1 archived bill$/ })).toBeVisible();

    // Restore leaves the browser's archive list clean
    await row.getByRole('button', { name: 'Restore bill' }).click();
    await expect(row).not.toContainText('Archived');
  });
});
