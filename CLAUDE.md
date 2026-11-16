# Household Budget Planner

A small installable web app (PWA) for a couple to plan a monthly household budget together:
split take-home pay into necessities, savings and variable spending, see the payday transfers
between accounts, track savings goals, and compare scenarios ("Now" vs "Both working + rent").
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
- `tests/smoke.js`: headless-browser smoke test (Playwright). Not part of the app, so it stays out of `ASSETS`.

## Data model (`state`, v1)

```
{ v: 1, touched, modifiedAt, lastSync: {at, kind: 'export'|'import', by} | null, active,
  accounts: { jchk, mchk, jsav, msav, inv: { name, note } },
  scenarios: [{ id, name, sub, depositTo: 'jchk'|'mchk',
    incomes: [{ id, name, amt }],                       // monthly take-home
    lines:   [{ id, g: 'need'|'save'|'want', name, amt, f: 'mo'|'wk'|'yr', acct,
                goal?: { mode: 'none'|'amount'|'months', amount, months, saved } }] }] }
```

- Saved to `localStorage` key `household-budget-planner:plan:v1` on every edit (debounced).
- Export file: `{ app: 'household-budget-planner', v: 1, exportedAt, exportedBy, state }`, named
  `budget-plan-YYYY-MM-DD.json`. On touch devices it uses the share sheet; otherwise a download.
  Import validates, then asks before replacing the device's plan.
- Monthly conversion: weekly × 52/12, yearly × 1/12. All amounts are after-tax dollars.
- Goal time: months = ceil((goal − saved) / monthly contribution). A "months" goal targets
  N × the scenario's monthly necessities (used for the emergency fund).
- Transfer plan: paychecks land in `depositTo`; every other account receives the sum of lines
  assigned to it; the rest stays in the landing account.

## How the UI code works

- `renderAll()` rebuilds everything; use it for structural changes (add/remove a line, switch scenario).
- `refresh()` updates only derived numbers, the summary and the side column, so inputs keep focus
  while typing. Prefer it for value edits.
- Events are delegated on `#root`: inputs carry `data-scope` / `data-id` / `data-field`, buttons carry `data-act`.
- Destructive actions use a click-twice confirm, not `confirm()`.

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

1. `python3 -m http.server 8000` in the repo, open http://localhost:8000.
2. Check a laptop width and a phone width (~390px), light and dark.
3. Export a plan, open a fresh browser profile, import it, and confirm the plan comes back intact.
   If the data model changed, also import an older plan file and confirm the migration.
4. Reload with the network off and confirm the app still opens.

## Feature ideas under consideration

1. Monthly check-in: enter each category's actual total (from Honeydue) and compare with the plan.
2. Savings projections with interest: B_t = B_0 (1+r)^t + s((1+r)^t − 1)/r at monthly rate r, charted per goal.
3. First-time setup walkthrough (income, rent, fixed bills) instead of editing examples.
4. A calendar of when yearly costs come due.
5. Per-paycheck transfers for twice-monthly or biweekly pay.
