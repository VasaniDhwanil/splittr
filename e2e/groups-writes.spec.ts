import { test, expect, type APIRequestContext } from '@playwright/test';
import { BASE_URL, HOST_STATE, NO_AUTH_REASON, WRITES_ENABLED, WRITES_SKIP_REASON, hasState } from './fixtures/env';
import { section } from './fixtures/helpers';

// Creates a throwaway group as the host, exercises it, and always deletes it.
test.describe('groups (writes)', () => {
  test.skip(!WRITES_ENABLED, WRITES_SKIP_REASON);
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: async ({}, use) => use(hasState(HOST_STATE) ? HOST_STATE : undefined) });

  let api: APIRequestContext | undefined;
  let groupId: string | undefined;
  let groupName = '';

  test.beforeAll(async ({ playwright }, testInfo) => {
    test.skip(!hasState(HOST_STATE), NO_AUTH_REASON);
    api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: HOST_STATE });
    groupName = `e2e-${Date.now()}-${testInfo.project.name}`;
    const res = await api.post('/api/groups', { data: { name: groupName } });
    expect(res.status(), `create group: ${await res.text()}`).toBe(200);
    groupId = ((await res.json()) as { id: string }).id;
    expect(groupId).toBeTruthy();
  });

  test.afterAll(async () => {
    try {
      if (api && groupId) {
        const res = await api.delete(`/api/groups/${groupId}`);
        if (![200, 404].includes(res.status())) {
          throw new Error(`cleanup: deleting group ${groupId} returned HTTP ${res.status()}`);
        }
      }
    } finally {
      await api?.dispose();
    }
  });

  test('new group shows on home and its page renders the empty bills state', async ({ page }) => {
    await page.goto('/');
    const card = page.locator(`a[href="/groups/${groupId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(groupName);

    await card.click();
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(groupName);
    const bills = section(page, 'Bills');
    await expect(bills).toBeVisible();
    await expect(bills.getByText(/No bills yet/)).toBeVisible();
    await expect(section(page, 'Members').getByText('Owner', { exact: true })).toBeVisible();
  });

  test('rename through the dialog updates the heading', async ({ page }) => {
    await page.goto(`/groups/${groupId}`);
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveText(groupName);

    await page.getByRole('button', { name: 'Rename group' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const input = dialog.getByLabel('Name');
    await expect(input).toHaveValue(groupName);

    const renamed = `${groupName}-renamed`;
    await input.fill(renamed);
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeHidden();
    await expect(h1).toHaveText(renamed);
    groupName = renamed;

    // Persisted, not just local state
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(renamed);
  });
});
