# People, accounts, "items" and one generic example: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Data model v3. The household's people have names, accounts are a list owned by Shared
or by a person, each income says whose it is and where it lands, the payday plan handles pooled
and separate pay, there is one generic example scenario, and the screen says "item", never "line".

**Architecture:** Everything stays in the IIFE in `index.html`. The account constants
(`ACCT_ORDER`, `SPEND_ACCTS`, `SAVE_ACCTS`, `ACCT_COLOR`) become helpers that read
`state.accounts` / `state.acctOrder`. Pooled pay keeps today's `transfers()`. Separate pay adds
`weights()` and `splitPlan()`, which implement the spec's §5 maths. Tests stay in `tests/smoke.js`.
Sections that relied on the old example now load it as a stored v2 plan, so they also prove that
an upgraded plan behaves as before.

**Tech Stack:** Plain ES5 JavaScript, inline CSS tokens, Playwright smoke test (`node tests/smoke.js`).

**Spec:** `docs/superpowers/specs/2026-11-18-people-and-accounts-design.md` (approved 2026-11-18).
Section numbers below (§1 to §11) refer to it.

## Global Constraints

- Plain ES5-style JavaScript inside the existing IIFE in `index.html`. Inline CSS through the existing tokens, legible in both themes. No libraries, no build step, no new external loads.
- No new app files, so `sw.js` `ASSETS` and `CACHE` don't change. Fixtures under `tests/` are not app files.
- `DATA_V = 3`. `migrate()` upgrades v1 and v2 on load and on import, and keeps every field, unknown ones included. A plan with `v > 3` is never saved over.
- Storage key `household-budget-planner:plan:v1` is unchanged. Upgrade backups go to `household-budget-planner:plan:v{k}-backup` (k = 1 or 2), written only if empty. An unreadable value still goes to the `v1-backup` key.
- Inputs live only in the editor column. The side column is rebuilt by `refresh()` and stays read-only.
- Events are delegated on `#root`: inputs carry `data-scope` / `data-id` / `data-field`, buttons carry `data-act`. Value edits call `changed()` then `refresh()`; structural edits call `rerenderEditor(focusId)`.
- Renaming a person or an account never costs the focused input its focus.
- Destructive actions use click-twice, never `confirm()`.
- Phone breakpoint 680px, checked at 390px. Visible focus states. Respect `prefers-reduced-motion`.
- Privacy: the example stays generic, and no real names or numbers are committed.
- On screen: "item", never "line". In data and code: the `lines` field, `data-scope="line"` and `'line:' + id` check-in keys stay as they are.
- Thresholds: an income is *active* if `amt` ≥ 0.5. A transfer is shown if > 0.5. A shortfall is shown if $L_p < -0.5$. An unfunded account is flagged if its items total > 0.5.
- Fixed copy (exact). Apostrophes are ’ (U+2019), as elsewhere in the app:
  - "Shared"; "Person N" for an empty name; "Deleted account" for a missing account.
  - "New checking", "New savings"; "+ Add spending account", "+ Add savings account"; "+ Add person"; "Take-home pay".
  - Banner: "New: add the people in your household. Accounts and pay now say whose they are." with buttons "Go to People" and "Dismiss".
  - Split control: "Split shared costs", options "In proportion to take-home", "Equally", "Set percentages"; note "Shares are scaled to add up to 100%".
  - Per-person heading: "&lt;Name&gt;’s pay · $I into &lt;label&gt;".
  - Shortfall: "&lt;Name&gt;’s share is $X more than &lt;Name&gt;’s pay. Lower some amounts or change the split."
  - Unfunded: "Nobody’s pay covers &lt;label&gt; ($X): &lt;Name&gt; has no take-home in this scenario. Move those items to a shared account, or add &lt;Name&gt;’s pay."
  - Example: scenario `sub` "Example numbers: replace them with yours"; device placeholder "e.g. Alex".

## Review Focus

1. **Names with markup or left empty.** A person named `<u>x</u>` shows literally in labels, optgroup labels and selects. An empty name shows as "Person N". (Test in Task 4.)
2. **Custom percentages blank or all zero.** The split falls back to *equally*, and no NaN or Infinity appears anywhere. (Test in Task 6.)
3. **Dangling references in an older or hand-edited file.** An income whose `to` isn't a spending account lands in the first spending account. An account whose owner doesn't exist is listed under Shared. No console errors either way. (Tests in Tasks 3 and 5.)
4. **A check-in naming an account that was later removed** shows "Deleted account", never a raw id. (Test in Task 3.)
5. **Removing the only earner of a separate scenario.** Their pay moves to the first remaining person, income totals don't change, and nothing shows NaN. (Test in Task 6.)

---

### Task 1: Pin the old example as a v2 fixture for the existing tests

The app is unchanged in this task. It makes later example changes safe and gives the migration tests their v2 input.

**Files:**
- Create: `tests/fixtures/plan-v2.json`
- Modify: `tests/smoke.js` (constants near line 28; sections categories, checkin, goals, yearly, retake, focus, resets, first-checkin, scenarios, two-windows, bfcache)

**Interfaces:**
- Produces (in `tests/smoke.js`):
  - `FIXTURE_V2` (path)
  - `oldPlan()`: returns a fresh copy of the fixture's `state`
  - `OLD()`: returns `{ [PLAN_KEY]: JSON.stringify(oldPlan()) }`, for `openPage({ storage: OLD(), … })`

- [ ] **Step 1: Generate the fixture from the current (v2) app**

Run from the repo root, with the clock fixed so the example's dated goal is `2027-11` and the ids are stable:

```bash
node -e "
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route('**/*', (r) => r.request().url() === 'http://fixture.test/' ? r.fulfill({ path: 'index.html', contentType: 'text/html' }) : r.abort());
  await p.clock.setFixedTime(new Date('2026-11-16T12:00'));
  await p.goto('http://fixture.test/', { waitUntil: 'load' });
  const state = await p.evaluate(() => window.__hbp.state());
  fs.writeFileSync('tests/fixtures/plan-v2.json', JSON.stringify({ app: 'household-budget-planner', v: 2, exportedAt: '2026-11-16T20:00:00.000Z', exportedBy: '', state }, null, 2) + '\n');
  await b.close();
})();"
```

Expected: the file exists, `state.v === 2`, `state.touched === false`, scenarios `now` and `later`,
six categories, `fund.acct === 'jsav'`, and the Move-in fund has `goal.by === '2027-11'`.

- [ ] **Step 2: Seed the old example in the example-dependent sections**

Add `FIXTURE_V2`, `oldPlan()` and `OLD()`. Pass `storage: OLD()` to every `openPage` call in the
sections categories (both pages), checkin, goals, yearly (both pages), retake (both), focus,
resets (`viewingOctober`), first-checkin and scenarios (all pages). Leave basics, roundtrip,
layout, guard, migration, tour and import-safety on the default page.

- [ ] **Step 3: Make two-windows and bfcache independent of the example's row count**

Replace the literal `10` in "the other window shows it without a reload" and "it shows the
check-in saved while it was away". Read the expected count from the stored check-in in the
window that started it:

```js
const rows = await a.evaluate((k) => JSON.parse(localStorage.getItem(k)).checkins[0].spend.length, PLAN_KEY);
await until(b, (n) => document.querySelectorAll('input[data-scope="ci"][data-field="actual"]').length === n, rows);
```

(Use `w.a` / `w.b` in two-windows.)

- [ ] **Step 4: Run the whole suite**

Run: `node tests/smoke.js`
Expected: `All checks passed` (the same checks as before, now on the seeded plan).

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/plan-v2.json tests/smoke.js
git commit -m "Tests: pin the old example as a v2 fixture for example-dependent sections"
```

---

### Task 2: Data model v3, migration, validation and backups

The app's screens don't change yet. Every plan is v3 in memory and in storage. `defaults()`
temporarily returns the old example upgraded to v3.

**Files:**
- Modify: `index.html`:
  - constants (`DATA_V`, backup key) near lines 406–411
  - `example()` / `defaults()` 444–547
  - `validShape` / `validDeep` / `validPlan` / `migrate` / `readStored` 553–628
  - `new-scn` handler ~1893
  - `window.__hbp` ~2077
- Modify: `tests/smoke.js`: `DATA_VERSION`, sections migration, guard, import-safety
- Modify: `CLAUDE.md`: the "Data model" section

**Interfaces:**
- Produces:
  - `DATA_V = 3`
  - `backupKey(k) -> 'household-budget-planner:plan:v' + k + '-backup'`
  - `migrate(p) -> v3 plan | null`. It chains a private `v1to2(q)` (today's step) and `v2to3(q)` (spec §8).
  - `validPlan(p) -> bool`, for v3, with the spec §1 "Validation" rules. Keep today's v2 check as `validV2(p)`, which `migrate` uses between steps.
  - `readStored(raw) -> { plan, newer, upgraded, from }`, where `from` is the stored `v` when upgraded, else 0
  - `defaults()`, which returns a v3 plan. For now it is the old example passed through `migrate`.
  - `window.__hbp.transfers(scnId) -> transfers(s, calc(s))` for that scenario (default: active)

- [ ] **Step 1: Write the failing tests**

In `tests/smoke.js`:
- set `DATA_VERSION = 3`;
- add `const backupKey = (k) => \`household-budget-planner:plan:v${k}-backup\``;
- keep `BACKUP_KEY` = `backupKey(1)`.

In section **migration**, replace "v1 file imports as v2" with the checks below. Add a helper
`v3shape(st, src)` that returns an array of failure strings (empty = pass), so the check can
print the failures in its detail:

```js
const pid = st.people[0] && st.people[0].id;
check('upgrade adds one placeholder person', st.people.length === 1 && st.people[0].name === 'Person 1');
check('the five accounts get kinds and owners',
  ['jchk','mchk'].every((a) => st.accounts[a].kind === 'spend') && ['jsav','msav','inv'].every((a) => st.accounts[a].kind === 'save') &&
  st.accounts.mchk.owner === pid && st.accounts.msav.owner === pid && ['jchk','jsav','inv'].every((a) => st.accounts[a].owner === ''));
check('acctOrder lists the five accounts', st.acctOrder.join() === 'jchk,mchk,jsav,msav,inv');
check('every income is Person 1’s and lands where the scenario deposited it',
  st.scenarios.every((s, i) => s.incomes.every((x) => x.who === pid && x.to === src.scenarios[i].depositTo)));
check('every scenario splits by take-home', st.scenarios.every((s) => s.split.mode === 'income' && isDeepStrictEqual(s.split.pct, {})));
```

Run them for the v1 fixture import (keep the existing line/cat/goal checks, with `st.v === 3`)
and for a new v2 import of `FIXTURE_V2` with an `extra: { a: 1 }` field. For v2, also check
"everything else is unchanged": delete the added fields from `st` (`people`, `acctOrder`,
`accounts[*].kind/owner`, `incomes[*].who/to`, `scenarios[*].split`), plus `v`, `lastSync`,
`modifiedAt`, `touched` from both sides. Then require `isDeepStrictEqual` with the fixture state.

Load path:
- stored v2 (`JSON.stringify(oldPlan())`): stored `v` becomes 3, and `backupKey(2)` holds the raw string;
- stored v1 keeps its existing checks, with `v` 3 and `backupKey(1)`.

**Equivalence** (new check in migration, on the stored-v2 page). For each scenario, compute the
v2 rule in the test:
- `by[a]` = Σ monthly(l) by `l.acct`, except yearly need/want lines go to `fund.acct` while it's
  set; monthly = `amt × {mo:1, wk:52/12, yr:1/12}[f]`;
- land = `depositTo`;
- items = `['jchk','mchk','jsav','msav','inv']` minus land, with `by[a] > 0.5`;
- keep = I − Σ items.

Then require every item amount to be within `1e-9` of `window.__hbp.transfers(id)`, and the same for keep:

```js
check(`an upgraded scenario’s payday plan is unchanged (${id})`, sameItems && Math.abs(t.keep - expKeep) < 1e-9, JSON.stringify({ t, exp }));
```

Example check: `ex.v === 3` (otherwise as today).

In **guard**, nothing changes in the code (it already uses `DATA_VERSION + 1`, now 4).

In **import-safety**, write the file with `v: DATA_VERSION` and add refused variants:

```js
'no people':               variant((st) => { st.people = []; }),
'person id with markup':   variant((st) => { st.people[0].id = 'x"><b>'; }),
'account id with markup':  variant((st) => { st.accounts['x"><b>'] = { name: 'X', note: '', kind: 'spend', owner: '' }; st.acctOrder.push('x"><b>'); }),
'acctOrder names a missing account': variant((st) => { st.acctOrder.push('nope'); }),
'no savings account':      variant((st) => { const sv = Object.keys(st.accounts).filter((a) => st.accounts[a].kind === 'save');
                             sv.forEach((a) => { delete st.accounts[a]; }); st.acctOrder = st.acctOrder.filter((a) => !sv.includes(a)); st.fund.acct = ''; }),
'unknown split mode':      variant((st) => { st.scenarios[0].split.mode = 'half'; }),
```

The "stored plan the app cannot read" check keeps `BACKUP_KEY` (v1 key).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `ONLY=migration,guard,import-safety,roundtrip node tests/smoke.js`
Expected: FAIL (export has v=2, the upgrade fields are missing).

- [ ] **Step 3: Implement v3 in `index.html`**

- `migrate(p)`:
  - v1 → `v1to2` (today's code) → `validV2` or null;
  - v2 → `v2to3`, exactly as spec §8: `people = [{ id: nid(), name: 'Person 1' }]`; missing v2 accounts created as `{ name: id, note: '' }`; kinds and owners; `acctOrder`; income `who` / `to` (`to` = `depositTo` if it is `jchk` or `mchk`, else `jchk`); `split = { mode: 'income', pct: {} }`; `v = 3`;
  - then `validPlan` or null.
- `readStored`:
  - migrate any `p.v < DATA_V`;
  - back up an upgraded raw to `backupKey(p.v)` if empty, and an unreadable raw to `backupKey(1)` if empty;
  - return `from`.
- `validPlan`: spec §1 "Validation". Every id that reaches HTML passes `okId`: people ids, account keys in `acctOrder`, income `who` and `to`, and `split.pct` keys. `fund.acct` is `''` or a key of `accounts` with kind `save`.
- `defaults()` returns `migrate(<today's defaults() body>)`.
- `new-scn` adds `split: { mode: 'income', pct: {} }`.
- `__hbp.transfers`.

- [ ] **Step 4: Run the whole suite**

Run: `node tests/smoke.js`
Expected: `All checks passed`.

- [ ] **Step 5: Update CLAUDE.md "Data model"**

Change it to `state` v3: the new fields with one-line meanings, `migrate()` v1→v2→v3, the backup
key per version, and `DATA_V = 3`. Keep the rest of the section.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js CLAUDE.md
git commit -m "Data model v3: people, account kinds and owners, income who/to, split; migrate v1 and v2"
```

---

### Task 3: Accounts as a list (helpers, labels, grouped menus, Accounts card)

**Files:**
- Modify: `index.html`:
  - remove the constants at 418–421;
  - `optionList` ~1100;
  - item rows, the deposit select and the Accounts card in `editorHTML` 1107–1158;
  - the fund select in `yearlyHTML` ~1231;
  - every `acctName` display site (goal tags, Honeydue tag, check-in tags and recon, `flowSVG`, `stepsHTML`, fund calendar);
  - `transfers()` ~992;
  - `add-line` ~1856;
  - input/change/click handlers;
  - CSS for `.acct-group`
- Modify: `tests/smoke.js`: new section `accounts`

**Interfaces:**
- Consumes: v3 state from Task 2.
- Produces:
  - `findPerson(id) -> {id, name} | null`
  - `personName(id) -> string`: trimmed name, or `'Person ' + (index + 1)` when empty
  - `ownerOf(a) -> personId | ''`: `''` when Shared or when the owner doesn't exist
  - `acctIds() -> [id]`: `acctOrder` entries present in `accounts`
  - `acctsOfKind(kind) -> [id]`
  - `isKind(a, kind) -> bool`
  - `acctName(a) -> string`: the typed name, or `'Deleted account'` when missing
  - `acctLabel(a) -> string`: `acctName(a)`, plus `' · ' + personName(owner)` when owned and the name doesn't already contain that person's name (case-insensitive)
  - `acctOptions(kind, sel) -> html`: `<optgroup label="Shared">` first, then one `<optgroup label="<name>" data-person="<id>">` per person who owns accounts of that kind; options are account names; if `sel` isn't in the list, a leading selected `<option value="sel">` labelled `acctLabel(sel)`
  - `acctColor(a) -> css`: spending accounts cycle `var(--need)`, `var(--ink-3)`; savings accounts cycle `var(--save)`, `var(--save-2)`, `var(--save-3)`, by index within the kind (so the five v2 ids keep today's colours)
  - `acctUses(a) -> number`: items in all scenarios with `acct === a`, plus incomes in all scenarios with `to === a`, plus 1 if `fund.acct === a`
  - `canDeleteAcct(a) -> bool`: `acctUses(a) === 0` and more than one account of its kind
  - Element ids:
    - `#an-<id>` (name, existing), `#ao-<id>` (note, existing);
    - `#aw-<id>`: owner select, `data-scope="acct" data-field="owner"`;
    - `[data-act="del-acct"][data-id]`, armed state in `pendingDeleteAcct`;
    - `[data-act="add-acct"][data-kind="spend|save"]`;
    - group headings `.acct-group h3`;
    - every account label rendered in the editor column is `<span data-acct-label="<id>">`, and `refresh()` resets their text to `acctLabel(id)`

- [ ] **Step 1: Write the failing test (section `accounts`)**

On `openPage({ storage: OLD(), date: '2026-11-16T12:00' })`:

```js
check('accounts are grouped by owner', groups.join() === 'Shared,Person 1', groups.join());
check('a savings item offers savings accounts grouped by owner', og.join() === 'Shared:jsav+inv,Person 1:msav', og.join()); // og from `#c-<Emergency fund id> optgroup`
check('the fund can only go to a savings account', (await values(page, '#fund-acct option')).join() === ',jsav,inv,msav');
check('an account in use has no ×', (await page.locator('[data-act="del-acct"][data-id="jchk"]').count()) === 0 && (await cardText(page, 'accounts')).includes('used by'));
// + Add spending account
check('"+ Add spending account" adds a shared spending account and focuses its name',
  acct.kind === 'spend' && acct.owner === '' && acct.name === 'New checking' && active === `an-${id}`);
// click × twice
check('an unused account is removed with two clicks', !s.accounts[id] && !s.acctOrder.includes(id));
// selectOption('#aw-jsav', <Person 1 id>)
check('a new owner shows in the payday plan', (await stepText(page, 'Joint savings · Person 1')) !== '');
// Review Focus 4: start the October check-in; move "Fun & vacation" to jsav in both tabs (now, later);
// remove msav (now unused) with two clicks
check('a check-in naming a removed account says "Deleted account"', (await cardText(page, 'checkin')).includes('Deleted account'));
```

On a minimal seeded plan `minPlan()`:
- one person `{id:'p1', name:'Solo'}`;
- accounts `c` (spend, Shared, "Checking") and `s` (save, Shared, "Savings"), `acctOrder: ['c','s']`;
- `fund: {acct:'', saved:0}`, `cats: []`, `checkins: []`;
- one scenario `{id:'m', name:'Mine', sub:'', depositTo:'c', split:{mode:'income',pct:{}}, incomes:[], lines:[]}`, `active: 'm'`, `v: 3`, `touched: true`.

```js
check('the last spending and the last savings account cannot be removed', (await m.page.locator('[data-act="del-acct"]').count()) === 0);
```

Review Focus 3, on `minPlan()` with `accounts.s.owner = 'ghost'`:

```js
check('an account whose owner is gone is listed as shared', groups.join() === 'Shared');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `ONLY=accounts node tests/smoke.js`
Expected: FAIL (no `#aw-jsav`, no optgroups).

- [ ] **Step 3: Implement the helpers and replace every use of the old constants**

- Item rows use `acctOptions(G.key === 'save' ? 'save' : 'spend', l.acct)`.
- The deposit select uses `acctOptions('spend', s.depositTo)`; Task 5 removes it.
- The fund select is "Don't set money aside" plus `acctOptions('save', state.fund.acct)`.
- `transfers()` iterates `acctIds()`.
- `flowSVG` uses `acctColor`.
- Display sites use `acctLabel`.
- `add-line` defaults the account:
  - savings items: the first savings account;
  - other items: `s.depositTo` if it's a spending account, else the first spending account.

  (Task 5 changes `depositTo` to the landing account.)
- Accounts card: the spec §3 layout. Kind is shown as text and can't be edited. On an owner
  change, re-render the editor with focus on `#aw-<id>`.
- Add and delete actions as listed in the Interfaces.
- The name input keeps today's live update of `option[value=id]` text.

- [ ] **Step 4: Run the whole suite**

Run: `node tests/smoke.js`
Expected: `All checks passed`.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Accounts as a list: kinds, owners, grouped menus, add and remove accounts"
```

---

### Task 4: People card, live renames, upgrade banner

**Files:**
- Modify: `index.html`:
  - `peopleHTML()` after `yearlyHTML(s)` in `editorHTML`
  - input and click handlers
  - `renderBanner()` ~1070, plus the banner set-up near 640
  - `confirmImport()` ~1704
  - `refresh()` ~1345
  - CSS
- Modify: `tests/smoke.js`: new section `people`; add `'people'` to the card-head list in **layout**

**Interfaces:**
- Consumes: `personName`, `ownerOf`, `acctLabel`, `[data-acct-label]`, `optgroup[data-person]` (Task 3).
- Produces:
  - `removePerson(id)`: does nothing while only one person is left. Otherwise accounts with `owner === id` → `''`; every income with `who === id`, in every scenario → first remaining person's id; `split.pct` is untouched.
  - Element ids:
    - `#pn-<id>`: `data-scope="person" data-field="name"`;
    - `[data-act="del-person"][data-id]`, armed state in `pendingDeletePerson`; its second state reads e.g. "Click again: Sam's 1 account becomes shared, Sam's pay moves to Alex";
    - `[data-act="add-person"]` (appends "Person N", focuses `#pn-<id>`);
    - `[data-act="goto-people"]`;
    - the card has `data-tour="people"` and `aria-label="People"`.
  - `banner = { kind: 'people', lead: '' | html }`. On load it is set when `loaded.upgraded` and not `blocked` (it beats the tour offer). After confirming the import of a file whose `state.v < DATA_V`, it is set with `lead` = the "Imported the plan…" text.
  - A rename of person `id` updates, without re-rendering:
    - `optgroup[data-person=id]` labels;
    - option text in `select[data-field="owner"]` and `select[data-field="who"]` for `value=id`;
    - `[data-acct-label]` (via `refresh()`).

- [ ] **Step 1: Write the failing test (section `people`)**

On `openPage({ storage: OLD() })`:

```js
check('an upgraded plan asks for the household’s names', await bannerHas(page, 'add the people in your household'));
// click goto-people
check('"Go to People" focuses the first name', active === `pn-${p1}`);
check('with one person there is no ×', (await page.locator('[data-act="del-person"]').count()) === 0);
// click add-person
check('"+ Add person" adds Person 2 and focuses its name', s.people.length === 2 && s.people[1].name === 'Person 2' && active === `pn-${p2}`);
// selectOption('#aw-msav', p2); click #pn-p2, Control+A, type 'Sam'
check('typing a name keeps focus and every keystroke', focus.id === `pn-${p2}` && focus.value === 'Sam');
check('menus follow the new name while typing', (await page.$eval(`#c-${fun} optgroup[data-person="${p2}"]`, (e) => e.label)) === 'Sam');
check('labels follow it too', (await page.locator(`[data-goal="${fun}"] .tag`).innerText()) === 'My savings · Sam');
// del-person p1 once
check('the first click only asks, and says what will happen', armedText.includes('Click again') && armedText.includes('Sam'));
// del-person p1 again
check('removing a person makes their accounts shared and gives their pay to the next person',
  s.people.length === 1 && s.accounts.mchk.owner === '' && s.scenarios.every((x) => x.incomes.every((i) => i.who === p2)) &&
  isDeepStrictEqual(totals(s), totalsBefore)); // totals = per-scenario Σ income amt
// Review Focus 1
// fill #pn-p2 with '<u>x</u>'
check('a name is shown as text, never as markup', (await page.locator('#root u').count()) === 0 && tag.includes('<u>x</u>'));
// fill #pn-p2 with ''
check('an empty name shows as "Person 1"', tag === 'My savings · Person 1');
```

On a fresh `openPage({})`, import `FIXTURE_V1` and confirm:

```js
check('importing an older file says so and asks for names', await bannerHas(b.page, 'Imported the plan') && await bannerHas(b.page, 'add the people'));
```

- [ ] **Step 2: Run it to verify it fails**

Run: `ONLY=people,layout node tests/smoke.js`
Expected: FAIL.

- [ ] **Step 3: Implement the People card, `removePerson`, live renames and the banner**

The card layout is spec §2. The meta text uses `data-out="pm-<id>"` (accounts owned · active
scenario take-home) and is filled in `refresh()`. "Go to People" clears the banner, scrolls
`[data-tour="people"]` into view (smooth unless reduced motion) and focuses the first `#pn-`.

- [ ] **Step 4: Run the whole suite**

Run: `node tests/smoke.js`
Expected: `All checks passed`.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "People card: add, rename and remove people; ask for names after an upgrade"
```

---

### Task 5: Incomes say whose they are and where they land (pooled landing)

**Files:**
- Modify: `index.html`:
  - Income card in `editorHTML` 1109–1123 (remove `#scn-dep`)
  - `transfers()`
  - `flowSVG` note
  - `add-inc` ~1876, `add-line`, `new-scn`
  - `change` handler
  - `.inc-row` CSS (two lines under 680px)
- Modify: `tests/smoke.js`: new section `income`; extend `people` with the "whose" select check

**Interfaces:**
- Consumes: `acctOptions`, `isKind`, `acctsOfKind`, `personName` (Task 3).
- Produces:
  - `incTo(x) -> acctId`: `x.to` if it's a spending account, else the first spending account
  - `payMode(s) -> { pooled: bool, land: acctId, lands: [acctId] }`. `lands` = the distinct `incTo` of active incomes. Pooled iff `lands.length <= 1`. `land` = `lands[0]`, else the first income's `incTo`, else `s.depositTo` if it's a spending account, else the first spending account.
  - `transfers(s, c)` uses `payMode(s).land` in place of `s.depositTo`.
  - `newIncome(s) -> income`, as in spec §4:
    - `who` = the first person with no income in `s`, else the first person;
    - `to` = the first income's `incTo`, else `depositTo` if it's a spending account, else the first Shared spending account, else the first spending account;
    - `name` = `'Take-home pay'`, `amt` = 0, `id` = `nid()`.
  - `add-line` (non-savings) and `new-scn` (`depositTo`) use `payMode(s).land`.
  - Element ids: `#iw-<incId>` (`data-scope="inc" data-field="who"`), `#it-<incId>` (`data-scope="inc" data-field="to"`).
  - `window.__hbp.payMode() -> payMode(scn())`.

- [ ] **Step 1: Write the failing test (section `income`)**

On `openPage({ storage: OLD() })` (active scenario `now`, both incomes landing in `mchk`):

```js
check('each income says whose pay it is and where it lands', whoVals.every((v) => v === p1) && toVals.join() === 'mchk,mchk');
check('there is no scenario-wide deposit select any more', (await page.locator('#scn-dep').count()) === 0);
check('the payday plan starts where the pay lands', (await cardText(page, 'transfers')).includes('land in My checking · Person 1'));
// click add-inc
check('a new income goes to the same account as the others', ni.who === p1 && ni.to === 'mchk' && ni.name === 'Take-home pay' && ni.amt === 0);
// selectOption('#it-<new>', 'jchk') with the amount still 0
check('a $0 income landing elsewhere keeps the scenario pooled', (await page.evaluate(() => window.__hbp.payMode())).pooled === true);
```

Review Focus 3, on a variant of `oldPlan()` with `scenarios[0].incomes[0].to = 'jsav'`:

```js
check('pay set to land in a savings account lands in the first spending account', (await page.evaluate(() => window.__hbp.payMode().land)) === 'jchk');
```

(Plus the section's built-in "no console errors" check.)

In `people`: after typing "Sam", `#iw-<any income> option[value="<p2>"]` text is `'Sam'`.

- [ ] **Step 2: Run it to verify it fails**

Run: `ONLY=income,people node tests/smoke.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

The income row is spec §4. Changing `who` or `to` calls `changed()` then
`rerenderEditor(<that select's id>)`. The migration equivalence check from Task 2 must still pass.

- [ ] **Step 4: Run the whole suite**

Run: `node tests/smoke.js`
Expected: `All checks passed`.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Incomes say whose pay they are and which account they land in"
```

---

### Task 6: Separate pay (split rule, per-person payday plan, warnings)

**Files:**
- Modify: `index.html`:
  - split control in the Income card
  - new `weights()` / `splitPlan()` near `transfers()`
  - `renderSide()` payday card
  - input/change handlers (`data-scope="split"`)
  - `window.__hbp`
  - CSS
- Modify: `tests/smoke.js`: new section `separate`
- Modify: `CLAUDE.md`: the "Transfer plan" bullet

**Interfaces:**
- Consumes: `payMode`, `incTo`, `ownerOf`, `personName`, `acctLabel`, `acctIds`, `calc().by` (Tasks 3 and 5).
- Produces:
  - `weights(s) -> { [personId]: number }`: spec §4 "Weights". Every current person has a key. They sum to 1 when anyone has active pay, else all are 0.
  - `splitPlan(s, c) -> null | { w, people: [{ id, I, L, incomes: [{ id, land, I, moves: [{ a, amt }], keep, keepPlanned }] }], unfunded: [{ a, amt }] }`. It is `null` when `payMode(s).pooled`. `people` lists only people with active pay.
    - Spec §5: bearer $b(\ell)$ = `l.acct`; destination $r(\ell)$ = `state.fund.acct` for a yearly need/want item while the fund is on, else $b(\ell)$.
    - $\sigma_p(b)$: 1 if owner = $p$; $w_p$ if Shared or the owner doesn't exist; 0 otherwise.
    - $O_{p,a} = \sum_{r(\ell)=a} \sigma_p(b(\ell))\,m_\ell$.
    - $T_{i,a} = (I_i/I_{p(i)})\,O_{p(i),a}$ for $a \ne d(i)$, with moves in `acctIds()` order and amount > 0.5.
    - `keep` = $I_i - \sum_a T_{i,a}$; `keepPlanned` = $(I_i/I_p)\,O_{p,d(i)}$; $L_p = I_p - \sum_a O_{p,a}$.
    - `unfunded`: bearer accounts owned by a person with $I_q = 0$, with Σ $m_\ell$ over their items > 0.5.
  - Split control: `<div id="split">` in the Income card, always rendered. `refresh()` sets `hidden = payMode(s).pooled`.
    - `#split-mode` (`data-scope="split" data-field="mode"`);
    - `#sp-<personId>` (`data-scope="split" data-id data-field="pct"`), shown when mode is `custom`;
    - `data-out="split-sum"` ("adds up to N%" and the scaling note).
  - Payday card when separate:
    - no diagram; a note "Pay lands in more than one account, so each person sets up their own transfers.";
    - one block per person: heading "&lt;Name&gt;'s pay · $I into &lt;label&gt;", or one sub-heading per income when several;
    - today's `.steps` list per income: "Move to …" and "Keep in …", with "why" text naming the shares;
    - the Global Constraints warnings in `.alert`.
  - `window.__hbp.weights() -> weights(scn())` and `window.__hbp.splitPlan() -> splitPlan(scn(), calc(scn()))`.

- [ ] **Step 1: Write the failing test (section `separate`)**

Seed `sepPlan()`:

```js
{ v: 3, touched: true, modifiedAt: 1, lastSync: null, active: 'sep', cats: [], checkins: [], fund: { acct: 'js', saved: 0 },
  people: [{ id: 'pa', name: 'Alex' }, { id: 'ps', name: 'Sam' }],
  accounts: { j: { name: 'Joint checking', note: '', kind: 'spend', owner: '' }, js: { name: 'Joint savings', note: '', kind: 'save', owner: '' },
              a1: { name: 'Checking', note: '', kind: 'spend', owner: 'pa' }, s1: { name: 'Checking', note: '', kind: 'spend', owner: 'ps' } },
  acctOrder: ['j', 'js', 'a1', 's1'],
  scenarios: [{ id: 'sep', name: 'Separate', sub: '', depositTo: 'j', split: { mode: 'income', pct: {} },
    incomes: [{ id: 'ia', name: 'Alex pay', amt: 3000, who: 'pa', to: 'a1' }, { id: 'is', name: 'Sam pay', amt: 1000, who: 'ps', to: 's1' }],
    lines: [
      { id: 'l1', g: 'need', name: 'Rent', amt: 1000, f: 'mo', acct: 'j', cat: '', due: 0 },
      { id: 'l2', g: 'save', name: 'Savings', amt: 500, f: 'mo', acct: 'js' },
      { id: 'l3', g: 'want', name: 'Alex fun', amt: 100, f: 'mo', acct: 'a1', cat: '', due: 0 },
      { id: 'l4', g: 'want', name: 'Sam fun', amt: 50, f: 'mo', acct: 's1', cat: '', due: 0 },
      { id: 'l5', g: 'need', name: 'Car insurance', amt: 1200, f: 'yr', acct: 'a1', cat: '', due: 0 },
      { id: 'l6', g: 'want', name: 'Gifts', amt: 600, f: 'yr', acct: 'j', cat: '', due: 12 } ] }] }
```

Here $N_j = 1000$ and $N_{js} = 500 + 100 + 50 = 650$. Helpers, re-read after every change:
- `sp = await page.evaluate(() => window.__hbp.splitPlan())` and `w = (await page.evaluate(() => window.__hbp.weights()))`;
- `pA` / `pS` = `sp.people.find((p) => p.id === 'pa' / 'ps')`, and `A = pA.incomes[0]`, `S = pS.incomes[0]`;
- `mv(sp, pid, a)` = the `amt` of that person's first income's move to `a` (0 if none);
- `near(x, y)` = `Math.abs(x - y) < 0.01`.

```js
check('by take-home: weights', near(w.pa, 0.75) && near(w.ps, 0.25));
check('by take-home: Alex moves 75% of shared plus all of his own yearly cost', near(mv(sp,'pa','j'), 750) && near(mv(sp,'pa','js'), 512.5));
check('by take-home: Sam moves 25% of shared', near(mv(sp,'ps','j'), 250) && near(mv(sp,'ps','js'), 137.5));
check('by take-home: what each keeps', near(A.keep, 1737.5) && near(A.keepPlanned, 100) && near(S.keep, 612.5) && near(S.keepPlanned, 50));
check('leftovers add up to what is left to assign', near(pA.L + pS.L, 2200));
check('the split control shows when pay lands in two accounts', await page.locator('#split').isVisible());
check('each person gets their own transfers', (await cardText(page, 'transfers')).includes('Alex’s pay') && (await cardText(page, 'transfers')).includes('Sam’s pay'));
// selectOption('#split-mode', 'equal')
check('equally', near(mv(sp,'pa','j'), 500) && near(mv(sp,'pa','js'), 375) && near(mv(sp,'ps','j'), 500) && near(mv(sp,'ps','js'), 275));
// selectOption('#split-mode', 'custom'); fill #sp-pa 70, #sp-ps 30
check('set percentages 70/30', near(mv(sp,'pa','j'), 700) && near(mv(sp,'pa','js'), 485) && near(mv(sp,'ps','j'), 300) && near(mv(sp,'ps','js'), 165));
// fill #sp-pa 60
check('percentages adding up to 90 are scaled, with a note', near(w.pa, 2/3) && (await cardText(page, 'income')).includes('Shares are scaled to add up to 100%'));
// Review Focus 2: clear both #sp- inputs
check('blank percentages fall back to equal shares', near(w.pa, 0.5) && !/NaN|Infinity/.test(await page.locator('#root').innerText()));
// selectOption('#split-mode', 'equal'); fill Sam's income amount with 200
check('a share bigger than the pay is flagged', (await cardText(page, 'transfers')).includes('Sam’s share is $625 more than Sam’s pay'));
// fill Sam's amount 1000; selectOption('#it-is', 'a1')
check('pay into one account again is pooled: no split control, today’s plan',
  !(await page.locator('#split').isVisible()) && (await stepText(page, 'Joint savings')).includes('$650') && (await stepText(page, 'Checking · Sam')).includes('$50'));
```

A second page, on `sepPlan()` with Sam's income `amt: 0` and a third income
`{ id: 'ig', name: 'Side gig', amt: 500, who: 'pa', to: 'j' }`:

```js
check('a person with no pay who owns an account with items is flagged', isDeepStrictEqual(sp.unfunded, [{ a: 's1', amt: 50 }]) &&
  (await cardText(page, 'transfers')).includes('Nobody’s pay covers Checking · Sam ($50)'));
check('a person with two incomes splits their transfers by amount', near(js(sp), 650)); // Σ over Alex's incomes of the move to js
```

Review Focus 5, on a third page on `sepPlan()`: remove Sam with two clicks (`del-person ps`).

```js
check('removing the only other earner keeps the pay and shows no NaN',
  s.scenarios[0].incomes.reduce((t, x) => t + x.amt, 0) === 4000 && s.scenarios[0].incomes.every((x) => x.who === 'pa') &&
  s.accounts.s1.owner === '' && !/NaN|Infinity/.test(await page.locator('#root').innerText()));
```

Phone check: at a 390px viewport on `sepPlan()`, there is no horizontal scroll with the split
control and both person blocks showing. If `SHOTS` is set, screenshot it as `phone-separate.png`.

- [ ] **Step 2: Run it to verify it fails**

Run: `ONLY=separate node tests/smoke.js`
Expected: FAIL.

- [ ] **Step 3: Implement `weights`, `splitPlan`, the split control and the per-person payday card**

The `pct` inputs edit `s.split.pct[id] = n(v)` and call `refresh()` (they are in the editor
column, so they keep focus). A mode change calls `rerenderEditor('split-mode')`.

- [ ] **Step 4: Run the whole suite**

Run: `node tests/smoke.js`
Expected: `All checks passed`.

- [ ] **Step 5: Update CLAUDE.md "Transfer plan"**

Write the pooled rule, the separate rule ($w_p$ by mode, $\sigma_p$, $O_{p,a}$, per-income
$T_{i,a}$), the bearer vs destination of yearly items while the fund is on, and the warnings.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js CLAUDE.md
git commit -m "Separate pay: split shared costs by a rule and show each person's payday transfers"
```

---

### Task 7: One generic example, "item" wording, tour, docs

**Files:**
- Modify: `index.html`:
  - `defaults()` / `example()` 444–547 (replace)
  - the strings listed in spec §6
  - `TOUR` ~1960 (add People before Accounts; reword Scenarios, Income, Payday transfer plan, Categories)
  - the device placeholder ~1473
- Modify: `tests/smoke.js`: migration example check, `tour` (17 → 18 steps, wording), new wording check in `basics`
- Modify: `README.md` (features, the payday-plan sentence)
- Modify: `CLAUDE.md`:
  - intro sentence
  - "How the UI code works" editor-card order (… yearly costs, people, accounts)
  - "Data model" example note and the item/`lines` rule
  - "Feature ideas" reordered: 1 per-paycheck transfers, 2 planned changes over time (timeline), 3 interest

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `defaults()`: a v3 plan per spec §7. One scenario `{ id: 'example', name: 'Example', sub: 'Example numbers: replace them with yours' }`. People Alex and Sam, each with an income landing in Joint checking.
  - Accounts:
    - Shared: Joint checking (spend), Joint savings (save), Retirement / investing (save);
    - Alex: Checking (spend); Sam: Checking (spend).
  - Items:
    - "Car registration & maintenance" yearly, due 3;
    - "Gifts & holidays" yearly, due 12;
    - "Emergency fund", goal mode `months` 6;
    - "Vacation", goal mode `amount` with `by` = `monthKey(monthIndex(thisMonth()) + 12)`;
    - "Personal spending: Alex" and "Personal spending: Sam", each from that person's Checking.
  - The six categories as today; `fund = { acct: <Joint savings id>, saved: 0 }`. Amounts are the builder's call.

- [ ] **Step 1: Write the failing tests**

In **migration**, replace the example check:

```js
check('the example is one generic scenario with two people, pooled',
  ex.v === 3 && ex.scenarios.length === 1 && ex.scenarios[0].name === 'Example' && ex.people.map((p) => p.name).join() === 'Alex,Sam' &&
  ex.cats.length === 6 && ex.accounts[ex.fund.acct].name === 'Joint savings' && car.due === 3 && gifts.due === 12 &&
  new Set(ex.scenarios[0].incomes.map((x) => x.to)).size === 1, JSON.stringify({ n: ex.scenarios.length, people: ex.people }));
```

In **basics**:

```js
check('the page never says “line”', !/\blines?\b/i.test(await page.locator('body').innerText()));
```

In **tour**:
- loop `2..18` and expect `'1 of 18'`;
- collect `#tour-text` at each step;
- add:

```js
check('no tour step says “line”', texts.every((t) => !/\blines?\b/i.test(t)), texts.filter((t) => /\blines?\b/i.test(t)).join(' | '));
check('the tour has a People step before Accounts', titles.indexOf('People') === titles.indexOf('Accounts') - 1);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `ONLY=migration,basics,tour node tests/smoke.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Write the new example, the wording changes, the tour steps and the placeholder. The Task 1
fixture keeps the old-example sections green.

- [ ] **Step 4: Run the whole suite with screenshots and look at them**

Run: `node tests/smoke.js /tmp/claude-0/-home-user-household-budget-planner/daec587a-4763-5807-adf3-d74ddcf0be33/scratchpad/shots`
Expected: `All checks passed`. Open the laptop and phone screenshots in light and dark, plus
`phone-separate.png`. Check that these are legible: the People card, the grouped Accounts card,
the income rows, the split control and the per-person blocks.

- [ ] **Step 5: Update README and CLAUDE.md as listed under Files**

- [ ] **Step 6: Commit**

```bash
git add index.html tests/smoke.js README.md CLAUDE.md
git commit -m "One generic example plan, say 'item' instead of 'line', tour and docs for people and accounts"
```
