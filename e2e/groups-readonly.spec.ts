import { test, expect, type Request } from '@playwright/test';
import { HOST_STATE, NO_AUTH_REASON, hasState } from './fixtures/env';
import { expectNoHorizontalOverflow, section } from './fixtures/helpers';

// Signed in as the host. Reads only: opens dialogs but never submits them.
test.describe('groups (read-only)', () => {
  // Resolved at run time: the setup project writes the file after collection
  test.use({ storageState: async ({}, use) => use(hasState(HOST_STATE) ? HOST_STATE : undefined) });
  test.beforeEach(() => {
    test.skip(!hasState(HOST_STATE), NO_AUTH_REASON);
  });

  test('home lists groups; a group page shows its sections and invite dialog', async ({ page }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile';

    const groupsResponse = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/groups' && r.request().method() === 'GET'
    );
    await page.goto('/');
    const res = await groupsResponse;
    expect(res.status(), 'GET /api/groups').toBe(200);
    const groups = (await res.json()) as { id: string; name: string }[];

    await expect(page.getByRole('heading', { name: 'Your Groups' })).toBeVisible();
    if (isMobile) await expectNoHorizontalOverflow(page);

    test.skip(groups.length === 0, 'the host account has no groups, nothing to open');

    const firstCard = page.locator('a[href^="/groups/"]:not([href^="/groups/join"])').first();
    await expect(firstCard).toBeVisible();
    const href = (await firstCard.getAttribute('href')) ?? '';
    const groupId = href.split('/').pop() ?? '';
    expect(groupId).not.toBe('');

    // The host's display name in this group (read-only lookup)
    const detail = await page.request.get(`/api/groups/${groupId}`);
    expect(detail.status(), `GET /api/groups/${groupId}`).toBe(200);
    const group = (await detail.json()) as { me: string; members: { user_id: string; display_name: string }[] };
    const hostName = group.members.find((m) => m.user_id === group.me)?.display_name ?? '';

    await firstCard.click();
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();
    await expect(h1).toHaveText(/\S/);

    const members = section(page, 'Members');
    await expect(members).toBeVisible();
    const ownerOrHost = hostName
      ? members.getByText('Owner', { exact: true }).or(members.getByText(hostName, { exact: true }))
      : members.getByText('Owner', { exact: true });
    await expect(ownerOrHost.first()).toBeVisible();

    await expect(section(page, 'Bills')).toBeVisible();

    if (isMobile) await expectNoHorizontalOverflow(page);

    // Invite dialog: open, inspect, dismiss. Nothing may be submitted.
    const writes: string[] = [];
    const onRequest = (r: Request) => {
      if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/api/')) {
        writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
      }
    };
    page.on('request', onRequest);

    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
    await expect(dialog.locator('input[type="email"], input[inputmode="email"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    page.off('request', onRequest);
    expect(writes, 'opening and dismissing the invite dialog must not write').toEqual([]);

    if (isMobile) await expectNoHorizontalOverflow(page);
  });
});
