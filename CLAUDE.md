# Household Budget Planner

A small installable web app (PWA) for a couple to plan a monthly household budget together:
split take-home pay into necessities, savings and variable spending, see the payday transfers
between accounts, track savings goals, and compare scenarios ("Now" vs "Both working + rent").
Lines are grouped into Honeydue categories, a monthly check-in compares Honeydue's actual totals
with the plan, goals can have a "by" date, a yearly-costs fund sets aside a twelfth of yearly bills,
and an in-app tour explains each part.
Live at https://jd-anabi.github.io/household-budget-planner/ (GitHub Pages, deployed from `main`, root).

It is a **planner**, not a tracker. Day-to-day transaction tracking happens in Honeydue; this app
produces the monthly category limits that get entered there. Don't add bank connections or
per-transaction tracking.

## Hard rules

- **Privacy:** this repo is public. Never commit real personal numbers, names, or bank details.
  Example data in `defaults()` stays generic. The app makes no network requests with user data:
  no analytics, no server, no third-party APIs. The only external loads are Google Fonts.
- **Plan files already exist on people's devices.** The state shape and the export format are a
  contract. If you change either, bump `v`, write a migration that upgrades older plans on load
  and on import, and keep importing every older version working. Never silently drop fields.
- **Stay offline-capable.** If you add, rename or split files, update `ASSETS` in `sw.js` and bump
  the `CACHE` name, or installed copies will serve stale files.
- No build step and no frameworks unless there's a strong reason; it should open from any static host.

## Layout

- `index.html`: the whole app. Inline `<style>` (design tokens at the top of `:root`, with
  light/dark palettes) and one inline `<script>` (an IIFE, plain ES5-style JavaScript).
- `sw.js`: service worker. Network-first for same-origin files (so pushes reach users when online),
  cache fallback offline; cache-first for Google Fonts.
- `manifest.webmanifest`, `icons/`: install metadata and icons.
- `tests/smoke.js`: headless-browser smoke test (Playwright) in named sections; `tests/fixtures/plan-v1.json`
  is a v1 export of the example plan for migration tests. Not part of the app, so they stay out of `ASSETS`.
- `docs/superpowers/`: the design and plan for the v2 features. `.nojekyll` makes GitHub Pages serve
  files as-is, so Markdown here can never break a deploy.

## Data model (`state`, v3)

```
{ v: 3, touched, modifiedAt, lastSync: {at, kind: 'export'|'import', by} | null, active,
  people: [{ id, name }],                               // the household, n ≥ 1, in display order
  accounts: { <acctId>: { name, note,                   // keyed by id; v2's jchk, mchk, jsav, msav, inv are ordinary ids
               kind: 'spend'|'save',                    // spending (pays need/want, pay lands here) or savings/investing
               owner: '' | personId } },                // '' = Shared; an owner who no longer exists counts as Shared
  acctOrder: [acctId],                                  // display order of the accounts the app shows
  cats: [{ id, name }],                                 // Honeydue categories, shared by all scenarios
  fund: { acct: '' | savingsAcctId, saved },            // yearly-costs fund; '' = off
  checkins: [{ month: 'YYYY-MM', scn, scnName, startedAt, by,          // one per month, sorted
    spend: [{ key: catId | 'line:'+lineId | 'other', name, planned, actual | null, note }],
    goals: [{ line, name, acct, target, planned, months, start, balance, assumed }],
    fund:  null | { acct, planned, due, months, start, balance, assumed } }],
  scenarios: [{ id, name, sub, depositTo,               // depositTo: the v2 landing account, kept as a fallback
    split: { mode: 'income'|'equal'|'custom', pct: { personId: number } },  // how shared costs split when pay is separate
    incomes: [{ id, name, amt, who: personId, to: acctId }],  // monthly take-home; whose pay, which spending account it lands in
    lines:   [{ id, g: 'need'|'save'|'want', name, amt, f: 'mo'|'wk'|'yr', acct,
                cat?: '' | catId, due?: 0..12,           // need/want only; due = month a yearly line is paid
                goal?: { mode: 'none'|'amount'|'months', amount, months, saved, by: '' | 'YYYY-MM' } }] }] }
```

- Saved to `localStorage` key `household-budget-planner:plan:v1` on every edit (debounced). The key
  name is an address, not the data version.
- Several windows on one device: when another window saves the plan (the `storage` event, or `pageshow`
  after a back/forward-cache restore, in case an engine drops events for cached pages), this one reloads
  what is stored through `readStored()`, the same path as on load (upgrade, newer-version guard, backup),
  drops its own pending save and re-renders. It skips a value equal to `seenRaw`, the one it last read or
  wrote. It never writes back from that handler, or two windows would overwrite each other.
- Export file: `{ app: 'household-budget-planner', v: 3, exportedAt, exportedBy, state }`, named
  `budget-plan-YYYY-MM-DD.json`. On touch devices it uses the share sheet; otherwise a download.
  Import validates, then asks before replacing the device's plan.
- `migrate()` upgrades older plans one step at a time, on load and on import, by only adding fields;
  unknown fields are kept. v1 → v2 (`v1to2`) adds `cats: []`, `checkins: []`, `fund: {acct: '', saved: 0}`,
  `cat: ''`, `due: 0`, `by: ''`. v2 → v3 (`v2to3`) adds one person "Person 1"; the five v2 accounts
  (a missing one is created as `{name: id, note: ''}`) with kinds `jchk`/`mchk` spend, the rest save,
  and owners `mchk`/`msav` Person 1, the rest Shared; `acctOrder: ['jchk','mchk','jsav','msav','inv']`;
  every income `who` = Person 1 and `to` = the scenario's `depositTo` if that is `jchk` or `mchk`, else
  `jchk` (so every upgraded scenario is pooled and its payday plan is unchanged); `split: {mode: 'income', pct: {}}`.
- Validation (`validPlan`, v3; `validV2` checks a v2 plan between steps) refuses a malformed plan rather than
  half-loading it. Ids that reach HTML must match `ID_RE`: people ids, `acctOrder` entries, income `who`/`to`,
  `split.pct` keys (and category, line, scenario, income and check-in ids as before). `people` is non-empty,
  every `acctOrder` entry is an account with a kind, there is at least one spending and one savings
  account, `fund.acct` is `''` or a savings account, and `split.mode` is one of the three. Dangling
  references (an owner, `who` or `to` that no longer exists) are allowed and shown gracefully.
- Backups: before upgrading a stored plan of version k (1 or 2), its raw JSON is copied to
  `household-budget-planner:plan:v{k}-backup`; a stored value that can't be read goes to the `v1-backup`
  key. Each is written only if that key is empty. `readStored()` returns `{ plan, newer, upgraded, from }`.
- Guard: a stored plan or imported file with `v` newer than the app (`DATA_V = 3`) is never saved over;
  the app shows "This plan was saved by a newer version of the app…" and blocks export/import.
  The v1 and v2 apps have the same guard, so rolling the v3 features back cannot overwrite a v3 plan.
- Monthly conversion: weekly × 52/12, yearly × 1/12. All amounts are after-tax dollars.
- Goal balance is one number: the latest check-in's `balance` for that goal (matched by line id, then
  name), else `goal.saved`; "Saved so far" edits that same number (and is then labelled
  "Balance at end of <month>"). Check-in balances are pre-filled as `start + planned × months` (whole
  dollars) and marked `assumed` until edited; a first check-in counts months from the end of last month,
  so starting last month's check-in changes no status.
- Goal status: base month = latest check-in month, else last month. With `by`: on track if the monthly
  amount ≥ (goal − balance) / months left. Without: on track if balance ≥ first start + Σ planned × months.
  A "months" goal targets N × the scenario's monthly necessities (used for the emergency fund).
- Yearly-costs fund (when `fund.acct` is set): yearly lines' monthly share is transferred to that
  account; the 12-month projection is F_k = B + k·c − Σ bills due; shortfall S = max(0, −min F_k).
  Honeydue limits then leave yearly lines out. A check-in plans a dated yearly line in full in its due
  month and at 0 in other months (spread lines at 1/12).
  A check-in's fund row is pre-filled as max(0, start + c × months − bills due in those months).
- Transfer plan (`payMode`, `transfers`, `weights`, `splitPlan`). An income is active from $0.50 a month and lands
  in `incTo()` (its `to`, else the first spending account). Each item has a bearer, `acct` (whose cost it is), and a
  destination, `destOf()` (the fund account for a yearly item while the fund is on, else `acct`). N_a = `calc().by[a]`
  sums items by destination. Group totals, Honeydue limits, goals, the fund and check-ins don't depend on the mode.
  - Pooled (all active incomes land in one account d, or none is active): move N_a to every other account with
    N_a > 0.5, in `acctOrder`; the rest stays in d. One diagram and one steps list, as in v2.
  - Separate (two or more landing accounts): the Income card shows "Split shared costs" (`#split`, hidden while
    pooled) and the payday card has one block per person with pay, a steps list per income. Weights w_p sum to 1
    when anyone has pay (else all 0): by take-home I_p / ΣI; equally 1 / (people with pay), 0 for the rest; set
    percentages pct_p / Σ pct over current people (scaled, with a note; Σ = 0 means equally). A person's share of
    an item goes by its bearer: σ_p = 1 for their own account, w_p for a shared one (or one whose owner is gone),
    0 for someone else's. O_{p,a} = Σ σ_p·m over items with destination a, so a yearly bill from Alex's own account
    is Alex's alone, though its share goes to the fund. Income i of person p moves T_{i,a} = (I_i / I_p)·O_{p,a} to
    each account a other than its landing account d (shown if > 0.5); of the rest, (I_i / I_p)·O_{p,d} is planned.
    L_p = I_p − Σ_a O_{p,a}. Warnings: L_p < −0.5 ("<Name>’s share is $X more than <Name>’s pay"; for someone with
    no pay, their share of shared items), and an account owned by someone with no pay whose items total > 0.5
    ("Nobody’s pay covers <account> ($X)…"): flagged, not quietly paid from shared money.
- Tour: `household-budget-planner:tour-seen` in localStorage, per device, not exported.

## How the UI code works

- `renderAll()` rebuilds everything; use it for structural changes (add/remove a line, switch scenario).
- `refresh()` updates only derived numbers, the summary and the side column, so inputs keep focus
  while typing. Prefer it for value edits. It rebuilds the side column every time, so **inputs belong
  in the editor column** (check-in, categories and yearly cards live there); the side column is read-only.
- Editor cards, top to bottom: check-in, income, necessities, savings, variable, Honeydue categories,
  yearly costs, accounts. Every card has a `data-tour` attribute the tour points at.
- `window.__hbp` exposes read-only helpers (migration, month maths, statuses, projection) for the tests.
- Events are delegated on `#root`: inputs carry `data-scope` / `data-id` / `data-field`, buttons carry `data-act`.
- Destructive actions use a click-twice confirm, not `confirm()`.
- Scenarios are managed from the tab row: "+ New scenario" (blank: no incomes or lines), "+ Copy this scenario",
  and a × on each tab that deletes that scenario (click twice; hidden when only one is left).

## Design

Utilitarian planning tool. Fonts: Bricolage Grotesque (headings), Public Sans (body), tabular numbers.
Group colors: necessities `--need` (indigo), savings `--save` (teal), variable `--want` (plum);
semantic `--ok` / `--warn` / `--bad` are separate from those. Every color goes through the tokens,
and both themes must stay legible. Phone layout breakpoint is 680px; check at ~390px wide.
Keep visible focus states and respect `prefers-reduced-motion`.

## Testing a change

Start with `node tests/smoke.js [screenshot-dir]`. It serves the repo itself and checks steps 1, 3 and 4
below (for the current data version only), no horizontal scroll at laptop and 390px widths in both themes, and
no console errors; it exits non-zero on failure. It can't judge legibility, so look at the screenshots too.
If you bump `v`, update `DATA_VERSION` in the test and add a check that an older plan file still imports.
Run part of it with `ONLY=checkin,yearly node tests/smoke.js`. Sections that depend on the date fix it
with `openPage({ date: '2026-11-16T12:00' })`. The `bfcache` section launches full Chromium with the
back/forward cache on (Playwright turns it off, and its headless shell has none); without full Chromium
it warns and skips.

1. `python3 -m http.server 8000` in the repo, open http://localhost:8000.
2. Check a laptop width and a phone width (~390px), light and dark.
3. Export a plan, open a fresh browser profile, import it, and confirm the plan comes back intact.
   If the data model changed, also import an older plan file and confirm the migration.
4. Reload with the network off and confirm the app still opens.

## Feature ideas under consideration

Done: monthly check-in (was 1), calendar of yearly costs as part of the yearly-costs fund (was 4).
The in-app tour covers part of idea 3: it explains the app but doesn't collect numbers.

1. Savings projections with interest: B_t = B_0 (1+r)^t + s((1+r)^t − 1)/r at monthly rate r, charted per goal.
2. First-time setup walkthrough that collects income, rent and fixed bills instead of editing examples.
3. Per-paycheck transfers for twice-monthly or biweekly pay.
