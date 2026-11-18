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
const backupKey = (k) => `household-budget-planner:plan:v${k}-backup`; // where a stored plan of version k is copied before its upgrade
const BACKUP_KEY = backupKey(1); // also where a stored value the app can't read is copied
const DATA_VERSION = 3; // Bump with the data model, and add a check that an older plan file still imports.
const FIXTURE_V1 = path.join(__dirname, 'fixtures', 'plan-v1.json');
const FIXTURE_V2 = path.join(__dirname, 'fixtures', 'plan-v2.json');
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

// The banner fills in asynchronously after a file is chosen (FileReader); wait up to 3 s for the text.
function bannerHas(page, text) {
  return page.waitForFunction((t) => document.getElementById('banner').innerText.includes(t), text, { timeout: 3000 }).then(() => true, () => false);
}

// serviceWorker.ready never settles if registration fails, so give it a deadline.
function swReady(page) {
  return page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]));
}

// The example plan as it was in v2, stored as the device's plan, so example-dependent sections do not follow later example changes.
const oldPlan = () => JSON.parse(fs.readFileSync(FIXTURE_V2, 'utf8')).state;
const OLD = () => ({ [PLAN_KEY]: JSON.stringify(oldPlan()) });

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

  // Card heads with a description keep their total or count where the group cards keep theirs:
  // top right beside the title on wide screens, under the description on a phone.
  for (const width of [1280, 700, 390]) {
    const { ctx, page } = await openPage({ viewport: { width, height: 900 } });
    const heads = await page.evaluate(() => ['need', 'yearly', 'categories'].map((t) => {
      const h = document.querySelector(`[data-tour="${t}"] .card-head`);
      const title = h.querySelector('h2').getBoundingClientRect(), aside = h.lastElementChild.getBoundingClientRect(), r = h.getBoundingClientRect();
      return { t, beside: aside.top < title.bottom, gap: Math.round(r.right - aside.right) };
    }));
    const need = heads[0];
    const bad = heads.filter((x) => x.beside !== need.beside || (x.beside && x.gap > 1));
    check(`${width}px: the yearly and category card heads lay out like the group cards`, bad.length === 0, JSON.stringify(heads));
    await ctx.close();
  }

  // A select can't wrap its text, so a long scenario name in "Compared with" must not widen the page.
  const ph = await openPage({ viewport: { width: 390, height: 844 }, date: '2026-11-16T12:00' });
  const long = 'Both of us working full time, paying rent and saving for a new car too';
  await ph.page.fill('#scn-name', long);
  await ph.page.click('[data-act="ci-start"]');
  const wide = await ph.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`a ${long.length}-character scenario name in "Compared with" fits a 390px screen`, wide <= 0, `${wide}px too wide`);
  await ph.ctx.close();
});

section('guard', async () => {
  const fx = JSON.parse(fs.readFileSync(FIXTURE_V1, 'utf8'));
  const newer = JSON.stringify(Object.assign({}, fx.state, { v: DATA_VERSION + 1 }));
  const { ctx, page } = await openPage({ storage: { [PLAN_KEY]: newer }, acceptDownloads: true });
  check('newer stored plan shows the newer-version banner', (await page.locator('#banner').innerText()).includes('newer version'));
  const saveChip = () => page.evaluate(() => { const c = document.querySelector('#save-status .chip'); return { cls: c.className, text: c.textContent }; });
  const notSaved = (c) => c.cls.split(' ').includes('bad') && c.text === 'Not saved: newer plan on this device';
  const onOpen = await saveChip();
  check('while a newer plan is stored, the save chip says nothing is saved', notSaved(onOpen), JSON.stringify(onOpen));
  await page.locator(AMT).first().fill('999');
  await page.waitForTimeout(800);
  check('newer stored plan is never overwritten', (await page.evaluate((k) => localStorage.getItem(k), PLAN_KEY)) === newer);
  const afterEdit = await saveChip();
  const sharing = await cardText(page, 'sharing');
  check('after an edit it still says nothing is saved, in the header and the sharing card',
    notSaved(afterEdit) && !sharing.includes('Saved on this device'), JSON.stringify(afterEdit) + ' | ' + sharing.slice(0, 80));
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
  check('importing a newer file shows the newer-version message', await bannerHas(b.page, 'newer version'));
  await b.ctx.close();
});

// What the v2 → v3 upgrade adds (spec §8), checked on the upgraded plan `st` against the v2-shaped plan `src` it came from.
function upgradeChecks(label, st, src) {
  const people = Array.isArray(st.people) ? st.people : [];
  const pid = people[0] && people[0].id;
  const acct = (a) => st.accounts[a] || {};
  const scns = JSON.stringify(st.scenarios.map((s) => ({ id: s.id, incomes: s.incomes.map((x) => `${x.who} → ${x.to}`), split: s.split })));
  check(`upgrade adds one placeholder person (${label})`, people.length === 1 && people[0].name === 'Person 1', `people: ${JSON.stringify(st.people)}`);
  check(`the five accounts get kinds and owners (${label})`, !!pid &&
    ['jchk', 'mchk'].every((a) => acct(a).kind === 'spend') && ['jsav', 'msav', 'inv'].every((a) => acct(a).kind === 'save') &&
    acct('mchk').owner === pid && acct('msav').owner === pid && ['jchk', 'jsav', 'inv'].every((a) => acct(a).owner === ''),
    JSON.stringify({ pid, accounts: st.accounts }));
  check(`acctOrder lists the five accounts (${label})`, String(st.acctOrder) === 'jchk,mchk,jsav,msav,inv', `acctOrder: ${JSON.stringify(st.acctOrder)}`);
  check(`every income is Person 1’s and lands where the scenario deposited it (${label})`, !!pid &&
    st.scenarios.every((s, i) => s.incomes.every((x) => x.who === pid && x.to === src.scenarios[i].depositTo)), `person ${pid}: ${scns}`);
  check(`every scenario splits by take-home (${label})`,
    st.scenarios.every((s) => !!s.split && s.split.mode === 'income' && isDeepStrictEqual(s.split.pct, {})), scns);
}

section('migration', async () => {
  const lines = (s) => s.scenarios.flatMap((x) => x.lines);
  // Imports `state` as a plan file of version `v` into a fresh profile and returns the plan the app then holds.
  const importInto = async (v, state) => {
    const f = path.join(TMP, `v${v}.json`);
    fs.writeFileSync(f, JSON.stringify({ app: APP_ID, v, exportedAt: new Date().toISOString(), exportedBy: '', state }));
    const { ctx, page } = await openPage({});
    await page.setInputFiles('#import-file', f);
    await page.locator('[data-act="import-confirm"]').click();
    const st = await page.evaluate(() => window.__hbp.state());
    await ctx.close();
    return st;
  };
  const stored = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);
  const storedV = async (page) => JSON.parse(await stored(page, PLAN_KEY)).v;

  const fx = JSON.parse(fs.readFileSync(FIXTURE_V1, 'utf8'));
  const st = await importInto(1, Object.assign({}, fx.state, { extra: { a: 1 } }));
  check(`v1 file imports as v${DATA_VERSION}`, st.v === DATA_VERSION && st.cats.length === 0 && st.checkins.length === 0 && st.fund.acct === '' && st.fund.saved === 0,
    JSON.stringify({ v: st.v, cats: st.cats, checkins: st.checkins, fund: st.fund }));
  check('unknown fields are kept', isDeepStrictEqual(st.extra, { a: 1 }));
  check('every v1 line keeps its fields', lines(fx.state).length === lines(st).length &&
    lines(fx.state).every((l, i) => ['id', 'g', 'name', 'amt', 'f', 'acct'].every((k) => isDeepStrictEqual(lines(st)[i][k], l[k]))));
  check('need/want lines get cat and due', lines(st).filter((l) => l.g !== 'save').every((l) => l.cat === '' && l.due === 0));
  check('goals get an empty by', lines(st).filter((l) => l.goal).every((l) => l.goal.by === ''));
  upgradeChecks('v1 file', st, fx.state);

  // A v2 file gains only the fields the upgrade adds; everything else, unknown fields included, is as it was.
  const src2 = Object.assign({}, oldPlan(), { extra: { a: 1 } });
  const st2 = await importInto(2, src2);
  check(`v2 file imports as v${DATA_VERSION}`, st2.v === DATA_VERSION, `v ${st2.v}`);
  upgradeChecks('v2 file', st2, src2);
  const rest = withoutSyncFields(st2), was = withoutSyncFields(src2);
  delete rest.v; delete was.v; delete rest.people; delete rest.acctOrder;
  Object.keys(rest.accounts).forEach((a) => { delete rest.accounts[a].kind; delete rest.accounts[a].owner; });
  rest.scenarios.forEach((s) => { delete s.split; s.incomes.forEach((x) => { delete x.who; delete x.to; }); });
  const differ = Object.keys(Object.assign({}, rest, was)).filter((k) => !isDeepStrictEqual(rest[k], was[k]));
  check('everything else in a v2 file is unchanged', differ.length === 0, `differs: ${differ.join(', ')}`);

  const raw = JSON.stringify(fx.state);
  const b = await openPage({ storage: { [PLAN_KEY]: raw } });
  const v1 = await storedV(b.page);
  check('stored v1 plan migrates on load', v1 === DATA_VERSION, `stored v ${v1}`);
  check('stored v1 plan is backed up', (await stored(b.page, backupKey(1))) === raw);
  const m = await b.page.evaluate(() => [window.__hbp.prevMonth(new Date(2027, 0, 15)), window.__hbp.monthKey(window.__hbp.monthIndex('2026-12') + 1)]);
  check('months roll over the year', m[0] === '2026-12' && m[1] === '2027-01', JSON.stringify(m));
  await b.ctx.close();

  const raw2 = JSON.stringify(oldPlan());
  const d = await openPage({ storage: { [PLAN_KEY]: raw2 } });
  const v2 = await storedV(d.page);
  check('stored v2 plan migrates on load', v2 === DATA_VERSION, `stored v ${v2}`);
  const bk = { v2: await stored(d.page, backupKey(2)), v1: await stored(d.page, backupKey(1)) };
  check('stored v2 plan is backed up under the v2 key', bk.v2 === raw2 && bk.v1 === null,
    `v2 key ${bk.v2 === raw2 ? 'holds the stored plan' : bk.v2 === null ? 'is empty' : 'holds something else'}, v1 key ${bk.v1 === null ? 'is empty' : 'is written'}`);

  // Equivalence: the v2 rule, computed here. Each account but the landing one receives the monthly sum of the lines
  // assigned to it (yearly need/want lines go to the fund account while the fund is on); the rest stays where pay lands.
  const old = oldPlan();
  const K = { mo: 1, wk: 52 / 12, yr: 1 / 12 };
  for (const s of old.scenarios) {
    const by = {};
    s.lines.forEach((l) => {
      const a = old.fund.acct && l.f === 'yr' && (l.g === 'need' || l.g === 'want') ? old.fund.acct : l.acct;
      by[a] = (by[a] || 0) + Math.max(0, Number(l.amt) || 0) * (K[l.f] || 1);
    });
    const I = s.incomes.reduce((sum, x) => sum + Math.max(0, Number(x.amt) || 0), 0);
    const items = ['jchk', 'mchk', 'jsav', 'msav', 'inv'].filter((a) => a !== s.depositTo && (by[a] || 0) > 0.5).map((a) => ({ a, amt: by[a] }));
    const expKeep = I - items.reduce((sum, x) => sum + x.amt, 0);
    const exp = { land: s.depositTo, items, keep: expKeep };
    const t = await d.page.evaluate((id) => (window.__hbp.transfers ? window.__hbp.transfers(id) : null), s.id);
    const sameItems = !!t && t.land === exp.land && t.items.length === items.length &&
      t.items.every((x, k) => x.a === items[k].a && Math.abs(x.amt - items[k].amt) < 1e-9);
    check(`an upgraded scenario’s payday plan is unchanged (${s.id})`, sameItems && Math.abs(t.keep - expKeep) < 1e-9, JSON.stringify({ t, exp }));
  }

  // What the app adds to an upgraded plan keeps it loadable: an income needs a person and an account, a scenario a split.
  await d.page.click('[data-act="add-inc"]');
  await d.page.click('[data-act="new-scn"]');
  await until(d.page, (k) => { try { return JSON.parse(localStorage.getItem(k)).scenarios.length === 3; } catch (e) { return false; } }, PLAN_KEY);
  await d.page.reload({ waitUntil: 'networkidle' });
  const back = await d.page.evaluate(() => { const s = window.__hbp.state(); return { scenarios: s.scenarios.length, incomes: s.scenarios[0].incomes.length }; });
  check('an income and a scenario added after the upgrade still load after a reload', back.scenarios === 3 && back.incomes === 3, JSON.stringify(back));
  await d.ctx.close();

  const c = await openPage({});
  const ex = await c.page.evaluate(() => window.__hbp.state());
  const car = lines(ex).find((l) => l.name === 'Car registration & maintenance');
  check(`example plan is v${DATA_VERSION} with six categories and the fund on`,
    ex.v === DATA_VERSION && ex.cats.length === 6 && ex.fund.acct === 'jsav' && car && car.due === 3 && !!car.cat,
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
  const { ctx, page } = await openPage({ storage: OLD() });
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

  const phone = await openPage({ storage: OLD(), viewport: { width: 390, height: 844 } });
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
  const { ctx, page } = await openPage({ storage: OLD(), date: '2026-11-16T12:00' });
  const head = () => page.locator('[data-tour="checkin"] h2').innerText();
  check('a due check-in names last month', (await head()).includes('October check-in'), await head());
  const summary = () => page.locator('#summary').innerText();
  check('the untouched example plan doesn’t say a check-in is due', !(await summary()).includes('check-in not done'), await summary());
  await page.fill('#ao-jchk', 'Shared bills and rent'); // any edit makes it your plan
  check('once the plan is edited, the summary says the check-in is not done', (await summary()).includes('October check-in not done'));

  await page.click('[data-act="ci-start"]');
  const actual = 'input[data-scope="ci"][data-field="actual"]';
  check('starting lists every category, uncategorised line and "Anything else"', (await page.locator(actual).count()) === 10, String(await page.locator(actual).count()));
  const bal = await values(page, 'input[data-scope="cig"]');
  check('a first check-in for last month starts goal balances from "Saved so far"', bal.join() === '0,0,0', bal.join());
  check('pre-filled goal balances are marked as assumed', (await countText(page, '.ci-assumed:not([data-out="cias-fund"])', 'assumed from plan')) === 3);

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
  await page.click('[data-act="del-scn"][data-id="now"]');
  await page.click('[data-act="del-scn"][data-id="now"]');
  await page.click('[data-act="ci-view"][data-id="2026-10"]');
  const oct = await cardText(page, 'checkin');
  check('an old check-in still shows a deleted category and scenario', oct.includes('Groceries') && oct.includes('Now'), oct.slice(0, 200));
  await ctx.close();
});

section('goals', async () => {
  const { ctx, page } = await openPage({ storage: OLD(), date: '2026-11-16T12:00' });
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
  const gl = await page.locator(`[data-goal="${mv}"]`).innerText();
  check('a goal shows one projected date, from the same month as its status',
    gl.includes('around Jan 2028') && !gl.includes('Feb 2028') && !gl.includes('At $400 a month'), gl);
  // Choosing only a month means its next occurrence (today is 16 Nov 2026); clearing the year clears the date.
  const fun = await lineId(page, 'Fun & vacation');
  const by = () => page.evaluate((id) => {
    const s = window.__hbp.state(); const l = s.scenarios.find((x) => x.id === s.active).lines.find((x) => x.id === id);
    return [l.goal.by, document.getElementById('gbm-' + id).value, document.getElementById('gby-' + id).value].join('|');
  }, fun);
  await page.selectOption(`#gbm-${fun}`, '06');
  const jun = await by();
  await page.selectOption(`#gby-${fun}`, '');
  const cleared = await by();
  await page.selectOption(`#gbm-${fun}`, '12');
  const dec = await by();
  check('a By month without a year takes the next one (Jun → 2027, Dec → 2026)', jun === '2027-06|06|2027' && dec === '2026-12|12|2026', `${jun} / ${dec}`);
  check('clearing the By year clears the date and its month', cleared === '||', cleared);

  await page.click('[data-act="ci-start"]');
  const ciChip = await page.locator(`[data-out="cigs-${mv}"] .chip`).innerText();
  check('a goal on an unconfirmed check-in balance is marked assumed', ciChip.endsWith('(assumed)'), ciChip);
  await ctx.close();
});

const stepText = (page, acct) => page.evaluate((a) => {
  const li = Array.from(document.querySelectorAll('.steps li')).find((x) => x.textContent.includes(`Move to ${a}`));
  return li ? li.textContent : '';
}, acct);

section('yearly', async () => {
  const { ctx, page } = await openPage({ storage: OLD(), date: '2026-11-16T12:00' });
  const bills = [{ name: 'Car', amt: 600, due: 3 }, { name: 'Gifts', amt: 800, due: 12 }];
  const p = await page.evaluate((b) => [window.__hbp.projectFund(0, '2026-10', 1400 / 12, b), window.__hbp.projectFund(117, '2026-10', 1400 / 12, b)], bills);
  check('fund: first-year shortfall', Math.abs(p[0].S - 816.67) < 0.01 && p[0].minKey === '2027-03' &&
    p[0].months.map((m) => m.key).join() === '2026-12,2027-03' && Math.abs(p[0].months[0].F + 566.67) < 0.01, JSON.stringify(p[0]));
  check('fund: with a balance', Math.abs(p[1].S - 699.67) < 0.01, JSON.stringify(p[1].S));

  const js = await stepText(page, 'Joint savings');
  check('the yearly share is moved to the fund each payday', js.includes('$1,217') && js.includes('yearly costs fund $117'), js);
  const card = await cardText(page, 'yearly');
  check('the yearly card warns about a first-year shortfall', card.includes('Short $817 by Mar 2027'), card.slice(0, 300));
  check('the yearly card lists bills with the fund balance after each',
    /Dec 2026[^]*−\$567/.test(card) && /Mar 2027[^]*−\$817/.test(card), card.slice(0, 400));

  let rows = await hdRows(page);
  const tr = rows.find((r) => r.name === 'Transportation');
  const note = await page.locator('section[aria-label="Honeydue category limits"]').innerText();
  check('Honeydue limits leave yearly costs to the fund', tr && tr.amt === '$150 / mo' && !rows.some((r) => r.name === 'Gifts'), JSON.stringify(rows.map((r) => r.name + ' ' + r.amt)));
  check('Honeydue card names the yearly costs paid from the fund',
    note.includes('Car registration & maintenance $600 (Mar)') && note.includes('Gifts & holidays $800 (Dec)'), note.slice(-300));

  const sr = await page.evaluate(() => [window.__hbp.spendRows('2027-03'), window.__hbp.spendRows('2027-04')]
    .map((rs) => rs.find((r) => r.name === 'Transportation').planned));
  check('a check-in expects the full bill in its due month only', sr[0] === 750 && sr[1] === 150, JSON.stringify(sr));

  await page.selectOption('#ci-month', '2026-11'); // this month: one month of set-aside on top of the fund
  await page.click('[data-act="ci-start"]');
  check('the check-in pre-fills the fund balance', (await page.inputValue('#cif')) === '117' &&
    (await page.locator('[data-out="cias-fund"]').innerText()) === 'assumed from plan');
  check('the account check includes the fund', (await cardText(page, 'checkin')).includes('Joint savings holds $1,217'));

  await page.selectOption('#fund-acct', '');
  const jc = await stepText(page, 'Joint checking');
  const js2 = await stepText(page, 'Joint savings');
  check('with the fund off, transfers match the old app', jc.includes('$2,127') && js2.includes('$1,100'), jc + ' | ' + js2);
  rows = await hdRows(page);
  const tr2 = rows.find((r) => r.name === 'Transportation');
  check('with the fund off, yearly costs are back in the limits at 1/12', tr2 && tr2.amt === '$200 / mo' && tr2.text.includes('includes yearly costs at 1/12'), JSON.stringify(tr2));
  await ctx.close();

  // A bill bigger than what's in the fund leaves it at $0 (the rest is paid from checking), never at a negative balance.
  const d = await openPage({ storage: OLD(), date: '2026-12-10T12:00' });
  await d.page.selectOption('#ci-month', '2026-12'); // the $800 December bill, $117 set aside, nothing saved yet
  await d.page.click('[data-act="ci-start"]');
  const fb = () => d.page.evaluate(() => window.__hbp.state().checkins[0].fund.balance);
  const started = await fb();
  await d.page.click('[data-act="ci-retake"]');
  const retaken = await fb();
  check('a fund pre-fill never stores a negative balance', started === 0 && retaken === 0, JSON.stringify({ started, retaken }));
  await d.ctx.close();
});

// Waits until the current tour step's target is on screen and outlined (or the step has no target).
function tourStepShown(page) {
  return page.waitForFunction(() => {
    const st = window.__hbp.tourState();
    if (st.i < 0) return false;
    if (!st.sel) return true;
    const el = document.querySelector(st.sel);
    if (!el) return false;
    const r = el.getBoundingClientRect(), sp = document.getElementById('tour-spot').getBoundingClientRect();
    const overlap = sp.left < r.right && sp.right > r.left && sp.top < r.bottom && sp.bottom > r.top;
    return r.top >= 0 && r.top < innerHeight && overlap;
  }, null, { timeout: 3000 }).then(() => true, () => false);
}

section('tour', async () => {
  const { ctx, page } = await openPage({});
  check('first open offers the tour', await bannerHas(page, 'New here? Take a 2-minute tour'));
  await page.click('[data-act="tour-later"]');
  await page.reload({ waitUntil: 'networkidle' });
  check('"Not now" stops the offer on this device', !(await page.locator('#banner').innerText()).includes('New here?'));

  await page.click('#tour-btn');
  check('the Tour button opens step 1 of 17', (await page.locator('#tour').isVisible()) && (await page.locator('#tour').innerText()).includes('1 of 17'));
  const missed = [];
  for (let i = 2; i <= 17; i++) {
    await page.keyboard.press('ArrowRight');
    if (!(await tourStepShown(page))) missed.push(i);
  }
  check('every step scrolls its part into view and outlines it', missed.length === 0, `steps not shown: ${missed.join(', ')}`);
  check('the last step offers Finish', (await page.locator('#tour').innerText()).includes('Finish'));
  await page.click('#tour [data-tour-act="next"]');
  const after = await page.evaluate(() => ({ hidden: document.getElementById('tour').hidden, focus: document.activeElement.id }));
  check('Finish closes the tour and returns focus to the Tour button', after.hidden && after.focus === 'tour-btn', JSON.stringify(after));

  await page.click('#tour-btn');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  check('Tab stays inside the tour', await page.evaluate(() => document.getElementById('tour').contains(document.activeElement)));
  await page.keyboard.press('Escape');
  check('Escape closes the tour', await page.evaluate(() => document.getElementById('tour').hidden));
  await ctx.close();

  const ph = await openPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await ph.page.click('[data-act="tour-start"]');
  let worst = 0;
  for (let i = 2; i <= 17; i++) {
    await ph.page.keyboard.press('ArrowRight');
    await tourStepShown(ph.page);
    if (i === 8 && SHOTS) await ph.page.screenshot({ path: path.join(SHOTS, 'phone-tour.png') });
    worst = Math.max(worst, await ph.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  }
  const w = await ph.page.evaluate(() => document.querySelector('#tour .tour-in').getBoundingClientRect().width);
  check('on a phone the tour fits the screen', w <= 390 && worst <= 0, `caption ${w}px, overflow ${worst}px`);
  await ph.ctx.close();
});

section('retake', async () => {
  const { ctx, page } = await openPage({ storage: OLD(), date: '2026-11-16T12:00' });
  await page.click('[data-act="ci-start"]');
  const me = await page.evaluate(() => window.__hbp.state().checkins[0].spend.findIndex((r) => r.name === 'Personal spending: me'));
  await page.fill(`#cia-${me}`, '210');
  const mv = await lineId(page, 'Move-in fund (deposit, first month, movers)');
  await page.fill(`#cig-${mv}`, '999');
  await page.selectOption('#ci-scn', 'later');
  await page.selectOption('#ci-scn', 'now');
  const ci = await page.evaluate(() => window.__hbp.state().checkins[0]);
  const me2 = ci.spend.find((r) => r.name === 'Personal spending: me');
  const row = ci.goals.find((g) => g.name.startsWith('Move-in'));
  check('switching "Compared with" and back keeps a typed actual', !!me2 && me2.actual === 210, JSON.stringify(me2));
  check('switching "Compared with" and back keeps a typed balance', !!row && row.balance === 999 && row.assumed === false, JSON.stringify(row));
  check('"Saved so far" keeps the typed balance after switching back', (await page.inputValue(`#gs-${mv}`)) === '999');
  await ctx.close();

  // Re-taking keeps the fund row's months, so the bills due must be counted over those same months,
  // even after the earlier check-in it was counted from is deleted.
  const b = await openPage({ storage: OLD(), date: '2026-11-16T12:00' });
  await b.page.fill('#fund-bal', '1000');
  await b.page.click('[data-act="ci-start"]'); // October
  await b.page.waitForTimeout(500);
  await b.page.clock.setFixedTime(new Date('2027-01-05T12:00'));
  await b.page.reload({ waitUntil: 'networkidle' });
  await b.page.click('[data-act="ci-start"]'); // December: November and December since October, with the $800 December bill
  const dec = () => b.page.evaluate(() => { const f = window.__hbp.state().checkins.find((x) => x.month === '2026-12').fund; return { months: f.months, due: f.due, balance: f.balance }; });
  const started = await dec();
  await b.page.click('[data-act="ci-view"][data-id="2026-10"]');
  await b.page.click('[data-act="ci-del"]');
  await b.page.click('[data-act="ci-del"]');
  await b.page.click('[data-act="ci-retake"]');
  const retaken = await dec();
  check('re-taking a check-in counts fund bills over its own months', started.months === 2 && started.due === 800 && started.balance === 433 &&
    isDeepStrictEqual(retaken, started), JSON.stringify({ started, retaken }));
  await b.ctx.close();
});

// Check-in buttons that re-draw the card keep keyboard focus on a sensible control instead of dropping it to the page.
section('focus', async () => {
  const { ctx, page } = await openPage({ storage: OLD(), date: '2026-11-16T12:00' });
  const focused = () => page.evaluate(() => { const a = document.activeElement; return { act: a.dataset.act || a.tagName, id: a.dataset.id, text: a.textContent.trim().slice(0, 60) }; });
  const press = async (sel) => { await page.locator(sel).focus(); await page.keyboard.press('Enter'); return focused(); };
  await page.click('[data-act="ci-start"]'); // October
  const del = await press('[data-act="ci-del"]');
  check('after the first "Delete this check-in", focus stays on the armed button', del.act === 'ci-del' && del.text === 'Click again to delete this check-in', JSON.stringify(del));
  const re = await press('[data-act="ci-retake"]');
  check('after "Use current plan amounts", focus stays on it', re.act === 'ci-retake', JSON.stringify(re));
  await page.waitForTimeout(500);

  await page.clock.setFixedTime(new Date('2026-12-05T12:00'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-act="ci-start"]'); // November; October is now in the history
  const open = await press('[data-act="ci-view"][data-id="2026-10"]');
  check('choosing a month in the history moves focus to Close', open.act === 'ci-view' && open.id === '' && (await cardText(page, 'checkin')).includes('October check-in'), JSON.stringify(open));
  const back = await press('[data-act="ci-view"][data-id=""]');
  check('Close returns focus to that month in the history', back.act === 'ci-view' && back.id === '2026-10', JSON.stringify(back));
  // Open October, then November (the latest) from the history, then Close: November is the default view again,
  // so it has no history button; focus goes to the form now shown.
  await press('[data-act="ci-view"][data-id="2026-10"]');
  await press('[data-act="ci-view"][data-id="2026-11"]');
  await press('[data-act="ci-view"][data-id=""]');
  const fallback = await page.evaluate(() => document.activeElement.id);
  check('closing the latest month moves focus to its form', fallback === 'cia-0', fallback);
  await ctx.close();
});

// A month opened from the check-in history belongs to the plan it came from: import and reset close it.
section('resets', async () => {
  const viewingOctober = async () => {
    const o = await openPage({ storage: OLD(), date: '2026-11-16T12:00' });
    await o.page.click('[data-act="ci-start"]'); // October
    await o.page.waitForTimeout(500);
    await o.page.clock.setFixedTime(new Date('2026-12-05T12:00'));
    await o.page.reload({ waitUntil: 'networkidle' });
    await o.page.click('[data-act="ci-view"][data-id="2026-10"]');
    return o;
  };
  const histButtons = (page) => page.$$eval('[data-act="ci-view"]', (els) => els.map((e) => e.textContent.trim()));

  const a = await viewingOctober();
  await a.page.click('[data-act="reset"]');
  await a.page.click('[data-act="reset"]');
  const afterReset = await histButtons(a.page);
  check('"Reset to example plan" closes a month opened from the history', afterReset.length === 0, JSON.stringify(afterReset));
  await a.ctx.close();

  const b = await viewingOctober();
  await b.page.setInputFiles('#import-file', FIXTURE_V1);
  await b.page.click('[data-act="import-confirm"]');
  const afterImport = await histButtons(b.page);
  check('importing a plan closes a month opened from the history', afterImport.length === 0, JSON.stringify(afterImport));
  await b.ctx.close();
});

section('first-checkin', async () => {
  const { ctx, page } = await openPage({ storage: OLD(), date: '2026-11-16T12:00' });
  const mv = await lineId(page, 'Move-in fund (deposit, first month, movers)');
  const ef = await lineId(page, 'Emergency fund');
  await page.selectOption(`#gbm-${mv}`, '06');
  await page.selectOption(`#gby-${mv}`, '2027');
  await page.fill(`#gs-${ef}`, '500');
  const mvChip = () => page.locator(`[data-goal="${mv}"] .chip`).first().innerText();
  const before = { fund: await cardText(page, 'yearly'), mv: await mvChip() };
  await page.click('[data-act="ci-start"]'); // October, last month
  check('a first check-in for last month starts from "Saved so far"', (await page.inputValue(`#cig-${ef}`)) === '500');
  const after = { fund: await cardText(page, 'yearly'), mv: await mvChip() };
  check('starting a check-in changes no goal or fund status',
    before.fund.includes('Short $817 by Mar 2027') && after.fund.includes('Short $817 by Mar 2027') && after.mv.startsWith(before.mv),
    JSON.stringify({ before: before.mv, after: after.mv }));
  const lab = await page.locator(`label[for="gs-${ef}"]`).innerText();
  const flab = await page.locator('label[for="fund-bal"]').innerText();
  check('a balance that comes from a check-in is labelled with its month',
    lab.includes('Balance at end of Oct 2026') && flab.includes('Balance at end of Oct 2026'), `${lab} | ${flab}`);
  await ctx.close();
});

section('import-safety', async () => {
  const { ctx, page } = await openPage({});
  const good = await page.evaluate(() => JSON.parse(JSON.stringify(window.__hbp.state())));
  const variant = (fn) => { const st = JSON.parse(JSON.stringify(good)); fn(st); return st; };
  const files = {
    'check-in without spend rows': variant((st) => { st.checkins = [{ month: '2026-10', scn: 'now', scnName: 'Now', startedAt: 0, by: '', goals: [], fund: null }]; }),
    'category id with markup': variant((st) => { st.cats[0].id = 'x"><img src=x onerror="window.__pwned=1">'; }),
    'check-in month with markup': variant((st) => { st.checkins = [{ month: '2026-13"><b>', scn: 'now', scnName: 'Now', startedAt: 0, by: '', spend: [], goals: [], fund: null }]; }),
    'no people': variant((st) => { st.people = []; }),
    'person id with markup': variant((st) => { st.people[0].id = 'x"><b>'; }),
    'account id with markup': variant((st) => { st.accounts['x"><b>'] = { name: 'X', note: '', kind: 'spend', owner: '' }; st.acctOrder.push('x"><b>'); }),
    'acctOrder names a missing account': variant((st) => { st.acctOrder.push('nope'); }),
    'no savings account': variant((st) => {
      const sv = Object.keys(st.accounts).filter((a) => st.accounts[a].kind === 'save');
      sv.forEach((a) => { delete st.accounts[a]; }); st.acctOrder = st.acctOrder.filter((a) => !sv.includes(a)); st.fund.acct = '';
    }),
    'unknown split mode': variant((st) => { st.scenarios[0].split.mode = 'half'; }),
  };
  for (const [name, st] of Object.entries(files)) {
    await page.reload({ waitUntil: 'networkidle' });
    const f = path.join(TMP, 'bad.json');
    fs.writeFileSync(f, JSON.stringify({ app: APP_ID, v: DATA_VERSION, exportedAt: new Date().toISOString(), exportedBy: '', state: st }));
    await page.setInputFiles('#import-file', f);
    const refused = await bannerHas(page, 'isn’t a budget plan file');
    check(`a malformed file is refused (${name})`, refused && (await page.locator('[data-act="import-confirm"]').count()) === 0);
  }
  check('no script from a file runs', await page.evaluate(() => window.__pwned === undefined));
  await ctx.close();

  const broken = JSON.stringify(files['check-in without spend rows']);
  const b = await openPage({ storage: { [PLAN_KEY]: broken } });
  check('a stored plan the app cannot read is backed up before anything can overwrite it',
    (await b.page.evaluate((k) => localStorage.getItem(k), BACKUP_KEY)) === broken);
  await b.ctx.close();
});

section('scenarios', async () => {
  const { ctx, page } = await openPage({ storage: OLD() });
  const st = () => page.evaluate(() => window.__hbp.state());
  const ids = async () => (await st()).scenarios.map((x) => x.id).join();
  const del = (id) => page.locator(`[data-act="del-scn"][data-id="${id}"]`);

  await page.click('[data-act="new-scn"]');
  let s = await st();
  const fresh = s.scenarios[s.scenarios.length - 1];
  check('"+ New scenario" adds a blank scenario and opens it',
    s.scenarios.length === 3 && s.active === fresh.id && fresh.name === 'New scenario' && fresh.incomes.length === 0 && fresh.lines.length === 0,
    JSON.stringify({ n: s.scenarios.length, active: s.active, name: fresh.name, incomes: fresh.incomes.length, lines: fresh.lines.length }));
  check('and puts the cursor in its name', (await page.evaluate(() => document.activeElement.id)) === 'scn-name');
  check('a blank scenario shows no NaN or Infinity', !/NaN|Infinity/.test(await page.locator('#root').innerText()));

  await del('later').click();
  check('one click on a tab’s × only asks', (await ids()) === `now,later,${fresh.id}` && (await del('later').innerText()) === 'Delete?',
    `${await ids()} | ${await del('later').innerText()}`);
  check('the asking button keeps focus', (await page.evaluate(() => document.activeElement.dataset.id)) === 'later');
  await del('later').click();
  s = await st();
  check('a second click deletes that scenario without leaving the open one', (await ids()) === `now,${fresh.id}` && s.active === fresh.id);

  await del('now').click();
  await del(fresh.id).click();
  check('clicking another tab’s × asks about that one instead of deleting it',
    (await ids()) === `now,${fresh.id}` && (await del(fresh.id).innerText()) === 'Delete?' && (await del('now').innerText()) !== 'Delete?');
  await del(fresh.id).click();
  s = await st();
  const focus = await page.evaluate(() => ({ act: document.activeElement.dataset.act, id: document.activeElement.dataset.id }));
  check('deleting the open scenario opens another and focuses its tab',
    s.scenarios.length === 1 && s.active === 'now' && focus.act === 'tab' && focus.id === 'now', JSON.stringify({ active: s.active, focus }));
  check('the last scenario cannot be deleted', (await page.locator('[data-act="del-scn"]').count()) === 0);
  check('deleting is saved', await until(page, (k) => { try { return JSON.parse(localStorage.getItem(k)).scenarios.length === 1; } catch (e) { return false; } }, PLAN_KEY));
  await ctx.close();

  for (const scheme of ['light', 'dark']) {
    const ph = await openPage({ storage: OLD(), viewport: { width: 390, height: 844 }, colorScheme: scheme });
    for (let i = 0; i < 3; i++) await ph.page.click('[data-act="new-scn"]');
    await ph.page.locator('[data-act="del-scn"]').nth(1).click();
    const overflow = await ph.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`five scenarios fit a 390px screen (${scheme})`, overflow <= 0, `${overflow}px too wide`);
    if (SHOTS) await ph.page.locator('#tabs').screenshot({ path: path.join(SHOTS, `phone-scenarios-${scheme}.png`) });
    await ph.ctx.close();
  }
});

// Two windows of the app on one device share localStorage. Opens both in one browser context.
async function twoWindows(opts = {}) {
  const { ctx, page: a } = await openPage(opts);
  const b = await ctx.newPage();
  watch(b, current);
  if (opts.date) await b.clock.setFixedTime(new Date(opts.date));
  await b.goto(APP_URL, { waitUntil: 'networkidle' });
  return { ctx, a, b };
}
const rawPlan = (page) => page.evaluate((k) => localStorage.getItem(k), PLAN_KEY);
const pagehide = (page) => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 3000 }).then(() => true, () => false);
// Edits an amount and waits for the debounced save, so the window's pagehide would write its plan again.
async function editAndSave(page, value) {
  await page.locator(AMT).first().fill(value);
  await until(page, ([k, v]) => (localStorage.getItem(k) || '').includes(`"amt":${v}`), [PLAN_KEY, value]);
}

section('two-windows', async () => {
  const fx = JSON.parse(fs.readFileSync(FIXTURE_V1, 'utf8'));

  // A check-in started in one window survives the other window's next edit and its pagehide.
  let w = await twoWindows({ date: '2026-11-16T12:00' });
  await editAndSave(w.b, '1111');
  await w.b.click('[data-act="reset"]'); // armed: one more click would reset the plan
  await w.a.click('[data-act="ci-start"]');
  const saved = await until(w.a, (k) => { try { return JSON.parse(localStorage.getItem(k)).checkins.length === 1; } catch (e) { return false; } }, PLAN_KEY);
  check('a check-in started in one window is saved', saved);
  const rows = await w.a.evaluate((k) => JSON.parse(localStorage.getItem(k)).checkins[0].spend.length, PLAN_KEY);
  check('the other window shows it without a reload',
    await until(w.b, (n) => document.querySelectorAll('input[data-scope="ci"][data-field="actual"]').length === n, rows));
  check('the other window says it was updated', await bannerHas(w.b, 'Updated from another window'));
  check('a click-twice confirm armed before the update is disarmed', !(await w.b.locator('#foot').innerText()).includes('Click again'));
  await w.b.locator(AMT).first().fill('2222');
  await pagehide(w.b);
  const after = JSON.parse(await rawPlan(w.a));
  check('an edit and pagehide in the other window keep the check-in', after.checkins.length === 1 && after.checkins[0].month === '2026-10',
    `${after.checkins.length} check-ins stored`);
  check('the first window then shows that edit', await until(w.a, (sel) => document.querySelector(sel).value === '2222', AMT));
  await w.ctx.close();

  // A newer app version in another window saved a newer plan: this window must stop saving, as on load.
  w = await twoWindows({});
  await editAndSave(w.b, '1111');
  const newer = JSON.stringify(Object.assign({}, fx.state, { v: DATA_VERSION + 1 }));
  await w.a.evaluate(([k, v]) => localStorage.setItem(k, v), [PLAN_KEY, newer]);
  check('a newer plan saved in another window shows the newer-version message', await bannerHas(w.b, 'newer version'));
  const status = await w.b.locator('#save-status').innerText();
  const side = await w.b.locator('.sync-meta').innerText();
  check('and the save status says this window no longer saves', status.includes('Not saved: newer plan') && side.includes('Not saved: a newer plan'),
    `${status} | ${side.split('\n')[0]}`);
  await w.b.locator(AMT).first().fill('2222');
  await w.b.waitForTimeout(500);
  await pagehide(w.b);
  check('and this window never saves over it', (await rawPlan(w.b)) === newer);
  await w.ctx.close();

  // An older-format plan from another window goes through the same migration, and is not written back.
  w = await twoWindows({});
  await editAndSave(w.b, '1111');
  const older = JSON.parse(JSON.stringify(fx.state));
  older.scenarios[0].name = 'Saved by an older window';
  const olderRaw = JSON.stringify(older);
  await w.a.evaluate(([k, v]) => localStorage.setItem(k, v), [PLAN_KEY, olderRaw]);
  check('a v1 plan saved in another window is migrated and shown',
    await until(w.b, () => document.getElementById('tabs').innerText.includes('Saved by an older window')));
  await w.b.waitForTimeout(500);
  await pagehide(w.b);
  check('the window that receives a change does not write it back', (await rawPlan(w.b)) === olderRaw);
  await w.ctx.close();

  // Something unreadable in storage: keep this window's plan and back the value up before it can be saved over.
  w = await twoWindows({});
  await editAndSave(w.b, '1111');
  await w.a.evaluate((k) => localStorage.setItem(k, '{"broken":'), PLAN_KEY);
  check('an unreadable value from another window is backed up',
    await until(w.b, (k) => localStorage.getItem(k) === '{"broken":', BACKUP_KEY));
  check('and this window keeps its own plan', (await firstAmount(w.b)) === '1111');
  await w.ctx.close();
});

// A page restored from the back/forward cache must catch up with a plan another window saved while it was
// away. Chromium delivers the storage event on restore; the app also re-reads on pageshow for engines that
// might not, which the second run imitates by dropping storage events in the restored page. Playwright turns
// the cache off and its headless shell has none, so this section starts full Chromium with the cache on.
section('bfcache', async () => {
  let bf;
  try {
    bf = await chromium.launch({ channel: 'chromium', ignoreDefaultArgs: ['--disable-back-forward-cache'] });
  } catch (e) {
    warn('back/forward cache', 'full Chromium is not installed (npx playwright install chromium); skipped');
    return;
  }
  const opened = async (ctx, init) => {
    const p = await ctx.newPage();
    watch(p, current);
    if (init) await p.addInitScript(init);
    await p.clock.setFixedTime(new Date('2026-11-16T12:00'));
    await p.goto(APP_URL, { waitUntil: 'networkidle' });
    return p;
  };
  // Leaves the app for another page and comes back; true if the same document came back from the cache.
  const awayAndBack = async (page, between) => {
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.goto('data:text/html,<link rel="icon" href="data:,"><p>Another page'); // its own icon: no favicon request
    if (between) await between();
    await page.goBack({ waitUntil: 'commit' });
    return page.evaluate(() => window.__sameDocument === true);
  };
  try {
    for (const drop of [false, true]) {
      const label = drop ? 'storage events lost' : 'storage events delivered';
      const ctx = await bf.newContext({ viewport: { width: 1280, height: 900 } });
      ctx.setDefaultTimeout(10000);
      const a = await opened(ctx);
      const b = await opened(ctx, drop ? () => {
        addEventListener('storage', (e) => e.stopImmediatePropagation(), true);
      } : null);
      await editAndSave(b, '1111');
      const noUpdateShown = async (name) => {
        const back = await awayAndBack(b);
        check(`${label}: ${name}`, back && !(await b.locator('#banner').innerText()).includes('Updated from another window'),
          back ? 'shows "Updated from another window"' : 'not restored from the cache');
      };
      if (drop) await noUpdateShown('back with nothing changed shows no update');
      const cached = await awayAndBack(b, async () => {
        await a.click('[data-act="ci-start"]');
        await until(a, (k) => { try { return JSON.parse(localStorage.getItem(k)).checkins.length === 1; } catch (e) { return false; } }, PLAN_KEY);
      });
      check(`${label}: the page comes back from the back/forward cache`, cached);
      const rows = await a.evaluate((k) => JSON.parse(localStorage.getItem(k)).checkins[0].spend.length, PLAN_KEY);
      check(`${label}: it shows the check-in saved while it was away`,
        await until(b, (n) => document.querySelectorAll('input[data-scope="ci"][data-field="actual"]').length === n, rows));
      check(`${label}: and says it was updated`, await bannerHas(b, 'Updated from another window'));
      if (drop) {
        await b.click('[data-act="banner-close"]');
        await noUpdateShown('back again with nothing new shows no second update');
      }
      await b.locator(AMT).first().fill('2222');
      await pagehide(b);
      const st = JSON.parse(await rawPlan(a));
      check(`${label}: its next edit and pagehide keep the check-in`, st.checkins.length === 1, `${st.checkins.length} check-ins stored`);
      await ctx.close();
    }
  } finally {
    await bf.close();
  }
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
