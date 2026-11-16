'use strict';
// Smoke test: automates the "Testing a change" checklist in CLAUDE.md.
//
//   node tests/smoke.js [screenshot-dir]
//
// Serves the repo on a random local port and drives headless Chromium through:
// load, Google Fonts, service worker, saving an edit, export, import into a fresh
// profile, reload with the network off, and laptop/phone widths in light and dark.
// Exits non-zero if any check fails. Pass a directory to also save laptop/phone ×
// light/dark screenshots: legibility and layout still need a person to look.
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
const DATA_VERSION = 1; // Bump with the data model, and add a check that an older plan file still imports.
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;
const AMT = 'input[data-field="amt"]';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
};

const results = [];
const check = (name, ok, detail) => results.push({ status: ok ? 'PASS' : 'FAIL', name, detail: ok ? '' : detail });
const warn = (name, detail) => results.push({ status: 'WARN', name, detail });

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

// Collects uncaught errors, same-origin console errors and failed app files.
// Cross-origin failures (Google Fonts) are judged by the fonts check instead.
function watch(page, origin, label, errors) {
  page.on('pageerror', (e) => errors.push(`${label}: uncaught ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const src = m.location().url || '';
    if (src && !src.startsWith(origin)) return;
    errors.push(`${label}: console ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400) errors.push(`${label}: ${r.status()} ${r.url()}`);
  });
}

async function firstAmount(page) {
  const input = page.locator(AMT).first();
  return (await input.count()) ? input.inputValue() : null;
}

// lastSync, modifiedAt and touched are rewritten on import by design.
function withoutSyncFields(state) {
  const copy = JSON.parse(JSON.stringify(state));
  delete copy.lastSync; delete copy.modifiedAt; delete copy.touched;
  return copy;
}

async function run(browser, origin, tmp) {
  const url = origin + '/';
  const errors = [];

  // Laptop, light: load, fonts, service worker.
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', acceptDownloads: true });
  ctxA.setDefaultTimeout(10000);
  const a = await ctxA.newPage();
  watch(a, origin, 'laptop', errors);
  let fontsCss = 'no response';
  a.on('response', (r) => { if (r.url().startsWith('https://fonts.googleapis.com/')) fontsCss = r.status(); });
  await a.goto(url, { waitUntil: 'networkidle' });
  check('app renders its budget lines', (await a.locator(AMT).count()) > 0);

  if (fontsCss === 'no response') {
    warn('Google Fonts', 'fonts.googleapis.com unreachable from here; skipped');
  } else {
    await a.evaluate(() => document.fonts.ready);
    const loaded = await a.evaluate(() => {
      const fams = [];
      document.fonts.forEach((f) => { if (f.status === 'loaded') fams.push(f.family.replace(/["']/g, '')); });
      return fams;
    });
    const ok = fontsCss === 200 && loaded.includes('Bricolage Grotesque') && loaded.includes('Public Sans');
    check('Google Fonts load (Bricolage Grotesque, Public Sans)', ok, `stylesheet ${fontsCss}, loaded: ${loaded.join(', ') || 'none'}`);
  }

  // serviceWorker.ready never settles if registration fails, so give it a deadline.
  const swReady = await a.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]));
  if (swReady) await a.reload({ waitUntil: 'networkidle' });
  check('service worker controls the page', swReady && await a.evaluate(() => !!navigator.serviceWorker.controller));

  // Edit an amount and wait for the debounced save.
  await a.locator(AMT).first().fill('1234');
  const saved = await a.waitForFunction((k) => {
    try { return JSON.parse(localStorage.getItem(k)).touched === true; } catch (e) { return false; }
  }, PLAN_KEY, { timeout: 3000 }).then(() => true, () => false);
  check('an edit is saved to localStorage', saved);

  // Export.
  const [dl] = await Promise.all([a.waitForEvent('download'), a.locator('[data-act="export"]').first().click()]);
  const name = dl.suggestedFilename();
  const file = path.join(tmp, name);
  await dl.saveAs(file);
  const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('export is named budget-plan-YYYY-MM-DD.json', /^budget-plan-\d{4}-\d{2}-\d{2}\.json$/.test(name), name);
  check(`export has app, v=${DATA_VERSION}, exportedAt, exportedBy, state`,
    exp.app === APP_ID && exp.v === DATA_VERSION && !Number.isNaN(Date.parse(exp.exportedAt)) &&
    typeof exp.exportedBy === 'string' && !!exp.state && exp.state.v === DATA_VERSION,
    JSON.stringify({ app: exp.app, v: exp.v, exportedAt: exp.exportedAt, stateV: exp.state && exp.state.v }));

  // Import into a fresh profile.
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  ctxB.setDefaultTimeout(10000);
  const b = await ctxB.newPage();
  watch(b, origin, 'import', errors);
  await b.goto(url, { waitUntil: 'networkidle' });
  await b.setInputFiles('#import-file', file);
  const replace = b.locator('[data-act="import-confirm"]');
  const offered = await replace.waitFor({ timeout: 3000 }).then(() => true, () => false);
  if (offered) await replace.click();
  const stored = JSON.parse(await b.evaluate((k) => localStorage.getItem(k), PLAN_KEY));
  check('import into a fresh profile restores the plan',
    offered && isDeepStrictEqual(withoutSyncFields(stored), withoutSyncFields(exp.state)) && (await firstAmount(b)) === '1234',
    offered ? 'restored plan differs from the exported one' : 'the file was not accepted ("Replace plan" never appeared)');
  await ctxB.close();

  // Reload the first profile with the network off.
  await ctxA.setOffline(true);
  const reloaded = await a.reload({ waitUntil: 'load' }).then(() => true, () => false);
  check('opens offline, with the edit kept', reloaded && (await firstAmount(a)) === '1234');
  await ctxA.close();

  // Laptop and phone widths, light and dark.
  const background = {};
  for (const [label, width, height] of [['laptop', 1280, 900], ['phone', 390, 844]]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
      ctx.setDefaultTimeout(10000);
      const p = await ctx.newPage();
      watch(p, origin, `${label}-${scheme}`, errors);
      await p.goto(url, { waitUntil: 'networkidle' });
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${label} ${width}px ${scheme}: no horizontal scroll`, overflow <= 0, `${overflow}px too wide`);
      background[`${label}-${scheme}`] = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${label}-${scheme}.png`), fullPage: true });
      await ctx.close();
    }
  }
  check('dark theme applies', background['phone-light'] !== background['phone-dark'],
    `light ${background['phone-light']}, dark ${background['phone-dark']}`);

  check('no uncaught errors, console errors or failed app files', errors.length === 0, errors.join('\n      '));
}

(async () => {
  setTimeout(() => { console.error('FAIL  smoke test timed out after 2 minutes'); process.exit(1); }, 120000).unref();
  const server = await serve(ROOT);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-smoke-'));
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  try {
    await run(browser, origin, tmp);
  } catch (e) {
    check('smoke test ran to the end', false, e.message);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  for (const r of results) console.log(`${r.status}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
  if (SHOTS) console.log(`\nScreenshots in ${SHOTS}`);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exitCode = failed ? 1 : 0;
})();
