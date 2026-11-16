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
const DATA_VERSION = 1; // Bump with the data model, and add a check that an older plan file still imports.
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
