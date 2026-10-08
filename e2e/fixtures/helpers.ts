import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export interface ProbeItem {
  name: string;
  price: number;
  quantity: number;
}

export interface CreatedBill {
  id: string;
  short_code: string;
  creator_participant_id?: string;
  creator_token: string;
}

/** POST /api/bills with whatever session `request` carries. */
export async function createBill(
  request: APIRequestContext,
  name: string,
  items: ProbeItem[],
  extra: Record<string, unknown> = {}
): Promise<CreatedBill> {
  const res = await request.post('/api/bills', {
    data: { name, creator_name: 'Probe Host', items, tax: 0, tip_percent: 0, ...extra },
  });
  expect(res.status(), `create bill: ${await res.text()}`).toBe(200);
  return (await res.json()) as CreatedBill;
}

/** DELETE /api/bills/:id: session ownership plus the creator token as a fallback. */
export async function deleteBill(request: APIRequestContext, bill: CreatedBill): Promise<void> {
  const res = await request.delete(`/api/bills/${bill.id}`, {
    headers: { 'X-Creator-Token': bill.creator_token },
  });
  // 404 = already gone; anything else unexpected should be visible in the report
  if (![200, 404].includes(res.status())) {
    throw new Error(`cleanup: deleting bill ${bill.id} returned HTTP ${res.status()}`);
  }
}

export async function renameBill(request: APIRequestContext, bill: CreatedBill, name: string): Promise<void> {
  const res = await request.patch(`/api/bills/${bill.id}`, {
    headers: { 'X-Creator-Token': bill.creator_token },
    data: { name },
  });
  expect(res.status(), `rename bill: ${await res.text()}`).toBe(200);
}

/**
 * A groups-page section (<section> with an h2 whose text starts with `title`).
 * The h2's accessible name has the count glued on ("Members2"), so match the
 * title followed by digits, whitespace or the end.
 */
export function section(page: Page, title: string): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: new RegExp(`^${title}(\\d|\\s|$)`) }) });
}

/**
 * The row for a bill item on /bill/:id, found from its exact name text up to
 * the nearest ancestor that also shows its line price. Independent of the
 * page's class names, which are mid-edit.
 */
export function itemRow(page: Page, itemName: string, linePrice: string): Locator {
  return page
    .getByText(itemName, { exact: true })
    .first()
    .locator(`xpath=ancestor::div[contains(normalize-space(.), "${linePrice}")][1]`);
}

/** A participant marker inside an item row: avatar (title=name), full name, or initials. */
export function claimMarker(row: Locator, name: string, initials: string): Locator {
  return row
    .locator(`[title="${name}"]`)
    .or(row.getByText(name, { exact: true }))
    .or(row.getByText(initials, { exact: true }));
}

export function usd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

/** Neither the document nor the app scroll container may scroll sideways. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const scroller = document.getElementById('app-scroll');
    return {
      docScroll: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      appScroll: scroller ? scroller.scrollWidth : null,
      appClient: scroller ? scroller.clientWidth : null,
    };
  });
  expect(m.docScroll, `documentElement.scrollWidth ${m.docScroll} > innerWidth ${m.innerWidth}`).toBeLessThanOrEqual(
    m.innerWidth
  );
  expect(m.appScroll, '#app-scroll missing').not.toBeNull();
  expect(m.appScroll!, `#app-scroll scrollWidth ${m.appScroll} > clientWidth ${m.appClient}`).toBeLessThanOrEqual(
    m.appClient!
  );
}
