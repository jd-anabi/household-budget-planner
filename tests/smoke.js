'use strict';
// Smoke test: automates the "Testing a change" checklist in CLAUDE.md, plus a check per feature.
//
//   node tests/smoke.js [screenshot-dir]
//   ONLY=guard,roundtrip node tests/smoke.js      (run some sections only)
//
// Serves the repo on a random local port and drives headless Chromium through named sections.
// Exits non-zero if any check fails. Pass a directory to also save laptop/phone × light/dark
// screenshots: legibility and layout still need a person to look.
//
// Needs the `playwright` npm package and its Chromium. Cloud sessions for this repo
// have both preinstalled. Locally, once:
//   npm i --no-save playwright && npx playwright install chromium
// (node_modules/ is gitignored; the app itself has no dependencies.)

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const APP_ID = 'household-budget-planner';
const PLAN_KEY = 'household-budget-planner:plan:v1';
const BACKUP_KEY = 'household-budget-planner:plan:v1-backup';
const DATA_VERSION = 2; // Bump with the data model, and add a check that an older plan file still imports.
const FIXTURE_V1 = path.join(__dirname, 'fixtures', 'plan-v1.json');
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const AMT = 'input[data-field="amt"]';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-smoke-'));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
};

let ORIGIN = '';
let APP_URL = '';
let browser = null;
let current = '';
let errors = [];
const results = [];
const sections = [];

const check = (name, ok, detail) => results.push({ status: ok ? 'PASS' : 'FAIL', name: `[${current}] ${name}`, detail: ok ? '' : detail });
const warn = (name, detail) => results.push({ status: 'WARN', name: `[${current}] ${name}`, detail });
function section(name, fn) { sections.push({ name, fn }); }

function serve(root) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, path.normalize(p));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Collects uncaught errors, same-origin console errors and failed app files into `errors`.
// Cross-origin failures (Google Fonts) are judged by the fonts check instead.
function watch(page, label) {
  page.on('pageerror', (e) => errors.push(`${label}: uncaught ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const src = m.location().url || '';
    if (src && !src.startsWith(ORIGIN)) return;
    errors.push(`${label}: console ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith(ORIGIN) && r.status() >= 400) errors.push(`${label}: ${r.status()} ${r.url()}`);
  });
}

// opts: Playwright context options, plus
//   storage: { key: value } written to localStorage once per tab (reloads keep what the app saved)
//   date: 'YYYY-MM-DDTHH:mm' fixed clock for Date (timers keep running)
//   nav: false to skip the first navigation
async function openPage(opts = {}) {
  const { storage, date, nav, ...ctxOpts } = opts;
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, ctxOpts));
  ctx.setDefaultTimeout(10000);
  if (storage) {
    await ctx.addInitScript((s) => {
      try {
        if (sessionStorage.getItem('__seeded')) return;
        Object.keys(s).forEach((k) => localStorage.setItem(k, s[k]));
        sessionStorage.setItem('__seeded', '1');
      } catch (e) { /* storage unavailable */ }
    }, storage);
  }
  const page = await ctx.newPage();
  watch(page, current);
  if (date) await page.clock.setFixedTime(new Date(date));
  if (nav !== false) await page.goto(APP_URL, { waitUntil: 'networkidle' });
  return { ctx, page };
}

async function firstAmount(page) {
  const input = page.locator(AMT).first();
  return (await input.count()) ? input.inputValue() : null;
}

// The banner fills in asynchronously after a file is chosen (FileReader); wait up to 3 s for text.
async function bannerText(page) {
  await page.waitForFunction(() => document.getElementById('banner').innerText.trim().length > 0, null, { timeout: 3000 }).catch(() => {});
  return page.locator('#banner').innerText();
}

// serviceWorker.ready never settles if registration fails, so give it a deadline.
function swReady(page) {
  return page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]));
}

// lastSync, modifiedAt and touched are rewritten on import by design.
function withoutSyncFields(state) {
  const copy = JSON.parse(JSON.stringify(state));
  delete copy.lastSync; delete copy.modifiedAt; delete copy.touched;
  return copy;
}

/* ---------------- sections ---------------- */

section('basics', async () => {
  const { ctx, page } = await openPage({ nav: false });
  let fontsCss = 'no response';
  page.on('response', (r) => { if (r.url().startsWith('https://fonts.googleapis.com/')) fontsCss = r.status(); });
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  check('app renders its budget lines', (await page.locator(AMT).count()) > 0);

  if (fontsCss === 'no response') {
    warn('Google Fonts', 'fonts.googleapis.com unreachable from here; skipped');
  } else {
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => {
      const fams = [];
      document.fonts.forEach((f) => { if (f.status === 'loaded') fams.push(f.family.replace(/["']/g, '')); });
      return fams;
    });
    const ok = fontsCss === 200 && loaded.includes('Bricolage Grotesque') && loaded.includes('Public Sans');
    check('Google Fonts load (Bricolage Grotesque, Public Sans)', ok, `stylesheet ${fontsCss}, loaded: ${loaded.join(', ') || 'none'}`);
  }

  const ready = await swReady(page);
  if (ready) await page.reload({ waitUntil: 'networkidle' });
  check('service worker controls the page', ready && await page.evaluate(() => !!navigator.serviceWorker.controller));
  await ctx.close();
});

section('roundtrip', async () => {
  const { ctx, page } = await openPage({ acceptDownloads: true });
  if (await swReady(page)) await page.reload({ waitUntil: 'networkidle' });

  // Edit an amount and wait for the debounced save.
  await page.locator(AMT).first().fill('1234');
  const saved = await page.waitForFunction((k) => {
    try { return JSON.parse(localStorage.getItem(k)).touched === true; } catch (e) { return false; }
  }, PLAN_KEY, { timeout: 3000 }).then(() => true, () => false);
  check('an edit is saved to localStorage', saved);

  // Export.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="export"]').first().click()]);
  const name = dl.suggestedFilename();
  const file = path.join(TMP, name);
  await dl.saveAs(file);
  if (process.env.SAVE_EXPORT) fs.copyFileSync(file, path.resolve(process.env.SAVE_EXPORT));
  const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('export is named budget-plan-YYYY-MM-DD.json', /^budget-plan-\d{4}-\d{2}-\d{2}\.json$/.test(name), name);
  check(`export has app, v=${DATA_VERSION}, exportedAt, exportedBy, state`,
    exp.app === APP_ID && exp.v === DATA_VERSION && !Number.isNaN(Date.parse(exp.exportedAt)) &&
    typeof exp.exportedBy === 'string' && !!exp.state && exp.state.v === DATA_VERSION,
    JSON.stringify({ app: exp.app, v: exp.v, exportedAt: exp.exportedAt, stateV: exp.state && exp.state.v }));

  // Import into a fresh profile.
  const b = await openPage({});
  await b.page.setInputFiles('#import-file', file);
  const replace = b.page.locator('[data-act="import-confirm"]');
  const offered = await replace.waitFor({ timeout: 3000 }).then(() => true, () => false);
  if (offered) await replace.click();
  const stored = JSON.parse(await b.page.evaluate((k) => localStorage.getItem(k), PLAN_KEY));
  check('import into a fresh profile restores the plan',
    offered && isDeepStrictEqual(withoutSyncFields(stored), withoutSyncFields(exp.state)) && (await firstAmount(b.page)) === '1234',
    offered ? 'restored plan differs from the exported one' : 'the file was not accepted ("Replace plan" never appeared)');
  await b.ctx.close();

  // Reload the first profile with the network off.
  await ctx.setOffline(true);
  const reloaded = await page.reload({ waitUntil: 'load' }).then(() => true, () => false);
  check('opens offline, with the edit kept', reloaded && (await firstAmount(page)) === '1234');
  await ctx.close();
});

section('layout', async () => {
  const background = {};
  for (const [label, width, height] of [['laptop', 1280, 900], ['phone', 390, 844]]) {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await openPage({ viewport: { width, height }, colorScheme: scheme });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${label} ${width}px ${scheme}: no horizontal scroll`, overflow <= 0, `${overflow}px too wide`);
      background[`${label}-${scheme}`] = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${label}-${scheme}.png`), fullPage: true });
      await ctx.close();
    }
  }
  check('dark theme applies', background['phone-light'] !== background['phone-dark'],
    `light ${background['phone-light']}, dark ${background['phone-dark']}`);
});

section('guard', async () => {
  const fx = JSON.parse(fs.readFileSync(FIXTURE_V1, 'utf8'));
  const newer = JSON.stringify(Object.assign({}, fx.state, { v: DATA_VERSION + 1 }));
  const { ctx, page } = await openPage({ storage: { [PLAN_KEY]: newer }, acceptDownloads: true });
  check('newer stored plan shows the newer-version banner', (await page.locator('#banner').innerText()).includes('newer version'));
  await page.locator(AMT).first().fill('999');
  await page.waitForTimeout(800);
  check('newer stored plan is never overwritten', (await page.evaluate((k) => localStorage.getItem(k), PLAN_KEY)) === newer);
  const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 1500 }).then(() => true, () => false),
    page.locator('[data-act="export"]').first().click(),
  ]);
  check('export is blocked while a newer plan is stored', dl[0] === false);
  await ctx.close();

  // Import of a newer file into a normal device.
  const b = await openPage({});
  const f = path.join(TMP, 'newer.json');
  fs.writeFileSync(f, JSON.stringify({ app: APP_ID, v: DATA_VERSION + 1, state: JSON.parse(newer) }));
  await b.page.setInputFiles('#import-file', f);
  await bannerText(b.page);
  check('importing a newer file shows the newer-version message', (await bannerText(b.page)).includes('newer version'));
  await b.ctx.close();
});

section('migration', async () => {
  const fx = JSON.parse(fs.readFileSync(FIXTURE_V1, 'utf8'));
  const withExtra = Object.assign({}, fx, { state: Object.assign({}, fx.state, { extra: { a: 1 } }) });
  const f = path.join(TMP, 'v1.json');
  fs.writeFileSync(f, JSON.stringify(withExtra));
  const { ctx, page } = await openPage({});
  await page.setInputFiles('#import-file', f);
  await page.locator('[data-act="import-confirm"]').click();
  const st = await page.evaluate(() => window.__hbp.state());
  check('v1 file imports as v2', st.v === 2 && st.cats.length === 0 && st.checkins.length === 0 && st.fund.acct === '' && st.fund.saved === 0);
  check('unknown fields are kept', isDeepStrictEqual(st.extra, { a: 1 }));
  const lines = (s) => s.scenarios.flatMap((x) => x.lines);
  check('every v1 line keeps its fields', lines(fx.state).length === lines(st).length &&
    lines(fx.state).every((l, i) => ['id', 'g', 'name', 'amt', 'f', 'acct'].every((k) => isDeepStrictEqual(lines(st)[i][k], l[k]))));
  check('need/want lines get cat and due', lines(st).filter((l) => l.g !== 'save').every((l) => l.cat === '' && l.due === 0));
  check('goals get an empty by', lines(st).filter((l) => l.goal).every((l) => l.goal.by === ''));
  await ctx.close();

  const raw = JSON.stringify(fx.state);
  const b = await openPage({ storage: { [PLAN_KEY]: raw } });
  check('stored v1 plan migrates on load', (await b.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).v, PLAN_KEY)) === 2);
  check('stored v1 plan is backed up', (await b.page.evaluate((k) => localStorage.getItem(k), BACKUP_KEY)) === raw);
  const m = await b.page.evaluate(() => [window.__hbp.prevMonth(new Date(2027, 0, 15)), window.__hbp.monthKey(window.__hbp.monthIndex('2026-12') + 1)]);
  check('months roll over the year', m[0] === '2026-12' && m[1] === '2027-01', JSON.stringify(m));
  await b.ctx.close();

  const c = await openPage({});
  const ex = await c.page.evaluate(() => window.__hbp.state());
  const car = lines(ex).find((l) => l.name === 'Car registration & maintenance');
  check('example plan is v2 with six categories and the fund on',
    ex.v === 2 && ex.cats.length === 6 && ex.fund.acct === 'jsav' && car && car.due === 3 && !!car.cat,
    JSON.stringify({ v: ex.v, cats: ex.cats && ex.cats.length, fund: ex.fund }));
  await c.ctx.close();
});

// Honeydue limits table rows as { name, amt, text }.
function hdRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('table.hd tr')).filter((tr) => tr.querySelector('.hd-n'))
    .map((tr) => ({ name: tr.querySelector('.hd-n').textContent.trim(), amt: tr.cells[tr.cells.length - 1].textContent.trim(), text: tr.textContent })));
}
const lineId = (page, name) => page.evaluate((n) => {
  const s = window.__hbp.state(); const sc = s.scenarios.find((x) => x.id === s.active);
  const l = sc.lines.find((x) => x.name === n); return l && l.id;
}, name);
const catId = (page, name) => page.evaluate((n) => { const c = window.__hbp.state().cats.find((x) => x.name === n); return c && c.id; }, name);

section('categories', async () => {
  const { ctx, page } = await openPage({});
  let rows = await hdRows(page);
  const bills = rows.find((r) => r.name === 'Bills & utilities');
  check('Honeydue list has a Bills & utilities row of $360', !!bills && bills.amt === '$360 / mo', JSON.stringify(bills));

  const billsId = await catId(page, 'Bills & utilities');
  await page.click(`#cn-${billsId}`);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('House bills');
  const focus = await page.evaluate(() => ({ id: document.activeElement.id, value: document.activeElement.value }));
  check('renaming a category keeps focus and every keystroke', focus.id === `cn-${billsId}` && focus.value === 'House bills', JSON.stringify(focus));
  rows = await hdRows(page);
  check('Honeydue row follows the new category name', rows.some((r) => r.name === 'House bills'));

  const internet = await lineId(page, 'Internet');
  await page.selectOption(`select[data-scope="line"][data-field="cat"][data-id="${internet}"]`, '');
  rows = await hdRows(page);
  const house = rows.find((r) => r.name === 'House bills');
  const net = rows.find((r) => r.name === 'Internet');
  check('a line taken out of a category gets its own limit', house && house.amt === '$300 / mo' && net && net.amt === '$60 / mo', JSON.stringify({ house, net }));
  const text = await page.evaluate(() => window.__hbp.honeydueText());
  check('copied list names the lines in each category',
    text.includes('House bills: $300 per month (Utilities (electric, gas, water), Phone, Insurance (car, renters))'), text);

  const groc = await catId(page, 'Groceries');
  await page.click(`[data-act="del-cat"][data-id="${groc}"]`);
  await page.click(`[data-act="del-cat"][data-id="${groc}"]`);
  rows = await hdRows(page);
  const offered = await page.evaluate(() => Array.from(document.querySelectorAll('select[data-field="cat"] option')).some((o) => o.textContent === 'Groceries'));
  check('deleting a category (clicked twice) frees its lines',
    rows.some((r) => r.name === 'Groceries & household supplies' && r.amt === '$600 / mo') && !offered, JSON.stringify(rows.map((r) => r.name)));
  await ctx.close();

  const phone = await openPage({ viewport: { width: 390, height: 844 } });
  const firstCat = await phone.page.evaluate(() => window.__hbp.state().cats[0].id);
  await phone.page.fill(`#cn-${firstCat}`, 'W'.repeat(60));
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('a 60-character category name fits a 390px screen', overflow <= 0, `${overflow}px too wide`);
  await phone.ctx.close();
});

const cardText = (page, tour) => page.evaluate((t) => { const el = document.querySelector(`[data-tour="${t}"]`); return el ? el.textContent : ''; }, tour);
const values = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.value));
const countText = (page, sel, text) => page.$$eval(sel, (els, t) => els.filter((e) => e.textContent.includes(t)).length, text);

section('checkin', async () => {
  const { ctx, page } = await openPage({ date: '2026-11-16T12:00' });
  const head = () => page.locator('[data-tour="checkin"] h2').innerText();
  check('a due check-in names last month', (await head()).includes('October check-in'), await head());
  check('the summary says the check-in is not done', (await page.locator('#summary').innerText()).includes('October check-in not done'));

  await page.click('[data-act="ci-start"]');
  const actual = 'input[data-scope="ci"][data-field="actual"]';
  check('starting lists every category, uncategorised line and "Anything else"', (await page.locator(actual).count()) === 10, String(await page.locator(actual).count()));
  const bal = await values(page, 'input[data-scope="cig"]');
  check('goal balances are pre-filled from the plan', bal.join() === '700,300,400', bal.join());
  check('pre-filled balances are marked as assumed', (await countText(page, '.ci-assumed', 'assumed from plan')) === 3);

  await page.locator(actual).first().click();
  await page.keyboard.type('125');
  const focus = await page.evaluate(() => ({ field: document.activeElement.dataset.field, value: document.activeElement.value }));
  check('typing an actual keeps focus and every keystroke', focus.field === 'actual' && focus.value === '125', JSON.stringify(focus));
  check('one entered row is counted', (await cardText(page, 'checkin')).includes('1 of 10 entered'));
  await page.locator(actual).nth(1).fill('0');
  check('a $0 actual counts as entered', (await cardText(page, 'checkin')).includes('2 of 10 entered'));
  await page.locator(actual).nth(1).fill('');
  check('a cleared actual counts as not entered', (await cardText(page, 'checkin')).includes('1 of 10 entered'));

  const ef = await lineId(page, 'Emergency fund');
  await page.fill(`#cig-${ef}`, '650');
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' });
  check('a corrected balance survives a reload', (await page.inputValue(`#cig-${ef}`)) === '650');
  check('"Saved so far" shows the check-in balance', (await page.inputValue(`#gs-${ef}`)) === '650');
  check('the summary chip clears once the month is checked in', !(await page.locator('#summary').innerText()).includes('check-in not done'));

  await page.clock.setFixedTime(new Date('2026-12-05T12:00'));
  await page.reload({ waitUntil: 'networkidle' });
  check('next month is due a month later', (await head()).includes('November check-in'), await head());
  await page.click('[data-act="ci-start"]');
  check('the next check-in starts from the corrected balance (no drift)', (await page.inputValue(`#cig-${ef}`)) === '1350');
  await page.click('[data-act="ci-del"]');
  await page.click('[data-act="ci-del"]');
  check('deleting a check-in (clicked twice) falls back to the earlier balance', (await page.inputValue(`#gs-${ef}`)) === '650');

  const groc = await catId(page, 'Groceries');
  await page.click(`[data-act="del-cat"][data-id="${groc}"]`);
  await page.click(`[data-act="del-cat"][data-id="${groc}"]`);
  await page.click('[data-act="del-scn"]');
  await page.click('[data-act="del-scn"]');
  await page.click('[data-act="ci-view"][data-id="2026-10"]');
  const oct = await cardText(page, 'checkin');
  check('an old check-in still shows a deleted category and scenario', oct.includes('Groceries') && oct.includes('Now'), oct.slice(0, 200));
  await ctx.close();
});

section('goals', async () => {
  const { ctx, page } = await openPage({ date: '2026-11-16T12:00' });
  const r = await page.evaluate(() => {
    const h = window.__hbp;
    return [
      h.dateStatus(6000, 0, 400, '2026-10', '2027-06'), h.dateStatus(6000, 0, 400, '2026-10', '2028-02'),
      h.dateStatus(6000, 0, 400, '2026-10', '2026-09'), h.dateStatus(6000, 6000, 400, '2026-10', '2027-06'),
      h.paceStatus(600, 700), h.paceStatus(700, 700)];
  });
  check('date: behind', r[0].text === 'Needs $350/mo more to make Jun 2027' && r[0].sub === 'At $400 a month: Jan 2028' && r[0].tone === 'warn', JSON.stringify(r[0]));
  check('date: on track', r[1].text === 'On track for Feb 2028' && r[1].tone === 'ok', JSON.stringify(r[1]));
  check('date: passed', r[2].text === 'Date passed, $6,000 short' && r[2].tone === 'bad', JSON.stringify(r[2]));
  check('reached', r[3].text === 'Reached', JSON.stringify(r[3]));
  check('pace: behind', r[4].text === '$100 behind plan' && r[4].tone === 'warn', JSON.stringify(r[4]));
  check('pace: on track', r[5].text === 'On track', JSON.stringify(r[5]));

  const mv = await lineId(page, 'Move-in fund (deposit, first month, movers)');
  await page.selectOption(`#gbm-${mv}`, '06');
  await page.selectOption(`#gby-${mv}`, '2027');
  const chip = () => page.locator(`[data-goal="${mv}"] .chip`).first().innerText();
  check('a goal date shows how much more is needed', (await chip()) === 'Needs $350/mo more to make Jun 2027', await chip());
  await page.click('[data-act="ci-start"]');
  const ciChip = await page.locator(`[data-out="cigs-${mv}"] .chip`).innerText();
  check('a goal on an unconfirmed check-in balance is marked assumed', ciChip.endsWith('(assumed)'), ciChip);
  await ctx.close();
});

/* ---------------- runner ---------------- */

(async () => {
  setTimeout(() => { console.error('FAIL  smoke test timed out after 5 minutes'); process.exit(1); }, 300000).unref();
  const server = await serve(ROOT);
  ORIGIN = `http://127.0.0.1:${server.address().port}`;
  APP_URL = ORIGIN + '/';
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  browser = await chromium.launch();
  try {
    for (const s of sections) {
      if (ONLY.length && !ONLY.includes(s.name)) continue;
      current = s.name;
      errors = [];
      try {
        await s.fn();
      } catch (e) {
        check('ran to the end', false, String(e.message || e).split('\n')[0]);
      }
      check('no uncaught errors, console errors or failed app files', errors.length === 0, errors.join('\n      '));
    }
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  for (const r of results) console.log(`${r.status}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
  if (SHOTS) console.log(`\nScreenshots in ${SHOTS}`);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exitCode = failed ? 1 : 0;
})();
