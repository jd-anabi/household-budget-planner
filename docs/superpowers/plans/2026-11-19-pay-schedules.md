# Pay schedules (data v4): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each income gets a pay schedule (monthly, twice a month, every two weeks, weekly), entered
per paycheck. The monthly plan budgets on the regular paychecks; extra paychecks are listed
separately; the payday plan says how often to set each transfer up.

**Architecture:** Everything stays in the IIFE in `index.html`.
- A `PAY` table plus `incMonthly(x)` replace every read of `x.amt` as monthly take-home, so `calc`,
  `payMode`, `weights` and `splitPlan` keep working in monthly amounts.
- Halving to twice-a-month amounts happens only when the payday card is drawn.
- `extraMonths()` places extra paychecks from one known payday.
- Data moves to v4 with a `v3to4` step that only adds fields.

**Tech Stack:** Plain ES5 JavaScript, inline CSS tokens, Playwright smoke test (`node tests/smoke.js`).

**Spec:** `docs/superpowers/specs/2026-11-19-pay-schedules-design.md` (approved 2026-11-19).
Section numbers (§1–§4) refer to it.

## Global Constraints

- Plain ES5 inside the existing IIFE in `index.html`; inline CSS through the existing tokens, legible in both themes; no libraries, no new external loads; no new app files (`sw.js` unchanged).
- `DATA_V = 4`. `migrate()` chains v1→v2→v3→v4 on load and import, only adds fields, and keeps unknown ones. A plan with `v > 4` is never saved over.
- Backups: before upgrading a stored plan of version k (1, 2 or 3), copy its raw JSON to `household-budget-planner:plan:v{k}-backup` if that key is empty. An unreadable value still goes to the `v1-backup` key.
- Inputs only in the editor column; the side column is rebuilt by `refresh()` and stays read-only. Value edits call `changed()` then `refresh()`; structural edits call `rerenderEditor(focusId)`.
- No horizontal scroll at 390px in either theme. Visible focus states.
- The app never stores a value that would fail `validPlan`.
- Schedules (`PAY`):

  | every | label | k | extra a year |
  |---|---|---|---|
  | `mo` | Monthly | 1 | 0 |
  | `semi` | Twice a month | 2 | 0 |
  | `biwk` | Every two weeks | 2 | 2, step 14 days |
  | `wk` | Weekly | 4 | 4, step 7 days |

- `amt` is one paycheck; budgeted monthly income = k × amt. An income is active when that is ≥ 0.5.
- Fixed copy (apostrophes are ’):
  - amount label "a month" (monthly) / "per paycheck" (others); "= $X a month (k paychecks)";
  - "A recent payday"; "Extra paychecks go to", with the option "Leave it where it lands";
  - hint "Use a typical paycheck; overtime and extra shifts come on top.";
  - separate-pay sub-labels "Once a month" / "Twice a month, after paydays"; step why-text suffix "($X a month)";
  - pooled note "Set these up once a month, on the last day of the month, after the month’s paychecks have landed.";
  - block title "Extra paychecks (not in the monthly plan)"; row "<Name> · <Mon YYYY, …>: move $P each to <label>" or "<Name> · <Mon YYYY, …>: $P each, left in <landing label>";
  - without a payday: "<Name> · usually two a year (add a recent payday to see the months): …" ("four" for weekly);
  - summary line "Plus about $X a year in extra paychecks, outside the monthly plan."; compare row "Extra paychecks a year".

## Review Focus

1. **A payday typed as text, or pasted wrong** (some browsers show the date box as a text field) is stored as `''`, and the plan still loads after a reload. (Test in Task 2.)
2. **A payday far from today** (years back or ahead, across daylight-saving changes and leap days) gives the same months as a nearby payday on the same two-week cycle. (Test in Task 3.)
3. **An every-two-weeks income of $0** is inactive: no extra-paycheck row, no summary line, no NaN. (Test in Task 3.)
4. **`extraTo` naming a removed account** (hand-edited file) reads "left in <landing account>". Nothing is sent to a missing account. (Test in Task 3.)
5. **Switching an existing monthly $3,000 income to every two weeks** keeps 3000 as the paycheck, and the card visibly says "= $6,000 a month (2 paychecks)", so the change can't go unnoticed. (Test in Task 2.)

---

### Task 1: v3 fixture, data model v4, budgeted monthly income

**Files:**
- Create: `tests/fixtures/plan-v3.json`
- Modify: `index.html`:
  - `DATA_V` (~452)
  - `migrate` / `v2to3` area (~629–690): add `v3to4`
  - `validPlan` (~606)
  - `readStored` backup key (~695)
  - the banner set-up (~711) and `confirmImport` (~2166): people banner only from v1/v2
  - `calc` (~840), `isActive` (~1149), `payBy` (~1186), `splitPlan` `Ii` (~1242), `peopleMeta` (~1464), `newIncome` (~1168)
  - `window.__hbp`
- Modify: `tests/smoke.js`: `DATA_VERSION`, `FIXTURE_V3`, `minPlan`/`sepPlan` and every other hand-built v-current plan (add the three income fields), sections migration and people (banner)
- Modify: `CLAUDE.md` "Data model": v4 income fields, the PAY table, `v3to4`, the v3 backup key, the banner rule

**Interfaces:**
- Produces:
  - `PAY` (the table above, as `{ label, k, extra, step }`, step 0 for `mo`/`semi`)
  - `payOf(x) -> PAY entry` (`PAY.mo` for an unknown `every`)
  - `incMonthly(x) -> number` (`payOf(x).k * n(x.amt)`)
  - `isDate(s) -> bool` (`YYYY-MM-DD` that is a real calendar date)
  - `v3to4(q)`
  - `readStored` unchanged in shape (`{ plan, newer, upgraded, from }`)
  - `newIncome(s)` returns `every: 'mo', payday: '', extraTo: ''` as well
  - `window.__hbp.incMonthly(x)`

- [ ] **Step 1: Generate the v3 fixture from the current app (before any change)**

Same command as `tests/fixtures/plan-v2.json` was made with (route `http://fixture.test/` to `index.html`, abort everything else), clock fixed at `2026-11-01T09:00`. Write `{ app: 'household-budget-planner', v: 3, exportedAt: '2026-11-01T20:00:00.000Z', exportedBy: '', state }` with `state = window.__hbp.state()`.
Expected: `state.v === 3`, one scenario `example`, people Alex and Sam, `touched === false`.

- [ ] **Step 2: Write the failing tests**

`DATA_VERSION = 4`; add `FIXTURE_V3`. Give the hand-built plans' incomes `every: 'mo', payday: '', extraTo: ''`.

In **migration**, for an import of `FIXTURE_V3` (with an `extra: { a: 1 }` field):

```js
check('v3 file imports as v4', st.v === 4 && st.scenarios.every((s) => s.incomes.every((x) => x.every === 'mo' && x.payday === '' && x.extraTo === '')));
// strip every/payday/extraTo from incomes, v/lastSync/modifiedAt/touched from both: deep-equal to the fixture state (+extra)
check('everything else in a v3 file is unchanged', isDeepStrictEqual(stripped, fixtureState));
check('v1 and v2 files still import, as v4', v1st.v === 4 && v2st.v === 4);
```

Load path, stored v3:

```js
check('a stored v3 plan is upgraded on load and backed up', storedV === 4 && (await localStorage(backupKey(3))) === raw);
check('a v3 plan upgraded to v4 does not ask for people', !(await page.locator('#banner').innerText()).includes('add the people'));
```

The existing stored-v2 check still expects the people banner.

**Equivalence:** for the stored-v3 page, every scenario's `window.__hbp.transfers(id)` and `calc` take-home equal the fixture's monthly values (take-home = Σ `amt`; transfers by the same sums-by-account rule the v2 equivalence check uses).

**Budgeted income** (new checks in migration, on `minPlan` with four incomes):

```js
// incomes: biwk 1500, semi 1500, wk 700, mo 3000 → incMonthly 3000, 3000, 2800, 3000; calc take-home 11800
check('pay schedules budget on regular paychecks', vals.join() === '3000,3000,2800,3000' && I === 11800, JSON.stringify({ vals, I }));
```

In **import-safety**, refused variants:

```js
'unknown pay schedule': variant((st) => { st.scenarios[0].incomes[0].every = 'daily'; }),
'payday that is not a date': variant((st) => { st.scenarios[0].incomes[0].payday = '2027-02-30'; }),
'extraTo with markup': variant((st) => { st.scenarios[0].incomes[0].extraTo = 'x"><b>'; }),
```

- [ ] **Step 3: Run them to verify they fail**

Run: `ONLY=migration,import-safety,people node tests/smoke.js`
Expected: FAIL (v is 3, the fields are missing).

- [ ] **Step 4: Implement**

- `v3to4` per spec §1.
- `validPlan`:
  - `every` ∈ PAY keys;
  - `payday === '' || isDate(payday)`;
  - `extraTo === '' || okId(extraTo)`.
- The backup key chooses k ∈ {1, 2, 3}.
- People banner only when `loaded.from` is 1 or 2, or the imported file's `state.v` ≤ 2.
- Replace every `n(x.amt)`-as-monthly with `incMonthly(x)` (`isActive` included).
- `newIncome` fields as listed in the Interfaces.

- [ ] **Step 5: Run the whole suite**

Run: `node tests/smoke.js`
Expected: `All checks passed`.

- [ ] **Step 6: Update CLAUDE.md "Data model" (listed under Files), then commit**

```bash
git add tests/fixtures/plan-v3.json index.html tests/smoke.js CLAUDE.md
git commit -m "Data model v4: pay schedule on each income, budget on regular paychecks; migrate v3"
```

---

### Task 2: Income row: how often, per paycheck, payday, extra paychecks

**Files:**
- Modify: `index.html`:
  - the income row in `editorHTML` (~1405–1425) and `.inc-row` CSS (~249, ~373)
  - the input and change handlers (`data-scope="inc"`)
  - `acctUses` (~814)
  - `refresh()` (fills `im-<id>`)
- Modify: `tests/smoke.js`: section `income`

**Interfaces:**
- Consumes: `PAY`, `payOf`, `incMonthly`, `isDate` (Task 1); `acctOptions`, `acctsOfKind`, `ownerOf`, `incWho`, `incTo`.
- Produces:
  - Element ids:
    - `#ie-<incId>`: select, `data-scope="inc" data-field="every"`, options in PAY order with PAY labels;
    - `#ip-<incId>`: `<input type="date">`, `data-field="payday"`;
    - `#ix-<incId>`: select, `data-field="extraTo"`, first option `value=""` "Leave it where it lands", then every account grouped by owner;
    - `data-out="im-<incId>"`: the "= $X a month (k paychecks)" text, empty for monthly.
  - The second line (`#ip-`, `#ix-`, hint) renders only for `biwk`/`wk`.
  - `defaultExtraTo(x) -> acctId | ''`: the first Shared savings account, else the first savings account owned by `incWho(x)`, else `''`.
  - `acctUses(a)` counts `x.extraTo === a` only while `x.every` is `biwk` or `wk`.

- [ ] **Step 1: Write the failing tests (section `income`)**

On `minPlan` with one Shared spending account `c`, Shared savings accounts `s` and `s2`, and one income `{ id: 'i1', amt: 3000, every: 'mo', who: 'p1', to: 'c', payday: '', extraTo: '' }`:

```js
// select #ie-i1 'biwk'
check('changing how often keeps focus on it', active === 'ie-i1');
check('the amount is a paycheck now, and the card says what that means a month',
  label.includes('per paycheck') && (await text('[data-out="im-i1"]')) === '= $6,000 a month (2 paychecks)'); // Review Focus 5
check('extra paychecks default to the first shared savings account', (await page.inputValue('#ix-i1')) === 's');
// select #ix-i1 's2'
check('changing where extra paychecks go keeps focus on it', active === 'ix-i1');
check('an account extra paychecks go to cannot be removed', (await page.locator('[data-act="del-acct"][data-id="s2"]').count()) === 0);
// select #ie-i1 'mo'
check('back to monthly, that account can be removed again', (await page.locator('[data-act="del-acct"][data-id="s2"]').count()) === 1 && !(await page.locator('#ip-i1').count()));
// select #ie-i1 'biwk'; fill #ip-i1 '2027-01-01'
check('a payday is stored', stored.payday === '2027-01-01');
// Review Focus 1: set the date input's value to 'not a date' via evaluate (type="text" swap) and dispatch input; reload
check('a payday that is not a date is stored empty, and the plan still loads', stored.payday === '' && (await loadedScn(page)) === 'm');
// 390px, light and dark, with the second line showing
check('the income row fits a 390px screen', overflow <= 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `ONLY=income node tests/smoke.js`
Expected: FAIL (no `#ie-i1`).

- [ ] **Step 3: Implement**

- Spec §2 layout.
- `every` change: set `extraTo = defaultExtraTo(x)` when switching to `biwk`/`wk` with `extraTo === ''`, then `changed()` and `rerenderEditor('ie-' + id)`.
- `extraTo` change: `changed()` and `rerenderEditor('ix-' + id)`.
- `payday` input: store `isDate(v) ? v : ''`, then `changed()` and `refresh()`.
- `refresh()` fills `im-<id>`.

- [ ] **Step 4: Run the whole suite**

Run: `node tests/smoke.js`
Expected: `All checks passed`.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Income row: how often you're paid, amount per paycheck, payday and extra paychecks"
```

---

### Task 3: Payday plan: twice-a-month transfers, extra paychecks, summary and compare

**Files:**
- Modify: `index.html`:
  - `personStepsHTML` (~2039)
  - `renderSide` payday card (~1855) and compare table (~1915)
  - `renderSummary` (~1791)
  - new `extraMonths` and `extraPayHTML`
  - `window.__hbp`
- Modify: `tests/smoke.js`: section `paydays` (new)

**Interfaces:**
- Consumes: `PAY`, `payOf`, `incMonthly`, `isDate`, `isActive`, `incTo`, `incWho`, `personName`, `acctLabel`, `isKind`, `splitPlan`, `payMode` (Tasks 1–2 and v3).
- Produces:
  - `extraMonths(x, fromKey, n) -> [monthKey]`: `[]` unless `x.every` is `biwk`/`wk` and `isDate(x.payday)`. Paydays are `payday + j·step` days for every integer j (UTC day numbers). A month in `fromKey … fromKey+n−1` is listed when its paydays number more than `payOf(x).k`.
  - `extraDest(x) -> acctId | ''`: `x.extraTo` if it is an account in `acctIds()`, else `''`.
  - `extraYear(s) -> number`: Σ over active `biwk`/`wk` incomes of `payOf(x).extra × n(x.amt)`.
  - `window.__hbp.extraMonths(x, fromKey, n)`.
  - The extra block is `<div class="extra-pay">` inside the payday card, one `<p data-extra="<incId>">` per active `biwk`/`wk` income.

- [ ] **Step 1: Write the failing tests (section `paydays`)**

`extraMonths` (hand-checked):

```js
const x = (every, payday) => ({ every, payday, amt: 1, who: 'p1', to: 'c' });
check('every two weeks from 1 Jan 2027: three paydays in Jan, Jul and Dec', em(x('biwk', '2027-01-01'), '2027-01', 12).join() === '2027-01,2027-07,2027-12');
check('weekly from 1 Jan 2027: five in Jan, Apr, Jul, Oct and Dec', em(x('wk', '2027-01-01'), '2027-01', 12).join() === '2027-01,2027-04,2027-07,2027-10,2027-12');
check('the window starts where asked', em(x('biwk', '2027-01-01'), '2026-11', 12).join() === '2027-01,2027-07');
check('a payday two years earlier on the same cycle gives the same months', em(x('biwk', '2025-01-03'), '2027-01', 12).join() === '2027-01,2027-07,2027-12'); // Review Focus 2
check('no payday or monthly pay: no months', !em(x('biwk', ''), '2027-01', 12).length && !em(x('mo', '2027-01-01'), '2027-01', 12).length);
```

On `sepPlan` with Sam's income `{ amt: 500, every: 'biwk', payday: '2027-01-01', extraTo: 'js' }`. His monthly is still 1000, so `splitPlan` is unchanged: j 250, js 137.5. Date fixed at `2026-11-16T12:00`:

```js
check('separate pay: a monthly income’s steps are once a month, unchanged', alex.includes('Once a month') && alexStep('Joint checking').includes('$750'));
check('separate pay: an every-two-weeks income’s steps are twice a month, half each',
  sam.includes('Twice a month, on the 15th and the last day') && samStep('Joint checking').includes('$125') && samStep('Joint checking').includes('($250 a month)'));
check('extra paychecks list the months and where they go', extra.includes('Sam · Jan 2027, Jul 2027: move $500 each to Joint savings'));
check('the summary counts them outside the plan', summary.includes('Plus about $1,000 a year in extra paychecks, outside the monthly plan.'));
check('compare shows extra paychecks a year', compareRow('Extra paychecks a year').includes('$1,000'));
// set Sam's payday '' (via #ip-is)
check('without a payday it gives the count', extra.includes('Sam · usually two a year (add a recent payday to see the months)'));
// Review Focus 4: seed extraTo 'gone'
check('extra paychecks to a removed account stay where they land', extra.includes('$500 each, left in Checking · Sam'));
// Review Focus 3: Sam amt 0
check('a $0 every-two-weeks income lists no extra paychecks and no NaN', !extraBlockHasSam && !/NaN|Infinity/.test(rootText));
// pooled: Sam's pay lands in a1, amt 500 biwk
check('pooled pay stays monthly, with a note', transfers.includes('Set these up once a month, on the last day') && step('Joint savings').includes('$650'));
```

Phone: at 390px on that plan, in light and dark, there is no horizontal scroll.

- [ ] **Step 2: Run it to verify it fails**

Run: `ONLY=paydays node tests/smoke.js`
Expected: FAIL (`__hbp.extraMonths` is not a function).

- [ ] **Step 3: Implement**

Follow spec §3 and §4 with the fixed copy. `splitPlan` stays monthly. In `personStepsHTML`, an income whose `payOf(inc).k > 1` shows `money(amt / 2)` for each move and the keep, under "Twice a month, after paydays", with "($X a month)" in the why-text. List months as `monthLabel(key)` joined with ", ".

- [ ] **Step 4: Run the whole suite**

Run: `node tests/smoke.js`
Expected: `All checks passed`.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/smoke.js
git commit -m "Payday plan: twice-a-month transfers for non-monthly pay, extra paychecks, summary and compare"
```

---

### Task 4: Example, tour, docs

**Files:**
- Modify: `index.html`:
  - `defaults()` (~488): Sam's income becomes `{ amt: 1500, every: 'biwk', payday: <a Friday within 14 days before today, computed at creation>, extraTo: <Joint savings id> }`
  - `TOUR` Income and Payday-plan steps
- Modify: `tests/smoke.js`: example check in migration; tour text check
- Modify: `CLAUDE.md` ("Transfer plan": the twice-a-month rule, pooled note, extra paychecks; example note; feature ideas: mark 1 done), `README.md` (features)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing tests**

```js
check('the example’s Sam is paid every two weeks, $1,500, extra paychecks to Joint savings',
  sam.every === 'biwk' && sam.amt === 1500 && ex.accounts[sam.extraTo].name === 'Joint savings' && isFriday(sam.payday) && sumMonthly === 6600);
check('the tour explains pay schedules', incomeStepText.includes('every two weeks') && paydayStepText.includes('twice a month'));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `ONLY=migration,tour node tests/smoke.js`
Expected: FAIL.

- [ ] **Step 3: Implement the example and the tour copy**

Keep each tour step to two or three sentences.

- [ ] **Step 4: Run the whole suite with screenshots and look at them**

Run: `node tests/smoke.js /tmp/claude-0/-home-user-household-budget-planner/daec587a-4763-5807-adf3-d74ddcf0be33/scratchpad/shots-pay`
Expected: `All checks passed`. Check that the income row's second line and the extra-paychecks block are legible in light and dark at 390px.

- [ ] **Step 5: Update CLAUDE.md and README as listed, then commit**

```bash
git add index.html tests/smoke.js CLAUDE.md README.md
git commit -m "Example paid every two weeks; tour and docs for pay schedules"
```
