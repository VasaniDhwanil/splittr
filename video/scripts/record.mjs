// Records real Splittr footage from production with Playwright.
// Usage (from video/): node scripts/record.mjs [hero] [create] [realtime]
// Playwright's recordVideo captures in CSS pixels (390x844 on a phone, it never scales up), so
// phone contexts also run a CDP screencast at device pixels (780x1688). Those frames are
// encoded to H.264 .mp4 with Remotion's bundled ffmpeg (`npx remotion ffmpeg`).
// Writes .webm (and phone .mp4) files plus marks.json (event offsets in seconds from each page's start)
// to video/public/footage/. Never logs tokens or cookies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium, devices, request } = require('@playwright/test');

const BASE = 'https://www.splittr.cash';
const OUT = path.resolve(here, '..', 'public', 'footage');
const TMP = path.join(OUT, '.raw');
const HOST_STATE = path.join(ROOT, 'playwright', '.auth', 'host.json');
const MARKS_FILE = path.join(OUT, 'marks.json');

const IPHONE = { ...devices['iPhone 13'], deviceScaleFactor: 2 };
const PHONE_VIDEO = { width: 390, height: 844 }; // recordVideo is CSS pixels; the screencast doubles it

fs.mkdirSync(TMP, { recursive: true });
const marks = fs.existsSync(MARKS_FILE) ? JSON.parse(fs.readFileSync(MARKS_FILE, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Challenged extends Error {}
let pageLoads = 0;

function guard(page) {
  page.on('response', (res) => {
    if (res.headers()['x-vercel-mitigated'] === 'challenge') page.__challenged = true;
  });
}
async function goto(page, url) {
  pageLoads++;
  const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (page.__challenged || res?.headers()['x-vercel-mitigated'] === 'challenge') throw new Challenged(url);
  return res;
}
async function reload(page) {
  pageLoads++;
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (page.__challenged) throw new Challenged('reload');
}

/** New recording context; returns {context, page, t0, mark}. */
async function recorder(browser, name, opts) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  const { videoSize, defaultBrowserType: _ignored, ...ctxOpts } = opts;
  const context = await browser.newContext({ ...ctxOpts, recordVideo: { dir, size: videoSize } });
  const page = await context.newPage();
  const t0 = Date.now();
  guard(page);
  const frames = [];
  if (opts.deviceScaleFactor === 2) {
    const framesDir = path.join(dir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });
    const cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = path.join(framesDir, `f${String(frames.length).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, ts: metadata.timestamp ? metadata.timestamp * 1000 : Date.now() });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: videoSize.width * 2,
      maxHeight: videoSize.height * 2,
      everyNthFrame: 1,
    });
  }
  const m = {};
  const mark = (key) => {
    m[key] = +((Date.now() - t0) / 1000).toFixed(2);
    console.log(`  [${name}] ${key} @ ${m[key]}s`);
  };
  return { context, page, t0, mark, marks: m, dir, frames };
}

/** Variable-rate screencast frames to a constant 30 fps H.264 mp4 whose time 0 is rec.t0. */
function encodeFrames(rec, name, endMs) {
  const { frames } = rec;
  if (frames.length < 2) return;
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const start = i === 0 ? rec.t0 : frames[i].ts;
    const next = i + 1 < frames.length ? frames[i + 1].ts : endMs;
    lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, (next - start) / 1000).toFixed(4)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const list = path.join(rec.dir, 'frames.txt');
  fs.writeFileSync(list, lines.join('\n'));
  execFileSync(
    'npx',
    ['remotion', 'ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', 'scale=780:1688:flags=lanczos,format=yuv420p', '-r', '30', '-fps_mode', 'cfr', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow',
      '-movflags', '+faststart', path.join(OUT, `${name}.mp4`)],
    { cwd: path.resolve(here, '..'), stdio: 'inherit' }
  );
  console.log(`  encoded ${name}.mp4 from ${frames.length} screencast frames`);
}

async function finish(rec, name) {
  const video = rec.page.video();
  const endMs = Date.now();
  await rec.context.close();
  encodeFrames(rec, name, endMs);
  const src = await video.path();
  fs.copyFileSync(src, path.join(OUT, `${name}.webm`));
  marks[name] = { ...rec.marks, t0: rec.t0 };
  fs.writeFileSync(MARKS_FILE, JSON.stringify(marks, null, 2));
  console.log(`  saved ${name}.webm`);
}

async function scrollToText(page, text, offset = 120) {
  await page.getByText(text, { exact: true }).first().evaluate((el, off) => {
    el.scrollIntoView({ block: 'start' });
    const scroller = document.getElementById('app-scroll');
    if (scroller) scroller.scrollBy(0, -off);
    else window.scrollBy(0, -off);
  }, offset);
}

// 1. Hero on desktop ---------------------------------------------------------
async function hero(browser) {
  console.log('hero-desktop');
  const rec = await recorder(browser, 'hero-desktop', {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    videoSize: { width: 1440, height: 900 },
  });
  await goto(rec.page, BASE + '/');
  await rec.page.waitForLoadState('networkidle').catch(() => {});
  rec.mark('loaded');
  await sleep(12000);
  rec.mark('end');
  await finish(rec, 'hero-desktop');
}

// 2. Create flow on a phone --------------------------------------------------
async function create(browser) {
  console.log('create-phone');
  const rec = await recorder(browser, 'create-phone', { ...IPHONE, videoSize: PHONE_VIDEO });
  const { page } = rec;
  await goto(page, BASE + '/create');
  await page.getByText('Or enter items by hand').waitFor();
  await sleep(1200);
  rec.mark('loaded');
  await page.getByText('Or enter items by hand').tap();
  rec.mark('byHand');
  await sleep(700);
  const rows = [
    ['Birria tacos', '18'],
    ['Elote', '7.50'],
    ['Horchata', '5'],
  ];
  for (let i = 0; i < rows.length; i++) {
    const [name, price] = rows[i];
    await page.getByRole('button', { name: 'Add item' }).tap();
    await sleep(400);
    const nameInput = page.getByPlaceholder('Item name').nth(i);
    await nameInput.tap();
    await nameInput.pressSequentially(name, { delay: 55 });
    await sleep(400);
    const priceInput = page.getByLabel(`Price each of ${name}`);
    await priceInput.tap();
    await priceInput.pressSequentially(price, { delay: 90 });
    const got = await priceInput.inputValue();
    if (parseFloat(got) !== parseFloat(price)) {
      console.log(`  price typed as "${got}", filling instead`);
      await priceInput.fill(price);
    }
    rec.mark(`item${i + 1}`);
    await sleep(400);
  }
  await page.locator('body').tap({ position: { x: 5, y: 5 } }).catch(() => {});
  await sleep(500);
  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  await cont.scrollIntoViewIfNeeded();
  await sleep(700);
  rec.mark('continue');
  await cont.tap();
  await page.getByLabel('Bill name').waitFor();
  rec.mark('details');
  await sleep(600);
  const bn = page.getByLabel('Bill name');
  await bn.tap();
  await bn.pressSequentially('Friday tacos', { delay: 60 });
  await sleep(1800);
  rec.mark('end');
  await finish(rec, 'create-phone');
}

// 3. Two phones, realtime ----------------------------------------------------
async function realtime(browser) {
  console.log('realtime');
  if (!fs.existsSync(HOST_STATE)) throw new Error('missing playwright/.auth/host.json');
  const api = await request.newContext({ baseURL: BASE, storageState: HOST_STATE });
  const check = await api.get('/api/groups');
  if (check.status() !== 200) {
    await api.dispose();
    throw new Error(`host session rejected (HTTP ${check.status()}); run npx playwright test --project=setup`);
  }
  const created = await api.post('/api/bills', {
    data: {
      name: 'Friday tacos',
      creator_name: 'Rhythm',
      tax: 4.35,
      tip_percent: 20,
      items: [
        { name: 'Birria tacos', price: 18, quantity: 1 },
        { name: 'Elote', price: 7.5, quantity: 1 },
        { name: 'Yuzu lemonade', price: 6.5, quantity: 1 },
        { name: 'Churros', price: 6, quantity: 2 },
        { name: 'Horchata', price: 5, quantity: 1 },
      ],
    },
  });
  if (created.status() !== 200) throw new Error(`create bill HTTP ${created.status()}`);
  const bill = await created.json();
  console.log(`  bill created ${bill.id}`);
  let deleted = false;
  try {
    // Seed the table so the host sees a lived-in bill: Marcus and Tomás have claimed.
    const detail = await (await api.get(`/api/bills/${bill.id}`)).json();
    const itemId = (n) => detail.items.find((i) => i.name === n)?.id;
    // Seed guests join anonymously: a signed-in join resolves to the host's own participant.
    const anon = await request.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
    const join = async (name) => {
      const r = await anon.post('/api/participants', { data: { bill_id: bill.id, name } });
      return r.status() === 200 ? (await r.json()).id : null;
    };
    const claim = async (pid, iid) => {
      if (!pid || !iid) return;
      const r = await anon.post('/api/claims', { data: { participant_id: pid, item_id: iid, share: 1 } });
      if (r.status() !== 200) console.log(`  seed claim HTTP ${r.status()}`);
    };
    const marcus = await join('Marcus');
    const tomas = await join('Tomás');
    await claim(bill.creator_participant_id, itemId('Birria tacos'));
    await claim(marcus, itemId('Elote'));
    await claim(tomas, itemId('Churros'));
    await claim(tomas, itemId('Horchata'));
    await anon.dispose();

    const url = `${BASE}/bill/${bill.id}`;
    const hostRec = await recorder(browser, 'host-phone', { ...IPHONE, storageState: HOST_STATE, videoSize: PHONE_VIDEO });
    const guestRec = await recorder(browser, 'guest-phone', {
      ...IPHONE,
      storageState: { cookies: [], origins: [] },
      videoSize: PHONE_VIDEO,
    });
    const hp = hostRec.page;
    const gp = guestRec.page;

    await goto(hp, url);
    await hp.getByText('Yuzu lemonade', { exact: true }).first().waitFor();
    await goto(gp, url);
    await gp.getByText('Yuzu lemonade', { exact: true }).first().waitFor();

    const joined = await gp.evaluate(async (billId) => {
      const r = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_id: billId, name: 'Ines' }),
      });
      return { status: r.status, id: (await r.json()).id };
    }, bill.id);
    if (joined.status !== 200) throw new Error(`guest join HTTP ${joined.status}`);
    await gp.evaluate(([k, v]) => localStorage.setItem(k, v), [`splittr-participant-${bill.id}`, joined.id]);
    await reload(gp);
    await gp.getByText('Yuzu lemonade', { exact: true }).first().waitFor();
    await sleep(1500);
    await scrollToText(hp, 'Birria tacos', 30);
    await scrollToText(gp, 'Birria tacos', 30);
    await sleep(1500);
    hostRec.mark('ready');
    guestRec.mark('ready');

    const claimViaSheet = async (itemName, label) => {
      await gp.getByText(label, { exact: true }).first().tap({ timeout: 8000 });
      const dialog = gp.getByRole('dialog');
      await dialog.waitFor({ timeout: 8000 });
      await sleep(1100);
      const cta = dialog.getByRole('button', { name: /^(Claim|Split)/ });
      guestRec.mark(`cta-${itemName}`);
      await cta.tap();
      await dialog.waitFor({ state: 'hidden', timeout: 8000 });
    };

    let viaUi = true;
    try {
      guestRec.mark('tapYuzu');
      hostRec.mark('tapYuzu');
      await claimViaSheet('Yuzu lemonade', 'Yuzu lemonade');
      await hp.locator('[title="Ines"]').first().waitFor({ timeout: 8000 });
      hostRec.mark('hostSeesYuzu');
      await sleep(1600);
      guestRec.mark('tapChurros');
      hostRec.mark('tapChurros');
      await claimViaSheet('Churros', '2× Churros');
      await sleep(2500);
      hostRec.mark('hostSeesChurros');
    } catch (err) {
      viaUi = false;
      console.log(`  UI claim failed (${err.message.split('\n')[0]}); falling back to the claims API`);
      for (const n of ['Yuzu lemonade', 'Churros']) {
        await gp.evaluate(
          async ({ pid, iid }) =>
            fetch('/api/claims', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ participant_id: pid, item_id: iid, share: 1 }),
            }).then((r) => r.status),
          { pid: joined.id, iid: itemId(n) }
        );
        await sleep(2000);
      }
    }
    await sleep(2500);
    hostRec.mark('end');
    guestRec.mark('end');
    hostRec.marks.viaUi = viaUi;
    guestRec.marks.viaUi = viaUi;
    // t0 in marks is wall-clock ms, so the two clips can be synced.
    await finish(hostRec, 'host-phone');
    await finish(guestRec, 'guest-phone');
  } finally {
    const del = await api.delete(`/api/bills/${bill.id}`, { headers: { 'X-Creator-Token': bill.creator_token } });
    deleted = del.status() === 200;
    console.log(`  delete bill: HTTP ${del.status()}`);
    await api.dispose();
  }
  if (!deleted) throw new Error('bill cleanup did not return 200');
}

async function withRetry(fn, browser) {
  try {
    await fn(browser);
  } catch (err) {
    if (!(err instanceof Challenged)) throw err;
    console.log('  Vercel challenge seen; waiting 60s and retrying once');
    await sleep(60000);
    await fn(browser);
  }
}

const which = process.argv.slice(2);
const want = (k) => which.length === 0 || which.includes(k);
const browser = await chromium.launch({ headless: true });
try {
  if (want('hero')) await withRetry(hero, browser);
  if (want('create')) await withRetry(create, browser);
  if (want('realtime')) await withRetry(realtime, browser);
} finally {
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`page loads: ${pageLoads}`);
}
