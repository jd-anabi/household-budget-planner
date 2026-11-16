# Categories, Check-in, Goals, Yearly Costs and Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Honeydue categories, a monthly check-in, goal dates with on-track status, a yearly-costs fund and an in-app tour to the budget planner, behind a v1→v2 data migration and a rollback guard.

**Architecture:** Everything stays in the single inline ES5 IIFE in `index.html`; new pure functions (month maths, projections, statuses, migration) are exposed on `window.__hbp` so the browser test can check them exactly. All new inputs live in the editor column; the side column stays read-only. `tests/smoke.js` becomes a sectioned Playwright runner.

**Tech Stack:** HTML/CSS/ES5 JavaScript (no build, no libraries), Playwright 1.63 + Node 22 for tests.

**Spec:** `docs/superpowers/specs/2026-11-16-categories-checkin-goals-tour-design.md` (read it with this plan; copy strings and sketches come from it).

## Global Constraints

- Plain ES5 inside the existing IIFE in `index.html`; inline CSS via `:root` tokens with light and dark values; no libraries, no build step, no new external loads.
- No new app files, so `sw.js` (`ASSETS`, `CACHE`) does not change.
- Data version 2: migrate v1 on load and on import, keep importing v1 files, never drop fields (unknown ones included).
- Storage keys: plan `household-budget-planner:plan:v1` (unchanged), backup `household-budget-planner:plan:v1-backup`, tour `household-budget-planner:tour-seen`.
- Inputs never in the side column (`renderSide()` rebuilds on every keystroke).
- Delegated events on `#root` with `data-scope`/`data-id`/`data-field` and `data-act`; value edits `changed(); refresh();`, structural edits re-render.
- Destructive actions use click-twice confirm, never `confirm()`/`prompt()`.
- 680px breakpoint, check 390px; visible focus; `prefers-reduced-motion` respected.
- Money shown with `money()` (whole dollars); shortfalls and "needs more" amounts use `Math.ceil`.
- Newer-version copy, exactly: `This plan was saved by a newer version of the app. Reload while online to update.`
- Example data stays generic; no network requests with user data.

## Review Focus

1. **Typing in a new input loses focus or caret** (category names, check-in actuals, balances): a person types "1250" and gets "1250" with the cursor still there. Tests in Tasks 3 and 4 type character by character and assert value and focus.
2. **Year rollover** (December → January in "previous month", goal dates, fund calendar): prevMonth of 15 Jan 2027 is `2026-12`. Tests in Tasks 2 and 6.
3. **History after the plan changes** (a category or the compared scenario is deleted): old check-ins still render from their snapshots. Test in Task 4.
4. **Blank versus zero actual**: clearing an actual means "not entered", typing 0 means "$0 spent". Test in Task 4.
5. **Long names on a phone**: a 60-character category name at 390px causes no horizontal scroll. Test in Task 3.

---

### Task 1: Rollback guard (still v1) and a sectioned test runner

**Files:**
- Modify: `index.html` (storage/load ~423–431, `persist` ~444, import handler ~936–953, `exportPlan` ~896)
- Modify: `tests/smoke.js` (restructure into sections)
- Create: `tests/fixtures/plan-v1.json`

**Interfaces:**
- Produces (index.html): `var DATA_V = 1;` `var NEWER_MSG = '<exact copy above>';` `var blocked = false;` `function tooNew(p) -> boolean` (true when `p` is an object with numeric `v > DATA_V`). While `blocked`: `persist()` does nothing; `exportPlan()` and `startImport()` only re-show the error banner.
- Produces (tests/smoke.js): `section(name, async fn)` registry run in order; `ONLY=a,b` env runs a subset; helpers `openPage(opts) -> Promise<{ctx, page}>` (navigates to `URL`, watches errors, 10 s timeout; `opts` = Playwright context options plus `storage: {key: value}` seeded by an init script **once per tab** (guarded by a `sessionStorage` flag, so reloads keep what the app saved) and `date: 'YYYY-MM-DDTHH:mm'` applied with `page.clock.setFixedTime` before navigation), `check`, `warn`, and constants `URL`, `APP_ID`, `PLAN_KEY`, `BACKUP_KEY`, `AMT`, `TMP` (a temp dir removed at exit), `FIXTURE_V1`, `DATA_VERSION`. Screenshot dir stays the first positional argument.

- [ ] **Step 1: Restructure `tests/smoke.js`** into sections `basics` (render, fonts, service worker), `roundtrip` (edit, export, import, offline), `layout` (widths × themes, dark applies, screenshots), with the global error check folded into each section's `check('… no errors')`. If `SAVE_EXPORT` is set, `roundtrip` copies the exported file there.
- [ ] **Step 2: Run** `node tests/smoke.js` → all PASS (behaviour unchanged).
- [ ] **Step 3: Create the fixture:** `SAVE_EXPORT=tests/fixtures/plan-v1.json ONLY=roundtrip node tests/smoke.js`, then confirm `jq '.v, .state.v, (.state.scenarios|length)' tests/fixtures/plan-v1.json` prints `1 1 2`.
- [ ] **Step 4: Write the failing `guard` section:**

```js
section('guard', async () => {
  const fx = JSON.parse(fs.readFileSync(FIXTURE_V1, 'utf8'));
  const newer = JSON.stringify(Object.assign({}, fx.state, { v: DATA_VERSION + 1 }));
  const { ctx, page } = await openPage({ storage: { [PLAN_KEY]: newer }, acceptDownloads: true });
  check('newer stored plan shows the newer-version banner', (await page.locator('#banner').innerText()).includes('newer version'));
  await page.locator(AMT).first().fill('999'); await page.waitForTimeout(800);
  check('newer stored plan is never overwritten', (await page.evaluate(k => localStorage.getItem(k), PLAN_KEY)) === newer);
  const dl = await Promise.all([page.waitForEvent('download', { timeout: 1500 }).then(() => true, () => false),
    page.locator('[data-act="export"]').first().click()]);
  check('export is blocked while a newer plan is stored', dl[0] === false);
  await ctx.close();
  // import of a newer file into a normal device
  const b = await openPage({});
  const f = path.join(TMP, 'newer.json');
  fs.writeFileSync(f, JSON.stringify({ app: APP_ID, v: DATA_VERSION + 1, state: JSON.parse(newer) }));
  await b.page.setInputFiles('#import-file', f);
  check('importing a newer file shows the newer-version message', (await b.page.locator('#banner').innerText()).includes('newer version'));
  await b.ctx.close();
});
```

- [ ] **Step 5: Run** `ONLY=guard node tests/smoke.js` → FAIL on all four checks.
- [ ] **Step 6: Implement** `DATA_V`, `NEWER_MSG`, `blocked`, `tooNew` and the guard: on load, a stored plan with `tooNew` sets `blocked = true`, shows the example plan with an error banner `NEWER_MSG`; on import, `tooNew(p) || tooNew(p && p.state)` shows the same message (instead of "isn't a budget plan file").
- [ ] **Step 7: Run** `node tests/smoke.js` → all PASS.
- [ ] **Step 8: Commit** `index.html tests/` as `Guard against overwriting a plan saved by a newer version`. Record this commit's SHA in the Task 8 notes (it is merged to `main` on its own first).

### Task 2: Data model v2, migration and example data

**Files:**
- Modify: `index.html` (constants, `defaults()`, `validPlan`, load, import, `exportPlan`, end of IIFE for the hook)
- Modify: `tests/smoke.js` (`DATA_VERSION = 2`, new `migration` section)

**Interfaces:**
- Consumes: Task 1 guard (`DATA_V` becomes 2, so the guard now trips on `v > 2`).
- Produces:
  - `var BACKUP_KEY = 'household-budget-planner:plan:v1-backup';`
  - Month helpers: `monthIndex('YYYY-MM') -> number` (`y*12 + m-1`), `monthKey(index) -> 'YYYY-MM'`, `thisMonth(date?) -> 'YYYY-MM'`, `prevMonth(date?) -> 'YYYY-MM'` (local time; `date` defaults to `new Date()`), `monthLabel(key) -> 'Oct 2026'`, `monthLong(key) -> 'October'`.
  - `migrate(p) -> object|null`: deep-copies; for `v === 1` adds `cats: []`, `checkins: []`, `fund: { acct: '', saved: 0 }`, need/want lines `cat: ''`, `due: 0`, goals `by: ''`, sets `v: 2`; never overwrites an existing value; returns `null` if the result fails `validPlan`.
  - `validPlan(p)`: `v === 2`, non-empty `scenarios` each with `lines`/`incomes` arrays, `accounts`, arrays `cats` and `checkins`, object `fund`.
  - Load: `tooNew` → blocked (Task 1); stored `v === 1` → write the raw stored string to `BACKUP_KEY` if empty, migrate, persist.
  - Export writes `v: DATA_V`.
  - `defaults()` v2 per spec §1: categories `Bills & utilities` (rent, utilities, internet, phone, insurance), `Groceries` (groceries), `Transportation` (gas/transit, car registration), `Eating out & fun` (dining, entertainment, subscriptions), `Personal` (health costs, personal care, shopping), `Gifts` (gifts & holidays); personal spending me/partner and buffer not in a category. Same category ids in both scenarios. `due`: car registration 3, gifts 12, others 0. Move-in fund `by` = `monthKey(monthIndex(thisMonth()) + 12)`. `fund: { acct: 'jsav', saved: 0 }`.
  - `window.__hbp = { migrate, validPlan, monthIndex, monthKey, thisMonth, prevMonth, state: function () { return state; } }` (later tasks add entries).

- [ ] **Step 1: Write the failing `migration` section:**

```js
section('migration', async () => {
  const fx = JSON.parse(fs.readFileSync(FIXTURE_V1, 'utf8'));
  const withExtra = Object.assign({}, fx, { state: Object.assign({}, fx.state, { extra: { a: 1 } }) });
  const f = path.join(TMP, 'v1.json'); fs.writeFileSync(f, JSON.stringify(withExtra));
  const { ctx, page } = await openPage({});
  await page.setInputFiles('#import-file', f); await page.locator('[data-act="import-confirm"]').click();
  const st = await page.evaluate(() => window.__hbp.state());
  check('v1 file imports as v2', st.v === 2 && st.cats.length === 0 && st.checkins.length === 0 && st.fund.acct === '' && st.fund.saved === 0);
  check('unknown fields are kept', isDeepStrictEqual(st.extra, { a: 1 }));
  const lines = s => s.scenarios.flatMap(x => x.lines);
  check('every v1 line keeps its fields', lines(fx.state).every((l, i) => ['id','g','name','amt','f','acct'].every(k => isDeepStrictEqual(lines(st)[i][k], l[k]))));
  check('need/want lines get cat and due', lines(st).filter(l => l.g !== 'save').every(l => l.cat === '' && l.due === 0));
  check('goals get an empty by', lines(st).filter(l => l.goal).every(l => l.goal.by === ''));
  await ctx.close();
  const raw = JSON.stringify(fx.state);
  const b = await openPage({ storage: { [PLAN_KEY]: raw } });
  check('stored v1 plan migrates on load', (await b.page.evaluate(k => JSON.parse(localStorage.getItem(k)).v, PLAN_KEY)) === 2);
  check('stored v1 plan is backed up', (await b.page.evaluate(k => localStorage.getItem(k), BACKUP_KEY)) === raw);
  const m = await b.page.evaluate(() => [window.__hbp.prevMonth(new Date(2027, 0, 15)), window.__hbp.monthKey(window.__hbp.monthIndex('2026-12') + 1)]);
  check('months roll over the year', m[0] === '2026-12' && m[1] === '2027-01');
  await b.ctx.close();
});
```

- [ ] **Step 2: Run** `ONLY=migration node tests/smoke.js` → FAIL (`__hbp` undefined).
- [ ] **Step 3: Implement** the Interfaces above; set `DATA_VERSION = 2` in the test.
- [ ] **Step 4: Run** `node tests/smoke.js` → all PASS, including `guard` (now with `v: 3`) and `roundtrip` (export `v: 2`).
- [ ] **Step 5: Commit** `Data model v2: migration, backup, example categories and fund`.

### Task 3: Categories

**Files:**
- Modify: `index.html` (`editorHTML`, `renderSide` Honeydue card, `honeydueText`, click/input handlers, CSS)
- Modify: `tests/smoke.js` (`categories` section)

**Interfaces:**
- Consumes: `state.cats`, `line.cat` (Task 2).
- Produces:
  - `catName(id) -> string`: `''` for no/missing category, `'Untitled category'` for an empty name.
  - `hdItems(s) -> [{ kind: 'cat'|'line', id, name, amt, lines: [line], note }]`: one item per category (sum of its lines' `monthly`) and per need/want line with no or a missing category; items with `amt < 0.5` dropped; sorted by `amt` descending; `note` = `'includes yearly costs at 1/12 a month; expect a spike in the month they\'re paid'` when the item has a yearly line (Task 6 adds the fund branch). Category items list only lines with `monthly ≥ 0.5`.
  - `honeydueText(s)`: one line per item, `Name: $X per month (line, line)` for categories, `Name: $X per month` for lines.
  - Editor card `categoriesHTML(s)` after Variable, before Accounts, `data-tour="categories"`: category name inputs `data-scope="cat" data-id=<id> data-field="name"`, totals `data-out="ct-<id>"`, delete `data-act="del-cat"` (click-twice via `pendingDeleteCat`), `data-act="add-cat"`; per need/want line a select `data-scope="line" data-id=<lineId> data-field="cat"` with every category plus `Not in a category` (`''`).
  - Side "Honeydue limits" card renders `hdItems`, category rows with line names in small text; note per spec §2.
  - `__hbp.honeydueText = function () { return honeydueText(scn()); }`.

- [ ] **Step 1: Write the failing `categories` section** (example plan, laptop):
  - The Honeydue table has a row starting `Bills & utilities` with `$360 / mo`.
  - Click the `Bills & utilities` name input, select all, `page.keyboard.type('House bills')`: input value is `House bills`, `document.activeElement` is that input, Honeydue row reads `House bills`.
  - Set Internet's category select to `''`: `House bills` shows `$300 / mo` and a separate `Internet` row `$60 / mo`.
  - `__hbp.honeydueText()` contains `House bills: $300 per month (Utilities (electric, gas, water), Phone, Insurance (car, renters))`.
  - Click `del-cat` for `Groceries` twice: a `Groceries & household supplies` row `$600 / mo` exists; no select offers `Groceries`.
  - At 390px, rename a category to 60 × `W`: `scrollWidth <= clientWidth`.
- [ ] **Step 2: Run** `ONLY=categories node tests/smoke.js` → FAIL.
- [ ] **Step 3: Implement** the Interfaces; the existing `change` handler already writes `l[f] = v` for `line` selects, so `cat` needs no new handler; add `cat` to the `input` handler (`state.cats` entry `name`).
- [ ] **Step 4: Run** `node tests/smoke.js` → all PASS.
- [ ] **Step 5: Commit** `Honeydue categories: group lines, per-category limits`.

### Task 4: Monthly check-in and the one-number goal balance

**Files:**
- Modify: `index.html` (new card first in `editorHTML`, `refresh`, `renderSummary`, goal "Saved so far" input, handlers, CSS)
- Modify: `tests/smoke.js` (`checkin` section)

**Interfaces:**
- Consumes: month helpers, `hdItems` grouping rules (Task 3), `catName`.
- Produces:
  - `spendRows(s, month) -> [{ key, name, planned, note }]`: one row per category (even planned 0), per uncategorised need/want line with planned ≥ 0.5, then `{ key: 'other', name: 'Anything else', planned: 0, note: '' }`. In this task yearly lines count `amt/12` (Task 6 replaces the rule).
  - `latestGoalEntry(line) -> { ci, row } | null`: newest check-in with a goal row whose `line === line.id`, else whose `name === line.name`.
  - `goalBalance(line) -> number` (entry `balance`, else `n(line.goal.saved)`); `setGoalBalance(line, v)` (entry: `balance = v, assumed = false`; else `goal.saved = v`). The editor's "Saved so far" input shows `goalBalance` and writes through `setGoalBalance`.
  - `checkinDue(now) -> { due, month, options }`: `due` when neither `prevMonth(now)` nor `thisMonth(now)` has a check-in; `options` = those two months that are later than the latest check-in; `month` = first option.
  - `startCheckin(month, scnId) -> CheckIn` (spec §1 shape; goal rows `start = goalBalance`, `months` = months since that goal's previous check-in or 1, `balance = start + planned × months`, `assumed: true`; `fund: null` until Task 6), inserted in month order.
  - `retakeCheckin(ci, scnId)`: re-snapshots names/planned/notes/targets, keeps actuals by `key`, keeps `start`/`months`, recomputes only assumed balances.
  - `checkinTotals(ci) -> { entered, rows, planned, actual }` over rows with `actual !== null`.
  - Card `checkinHTML()` with `data-tour="checkin"`; view state `ciView` (month or null = latest). Inputs: actual `data-scope="ci" data-field="actual" data-id=<key>` (empty string → `null`), goal balance `data-scope="cig" data-field="balance" data-id=<lineId>`, compared scenario select `data-scope="ci" data-field="scn"` (latest only), month select `#ci-month`. Acts: `ci-start`, `ci-view` (`data-id` month), `ci-del` (click twice), `ci-retake`. Outputs via `data-out`: `cid-<key>`, `ci-total`, `ci-acct-<acct>`.
  - Summary: chip `<Month> check-in not done` (`--warn`) while `checkinDue(now).due`.
  - `__hbp.spendRows = function (m) { return spendRows(scn(), m); }`.

- [ ] **Step 1: Write the failing `checkin` section** (`date: '2026-11-16T12:00'`):
  - Card heading contains `October check-in`; summary contains `October check-in not done`.
  - Start: 10 spend rows (6 categories + 3 uncategorised + Anything else); goal balances 700, 300, 400; three `assumed from plan` labels.
  - Type `125` into the first actual with `keyboard.type`: value `125`, focus kept (Review Focus 1).
  - Label shows `1 of 10 entered`; type `0` into the second → `2 of 10`; clear it → `1 of 10` (Review Focus 4).
  - Set Emergency fund balance to `650`; reload; balance input `650`; editor "Saved so far" for Emergency fund `650`; summary chip gone.
  - Same page: `page.clock.setFixedTime(new Date('2026-12-05T12:00'))`, reload: heading `November check-in`; start; Emergency fund balance `1350`. `ci-del` twice → "Saved so far" back to `650`.
  - Delete category `Groceries` (twice) and the `Now` scenario (twice); open October via `ci-view`: a row named `Groceries` and the text `Now` are shown; no page errors (Review Focus 3).
- [ ] **Step 2: Run** `ONLY=checkin node tests/smoke.js` → FAIL.
- [ ] **Step 3: Implement** the Interfaces. The check-in card is in the editor column, so its inputs survive `refresh()`; update only `data-out` outputs on value edits.
- [ ] **Step 4: Run** `node tests/smoke.js` → all PASS.
- [ ] **Step 5: Commit** `Monthly check-in with one stored balance per goal`.

### Task 5: Goal dates and on-track status

**Files:**
- Modify: `index.html` (`goalHTML`, `goalInfo`/side goals card, check-in goal rows, change handler, CSS)
- Modify: `tests/smoke.js` (`goals` section)

**Interfaces:**
- Consumes: `latestGoalEntry`, `goalBalance`, month helpers.
- Produces:
  - `dateStatus(G, B, s, base, by) -> { tone, text, sub }` and `paceStatus(B, E) -> { tone, text }`, pure, per spec §4. Texts: `Reached`; `Date passed, $X short`; `On track for Mon YYYY`; `Needs $X/mo more to make Mon YYYY` with `sub` `At $S a month: Mon YYYY` when `s > 0`; `On track`; `$X behind plan`.
  - `goalStatus(line, s, c) -> { tone, text, sub, assumed } | null`: base month/balance per spec §4; `E` from the goal's check-in rows (`start` of the first + Σ `planned × months`); `assumed` when the latest entry is assumed (chip text gains ` (assumed)`); `sub` gains `Target changed from $X to $Y` when a months-goal's target differs from the latest entry's `target`.
  - Goal row: `By` with month select `#gbm-<id>` and year select `#gby-<id>` (`—` = none; years this year … +10), both `data-scope="goal" data-field="by"`; the change handler composes `goal.by` (`''` unless both set).
  - Chips in the side Savings goals card and on check-in goal rows.
  - `__hbp.dateStatus`, `__hbp.paceStatus`.

- [ ] **Step 1: Write the failing `goals` section:**

```js
const r = await page.evaluate(() => { const h = window.__hbp; return [
  h.dateStatus(6000, 0, 400, '2026-10', '2027-06'), h.dateStatus(6000, 0, 400, '2026-10', '2028-02'),
  h.dateStatus(6000, 0, 400, '2026-10', '2026-09'), h.dateStatus(6000, 6000, 400, '2026-10', '2027-06'),
  h.paceStatus(600, 700), h.paceStatus(700, 700)]; });
check('date: behind', r[0].text === 'Needs $350/mo more to make Jun 2027' && r[0].sub === 'At $400 a month: Jan 2028' && r[0].tone === 'warn');
check('date: on track', r[1].text === 'On track for Feb 2028' && r[1].tone === 'ok');
check('date: passed', r[2].text === 'Date passed, $6,000 short' && r[2].tone === 'bad');
check('reached', r[3].text === 'Reached');
check('pace: behind', r[4].text === '$100 behind plan' && r[4].tone === 'warn');
check('pace: on track', r[5].text === 'On track');
```
  Plus UI (`date: '2026-11-16T12:00'`): set Move-in fund to Jun 2027 → its side chip reads `Needs $350/mo more to make Jun 2027`; start an October check-in → its Move-in row chip ends with `(assumed)`.
- [ ] **Step 2: Run** `ONLY=goals node tests/smoke.js` → FAIL.
- [ ] **Step 3: Implement** the Interfaces.
- [ ] **Step 4: Run** `node tests/smoke.js` → all PASS.
- [ ] **Step 5: Commit** `Goal dates and on-track status`.

### Task 6: Yearly costs fund

**Files:**
- Modify: `index.html` (`calc`, `transfers`/`stepsHTML`, `hdItems`, `honeydueText`, `spendRows`, `startCheckin`/`retakeCheckin`, side goals card, new editor card, handlers, CSS)
- Modify: `tests/smoke.js` (`yearly` section)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `isYearly(l)` (need/want with `f === 'yr'`), `fundOn()` (`!!state.fund.acct`), `fundMonthly(s) -> c` (Σ `amt/12` of yearly lines).
  - `projectFund(B, base, c, bills) -> { months: [{ key, bills: [{ name, amt, acct }], F }], S, minKey }`, pure, per spec §5 (`bills` items `{ name, amt, due, acct }`; `months` lists only months with dated bills; `S = max(0, −min F_k)` over all 12 months; `minKey` = first month at the minimum, `''` when `S = 0`).
  - `fundBalance() -> { balance, month }` and `setFundBalance(v)`, same one-number rule as goals.
  - `calc(s)` adds `c.fund` and, when `fundOn()`, routes yearly lines' monthly to `by[state.fund.acct]`; group totals unchanged. `stepsHTML` adds `yearly costs fund $X` to that account's parts.
  - `spendRows` rule from spec §3 (due month → full amount, other months → 0, `due 0` → `amt/12`) and `note` text `includes <name>, $<amt>, due this month` / `includes irregular yearly costs at 1/12 a month`.
  - `hdItems`: with the fund on, yearly lines excluded; the Honeydue card note and `honeydueText` end with the spec §2 sentence listing them as `<name> $<amt> (<Mon>)` (`(spread)` for due 0).
  - `startCheckin` adds the `fund` row when on (spec §5); `retakeCheckin` re-takes `planned`/`due` and recomputes an assumed balance.
  - Editor card `yearlyHTML(s)` after Categories, `data-tour="yearly"`, per spec §5 sketch: `data-scope="fund" data-field="acct"` select (savings accounts + `Don't set money aside`), `data-scope="fund" data-field="balance"` input, per yearly line `data-scope="line" data-field="due"` select (`Spread through the year` = 0, Jan…Dec = 1…12; stored as a number), calendar and status as `data-out` outputs.
  - Side Savings goals card: first row `Yearly costs fund` with balance and status chip when on.
  - `__hbp.projectFund`.

- [ ] **Step 1: Write the failing `yearly` section** (`date: '2026-11-16T12:00'`, example plan):

```js
const bills = [{ name: 'Car', amt: 600, due: 3 }, { name: 'Gifts', amt: 800, due: 12 }];
const p = await page.evaluate(b => [window.__hbp.projectFund(0, '2026-10', 1400 / 12, b), window.__hbp.projectFund(117, '2026-10', 1400 / 12, b)], bills);
check('fund: first-year shortfall', Math.abs(p[0].S - 816.67) < 0.01 && p[0].minKey === '2027-03' &&
  p[0].months.map(m => m.key).join() === '2026-12,2027-03' && Math.abs(p[0].months[0].F + 566.67) < 0.01);
check('fund: with a balance', Math.abs(p[1].S - 699.67) < 0.01);
```
  Plus UI:
  - Transfer step `Move to Joint savings` shows `$1,217` and its parts include `yearly costs fund $117`.
  - Yearly card text includes `Short $817 by Mar 2027`, `Dec 2026` with `−$567`, `Mar 2027` with `−$817`.
  - Honeydue: `Transportation` row `$150 / mo`; no `Gifts` row; note includes `Car registration & maintenance $600 (Mar)` and `Gifts & holidays $800 (Dec)`.
  - `__hbp.spendRows('2027-03')` Transportation planned `750`; `('2027-04')` → `150`.
  - Start October check-in: fund row balance `117` with `assumed from plan`; reconciliation text includes `Joint savings holds $1,217`.
  - Choose `Don't set money aside`: steps show Joint checking `$2,127` and Joint savings `$1,100`; Honeydue `Transportation` `$200 / mo` with the `includes yearly costs at 1/12` note.
- [ ] **Step 2: Run** `ONLY=yearly node tests/smoke.js` → FAIL.
- [ ] **Step 3: Implement** the Interfaces.
- [ ] **Step 4: Run** `node tests/smoke.js` → all PASS (update earlier sections' expectations only where the fund legitimately changes them, e.g. Transportation totals; note each such change in the commit message).
- [ ] **Step 5: Commit** `Yearly costs fund with due months and a 12-month projection`.

### Task 7: Tour

**Files:**
- Modify: `index.html` (`data-tour` attributes on every card, header button, banner kind, tour overlay + caption, keyboard handling, CSS tokens `--dim`, `--spot` in both themes)
- Modify: `tests/smoke.js` (`tour` section)

**Interfaces:**
- Consumes: `data-tour` values `scenarios`, `summary`, `checkin`, `income`, `need`, `save`, `want`, `categories`, `yearly`, `accounts`, `transfers`, `goals`, `honeydue`, `compare`, `sharing`.
- Produces: `TOUR_KEY`; `TOUR` (17 steps per spec §6, first and last with `sel: null`); `startTour()`, `showStep(i)`, `endTour()`; header button `#tour-btn` `data-act="tour"`; first-open banner kind `tour` with `data-act="tour-start"` / `data-act="tour-later"` (both set `TOUR_KEY`; any other banner, import or error, wins and the tour offer waits for the next open). Caption `#tour` with `role="dialog"`, `aria-modal="true"`, `aria-labelledby="tour-title"`, counter `n of N`, buttons Back/Next (Finish on the last)/Close; Esc closes; ArrowLeft/ArrowRight navigate; Tab cycles inside; focus returns to `#tour-btn` on close. Steps whose target is missing are skipped; the overlay never changes plan data.

- [ ] **Step 1: Write the failing `tour` section:**
  - Fresh profile: banner contains `New here? Take a 2-minute tour`; click `tour-later`, reload: banner gone.
  - Click `#tour-btn`: `#tour` visible with `1 of 17`. Press ArrowRight through every step; on each step with a target, the target's rect top is within `[0, innerHeight)` and the spotlight box overlaps it. Last step shows `Finish`; click it: `#tour` hidden, `document.activeElement.id === 'tour-btn'`.
  - Restart, press Tab 6 times: focus stays inside `#tour`; Escape closes it.
  - At 390px with `reducedMotion: 'reduce'`: run to the end; `#tour` width ≤ viewport width; no horizontal scroll; no page errors.
- [ ] **Step 2: Run** `ONLY=tour node tests/smoke.js` → FAIL.
- [ ] **Step 3: Implement** the Interfaces and the step copy (two or three sentences each: what the part shows, what to do with it).
- [ ] **Step 4: Run** `node tests/smoke.js <shots-dir>` → all PASS; take one extra phone screenshot mid-tour into the same directory.
- [ ] **Step 5: Commit** `In-app tour of the planner`.

### Task 8: Docs, review and release

**Files:**
- Modify: `CLAUDE.md`, `README.md`
- Create: `.nojekyll` (empty; GitHub Pages then serves the repo as plain files, so Markdown in `docs/` can never break a deploy)

- [ ] **Step 1: Update docs:** CLAUDE.md data model to v2 (spec §1 block, the backup and tour keys, the guard, `window.__hbp` as test hooks), the new cards in "How the UI code works", feature ideas 1, 3 and 4 marked done, testing note (`ONLY=…`). README feature list: categories, monthly check-in, goal dates, yearly costs, tour.
- [ ] **Step 2: Full run:** `node tests/smoke.js <shots-dir>` → `All checks passed`. Look at every screenshot (laptop/phone × light/dark, mid-tour) for legibility and layout.
- [ ] **Step 3: Whole-branch review:** a fresh reviewer reads the diff from the pre-guard commit against the spec and this plan; fix confirmed findings with tests; re-run Step 2.
- [ ] **Step 4: Release in two merges** so a rollback of the features keeps the guard: `git checkout main && git pull --ff-only`, `git merge --no-ff <guard SHA>` then push; `git merge --no-ff claude/cloud-environment-setup-9rneod` then push. Confirm the GitHub Pages build for the final `main` commit succeeded (Actions: "pages build and deployment").
