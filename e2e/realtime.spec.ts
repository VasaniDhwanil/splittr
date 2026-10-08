import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE_URL, HOST_STATE, NO_AUTH_REASON, WRITES_ENABLED, WRITES_SKIP_REASON, hasState } from './fixtures/env';
import { claimMarker, createBill, deleteBill, itemRow, renameBill, type CreatedBill } from './fixtures/helpers';

/**
 * The key realtime regression: two live viewers of one bill must see each
 * other's changes without reloading, including claim DELETEs (which used to
 * be dropped), catch-up refetches on wake / reconnect, and creator edits.
 *
 * Context A = the host (signed in). Context B = an anonymous guest.
 */

const GUEST = 'Probe Guest';
const GUEST_INITIALS = 'PG';
const BURGER = 'Probe burger';
const BURGER_LINE = '$12.00';
const FRIES = 'Probe fries';
const LIVE = { timeout: 8_000 };

interface BillPayload {
  name: string;
  items: { id: string; name: string }[];
}

/** Counts main-frame navigations so "without reload" is asserted, not assumed. */
function countNavigations(page: Page): () => number {
  let n = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) n++;
  });
  return () => n;
}

/**
 * Best-effort wait for this page's Supabase channel join to be acknowledged
 * (phx_reply ok on topic realtime:bill:<id>). Resolves false on timeout so the
 * live assertions still run and report the real failure.
 */
function waitForBillChannel(page: Page, billId: string, timeout = 15_000): Promise<boolean> {
  const topic = `realtime:bill:${billId}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        const text = typeof payload === 'string' ? payload : payload.toString('utf8');
        if (text.includes(topic) && text.includes('phx_reply') && text.includes('"ok"')) {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
  });
}

test.describe('bill realtime (writes)', () => {
  test.skip(!WRITES_ENABLED, WRITES_SKIP_REASON);
  test.use({ storageState: async ({}, use) => use(hasState(HOST_STATE) ? HOST_STATE : undefined) });

  let api: APIRequestContext | undefined;
  let bill: CreatedBill | undefined;
  let billName = '';

  test.beforeAll(async ({ playwright }, testInfo) => {
    test.skip(!hasState(HOST_STATE), NO_AUTH_REASON);
    api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: HOST_STATE });
    billName = `e2e realtime ${Date.now()} ${testInfo.project.name}`;
    bill = await createBill(api, billName, [
      { name: BURGER, price: 12.0, quantity: 1 },
      { name: FRIES, price: 4.0, quantity: 2 },
    ]);
  });

  test.afterAll(async () => {
    try {
      if (api && bill) await deleteBill(api, bill);
    } finally {
      await api?.dispose();
    }
  });

  test('claims, unclaims, catch-up and creator edits reach the other viewer live', async ({
    page: hostPage,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const b = bill!;

    const detail = await api!.get(`/api/bills/${b.id}`);
    expect(detail.status()).toBe(200);
    const burgerId = ((await detail.json()) as BillPayload).items.find((i) => i.name === BURGER)?.id;
    expect(burgerId, 'burger item id').toBeTruthy();

    // Guest context mirrors the project's device emulation, without a session
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = testInfo.project.use;
    const guestContext = await browser.newContext({
      // Explicitly empty: the guest must never inherit the host session
      storageState: { cookies: [], origins: [] },
      baseURL: BASE_URL,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
    });

    try {
      const guestPage = await guestContext.newPage();

      // A: host opens the bill
      const hostChannel = waitForBillChannel(hostPage, b.id);
      await hostPage.goto(`/bill/${b.id}`);
      await expect(hostPage.getByText(BURGER, { exact: true }).first()).toBeVisible();
      await expect(hostPage.getByText(FRIES).first()).toBeVisible();
      const hostNavs = countNavigations(hostPage);
      if (!(await hostChannel)) testInfo.annotations.push({ type: 'warning', description: 'host channel join ack not observed' });

      // B: guest opens the same bill and joins by name
      const guestChannel = waitForBillChannel(guestPage, b.id);
      await guestPage.goto(`/bill/${b.id}`);
      await expect(guestPage.getByText(BURGER, { exact: true }).first()).toBeVisible();

      const participantKey = `splittr-participant-${b.id}`;
      let participantId = '';
      await test.step('guest joins as "Probe Guest"', async () => {
        // Join through the API from inside B so B owns the participant identity.
        // (Driving the join dialog here once produced a second "Probe Guest (2)"
        // when the dialog and the fallback both joined; the name must be exact
        // because the host-side assertion looks for it.)
        const joined = await guestPage.evaluate(
          async ({ billId, name }) => {
            const r = await fetch('/api/participants', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bill_id: billId, name }),
            });
            return { status: r.status, body: (await r.json()) as { id?: string; name?: string } };
          },
          { billId: b.id, name: GUEST }
        );
        expect(joined.status, 'POST /api/participants').toBe(200);
        expect(joined.body.name, 'guest joined under the exact name').toBe(GUEST);
        await guestPage.evaluate(([k, v]) => localStorage.setItem(k, v), [participantKey, joined.body.id ?? '']);
        await guestPage.reload();
        participantId = (await guestPage.evaluate((k) => localStorage.getItem(k), participantKey)) ?? '';
        expect(participantId).not.toBe('');
      });
      if (!(await guestChannel)) testInfo.annotations.push({ type: 'warning', description: 'guest channel join ack not observed' });

      const burgerOnHost = itemRow(hostPage, BURGER, BURGER_LINE);
      const guestMarkerOnHost = claimMarker(burgerOnHost, GUEST, GUEST_INITIALS);

      await test.step('guest claims the burger; host sees it live', async () => {
        const res = await guestPage.evaluate(
          async ({ participant_id, item_id }) => {
            const r = await fetch('/api/claims', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ participant_id, item_id, share: 1 }),
            });
            return r.status;
          },
          { participant_id: participantId, item_id: burgerId! }
        );
        expect(res, 'POST /api/claims').toBe(200);
        await expect(guestMarkerOnHost.first()).toBeVisible(LIVE);
      });

      await test.step('guest unclaims; host drops it live (DELETE path)', async () => {
        const res = await guestPage.evaluate(
          async ({ participant_id, item_id }) => {
            const q = new URLSearchParams({ participant_id, item_id });
            const r = await fetch(`/api/claims?${q}`, { method: 'DELETE' });
            return r.status;
          },
          { participant_id: participantId, item_id: burgerId! }
        );
        expect(res, 'DELETE /api/claims').toBe(200);
        await expect(guestMarkerOnHost).toHaveCount(0, LIVE);
      });

      const billFetch = () =>
        hostPage.waitForRequest((r) => r.method() === 'GET' && /\/api\/bills\//.test(r.url()), { timeout: 5_000 });

      await test.step('catch-up refetch on visibilitychange', async () => {
        // Let any debounced (250ms) realtime refetch from the previous step drain
        await hostPage.waitForTimeout(1_000);
        const fetched = billFetch();
        await hostPage.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await fetched;
      });

      await test.step('catch-up refetch on online', async () => {
        await hostPage.waitForTimeout(1_000);
        const fetched = billFetch();
        await hostPage.evaluate(() => window.dispatchEvent(new Event('online')));
        await fetched;
      });

      await test.step('creator rename reaches the guest live', async () => {
        const guestNavs = countNavigations(guestPage);
        const renamed = `${billName} renamed`;
        await renameBill(api!, b, renamed);
        await expect(guestPage.getByRole('heading', { level: 1 })).toHaveText(renamed, LIVE);
        expect(guestNavs(), 'guest page must not reload').toBe(0);
      });

      expect(hostNavs(), 'host page must not reload').toBe(0);
    } finally {
      await guestContext.close();
    }
  });
});
