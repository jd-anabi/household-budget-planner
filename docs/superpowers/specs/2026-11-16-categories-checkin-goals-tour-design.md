# Categories, monthly check-in, goal tracking and an in-app tour

Status: approved 2026-11-16 (yearly costs added at approval)

## Why

The app plans a month: it splits take-home pay, shows the payday transfers, and lists the
limits to enter in Honeydue. Honeydue connects to the banks and tracks spending during the
month. Two gaps remain:

1. **There is no reason to come back.** After setting the plan up, nothing in the app answers
   "are we on track this month, and for our goals?"
2. **The hand-off with Honeydue is clumsy.** The app lists one Honeydue limit per budget line,
   and its note tells people to "rename or combine lines to fit" Honeydue's 17 categories.
   Combining lines throws away what the plan needs from each line: how often it is paid and
   which account pays it.
3. **Yearly costs don't fit a monthly plan.** A yearly bill is planned at 1/12 a month, but
   nothing sets that money aside, and it is paid in one lump. The money may be gone when the
   bill arrives, and the bill's month looks like overspending.

The couple using the app also want a guided tour so both of them can learn what each part of
the app shows. The tour should explain the finished app, including everything below.

Honeydue has no public API and no confirmed transaction export, and this app must never connect
to banks or send user data anywhere. So every number that crosses between the two apps is typed
by a person. The design keeps that typing small: about one number per category per month.

## Goals

- **Categories:** group budget lines into the categories used in Honeydue. Categories can be
  added, renamed, deleted and regrouped at any time. The Honeydue limits list adds up the lines
  in each category.
- **Monthly check-in:** once a month, enter each category's actual total (read off Honeydue) and
  each savings goal's balance. See over/under per category, the month's total against plan, and
  whether each goal is on track.
- **Goal tracking:** each goal can optionally have a "by" month. A goal with a date is judged
  against the date; a goal without one is judged against the planned pace.
- **Yearly costs:** each yearly cost can have a due month. Its monthly share is set aside in a
  yearly-costs fund through the payday transfers. The app shows a 12-month calendar of what comes
  due and whether the fund will cover it, and the check-in expects each bill in its due month.
- **Tour:** a step-by-step tour of the finished app, offered once per device and replayable.

## Non-goals

- Bank connections, transaction entry, or anything per-transaction.
- Reminders or notifications (there is no server; the check-in fits an existing routine such as payday).
- Tracking actual income (planned income is used throughout).
- Interest projections and per-paycheck transfers (other ideas in CLAUDE.md, later).
- Yearly costs paid in several instalments (one due month per yearly line; split a cost into two
  lines if needed).
- A data-entry setup wizard. The tour explains; it does not collect numbers.
- Merging two devices' edits. Sync stays "export, then import replaces".

## Anti-goals (failure even if it works)

- A check-in that takes more than a few minutes or asks for more than one number per category.
- Any network request carrying user data.
- An existing plan file or stored plan that stops loading, loses fields, or gets overwritten.
- A tour that gets in the way: it must be skippable at every step and offered only once per device.

## Constraints (from CLAUDE.md and the code)

- Plain ES5-style JavaScript inside the existing IIFE in `index.html`; inline CSS through the
  existing tokens (`--need`, `--save`, `--want`, `--ok`, `--warn`, `--bad`, `--ok-bg`, …) with
  light and dark palettes. No libraries, no build step, no new external loads.
- All new code stays inside `index.html`, so `sw.js` `ASSETS` and `CACHE` do not change.
  Test fixtures under `tests/` are not app files.
- State shape and export format are a contract: bump `v` to 2, migrate v1 on load and on import,
  keep importing v1 files, never drop fields (including unknown ones).
- `renderSide()` rebuilds the side column on every `refresh()` (every keystroke), so **inputs must
  not live in the side column** (they would lose focus). All new inputs go in the editor column.
  The side column shows results only.
- Events are delegated on `#root` via `data-scope` / `data-id` / `data-field` and `data-act`.
  Value edits call `changed()` + `refresh()`; structural changes re-render.
- Destructive actions use the click-twice pattern, not `confirm()`/`prompt()`.
- Phone breakpoint 680px, check at 390px; visible focus states; respect `prefers-reduced-motion`.

## Approaches considered

**Tour** (picked by the user: 1)

1. **Highlight plus a caption bar pinned to the bottom.** Each step scrolls one part into view,
   dims the rest and outlines the part; the explanation sits in a fixed bar at the bottom with
   Back / Next / Close and "3 of 16". Same on phone and laptop. No positioning math.
2. Speech bubbles anchored next to each part. More polished on a laptop, but placement around
   tall sections and screen edges is the riskiest code, and on a phone they would collapse into
   a bottom bar anyway.
3. An "explain mode" that shows a note on every section. Simplest, but not a tour.

**Categories** (builder's call, recorded here)

1. **A plan-level list of categories with ids; lines point to a category id (picked).** Renaming
   happens in one place, which is what "change them at a whim" needs.
2. A free-text category label on each line. Renaming means editing every line, and a typo silently
   creates a new category.
3. Separate category lists per scenario. Honeydue has one set of categories for the household, so
   per-scenario lists would drift apart.

**Where check-ins are stored** (builder's call)

1. **In the plan state, so they are exported and imported (picked).** Both partners see the history.
2. Device-only storage. The other partner would never see a check-in.

**Where the check-in lives in the UI** (builder's call)

1. **A card at the top of the editor column (picked).** It is the first thing below the summary,
   it reuses the existing card/input patterns, and it is reachable by the tour without switching views.
2. A separate view or tab. Needs view switching, and the tour would have to cross views.
3. A modal. Hides the plan while entering numbers, and adds focus-trap code beyond the tour's.

**Yearly costs** (the user asked for something to deal with them and left the approach to the builder)

1. **A yearly-costs fund (picked).** Each yearly cost gets an optional due month. Its 1/12 share
   moves each payday into a fund account through the existing transfer plan. The app projects the
   fund 12 months ahead and warns, with a top-up amount, if a bill would come due before enough is
   saved. The check-in expects the full bill in its due month. This fixes both the cash problem and
   the misleading month.
2. Due months only. The check-in and the calendar become accurate, but nothing sets the money
   aside, so the bill can still find the account empty.
3. A dated savings goal per yearly bill. Works with the new goal dates, but counts each cost twice
   (as spending and as saving) unless the spending line is removed, and every bill needs manual setup.

## Decided by the user

- No bank connections, ever.
- Categories are worked out in the app and can be changed at any time.
- The check-in exists to answer "are we on track for the month and for our goals?"
- Goals: a date is optional per goal; goals with a date are judged against it, goals without against the planned pace.
- The tour is a tour of what the app shows (not a setup wizard), covers the finished app, and uses approach 1.
- Ship to `main` (the live site) when done and tested, without waiting for another sign-off.
- Yearly costs need handling; the approach (the fund above) was left to the builder.
- The design was approved on 2026-11-16, with yearly costs added at approval.

## Design

### 1. Data model v2

New and changed fields only; everything in v1 stays as it is.

```
state (v2) = v1 fields + {
  v: 2,
  cats: [{ id, name }],                // Honeydue categories, shared by all scenarios, in display order
  checkins: [CheckIn],                 // sorted by month ascending; at most one per month
  fund: { acct, saved }                // yearly-costs fund. acct: '' (off) | 'jsav' | 'msav' | 'inv'
                                       // saved: fund balance, used only while no check-in has fund data
}
need/want line: + cat: '' | catId      // '' = not in a category
                + due: 0..12           // month a yearly line is paid (1 = Jan); 0 = spread through the year
                                       // (kept but ignored while the line isn't yearly)
savings line goal: + by: '' | 'YYYY-MM' // reach the target by the end of this month

CheckIn = {
  month: 'YYYY-MM',
  scn: scenarioId, scnName,            // which scenario it was compared with (name snapshot)
  startedAt, by,                       // timestamp; device name from the sharing card, may be ''
  spend: [{ key, name, planned, actual, note }],
      // key: catId | 'line:' + lineId (a line not in a category) | 'other'
      // name, planned, note: snapshots taken when the check-in starts
      // actual: number, or null when not entered yet
      // note: '' or text about yearly costs in the row, e.g. "includes Car registration, $600, due this month"
  goals: [{ line, name, acct, target, planned, months, start, balance, assumed }]
      // line: goal line id; name/acct/target/planned: snapshots
      // months: how many months this check-in covers (see section 3)
      // start: the goal's balance before this check-in (fixed once the check-in exists)
      // balance: balance at the end of `month`
      // assumed: true while the balance is the plan-based pre-fill; false once a person edits it
  fund: null | { acct, planned, due, months, start, balance, assumed }
      // null when the fund is off. planned: monthly set-aside snapshot;
      // due: total of dated yearly bills due in the months this check-in covers;
      // months/start/balance/assumed: as for goals
}
```

A goal's **current balance** is the `balance` in the latest check-in that includes it. Only a goal
with no check-in uses `goal.saved`. Check-ins never rewrite or delete `goal.saved` (section 3).

Naming of the storage key stays `household-budget-planner:plan:v1` (it is an address, not a
version; renaming it would mean moving data).

**Migration v1 → v2** (one function, used on load and on import):
`v = 2`, `cats = []`, `checkins = []`, `fund = { acct: '', saved: 0 }` (off), every need/want
line gets `cat: ''` and `due: 0`, every goal gets `by: ''`. Unknown fields are kept. Migrated v1
plans therefore look and transfer exactly like today until the user creates categories or turns
the fund on.

**Safety:**
- **Rollback guard, shipped first.** Today's app accepts only `v === 1`. Given a v2 plan, it shows
  the example plan and overwrites the stored plan on the first edit, tab click or export. So the
  first commit is a small change to the *v1* app, still on data version 1: if the stored plan or
  an imported file has `v > 1`, it shows "This plan was saved by a newer version of the app.
  Reload while online to update." and never persists until reload. The v2 commits go on top of it.
  A rollback is then a plain revert of the v2 commits, which lands on the guarded v1 app, so no
  device overwrites a v2 plan.
- Before migrating a stored v1 plan, copy the raw stored JSON to
  `household-budget-planner:plan:v1-backup` (only if that key is empty). This protects against a
  bug in the migration itself. Restoring from it is manual (by a person or a later release); no
  code reads it for now.
- In the v2 app, a stored plan or an imported file with `v` greater than 2 is never replaced or overwritten.
  On load: show an error banner ("This plan was saved by a newer version of the app. Reload while
  online to update.") and do not persist anything until reload. On import: reject the file with
  the same message instead of "That file isn't a budget plan file."
- Export writes `{ app, v: 2, exportedAt, exportedBy, state }`.

**Example plan (`defaults()`):** add about six generic categories (for example "Bills &
utilities", "Groceries", "Transportation", "Eating out & fun", "Personal", "Gifts") with the
example lines assigned, so the categories card, Honeydue list and tour have something to show.
Give the example move-in fund a "by" date 12 months after today (computed at creation). Give the
example yearly lines due months (car registration: March; gifts & holidays: December) and turn the
fund on into Joint savings with $0 saved, so the yearly-costs card shows a realistic first-year
shortfall. No example check-ins. The text stays generic.

### 2. Categories

**Editor column card "Honeydue categories"**, placed after Variable and before Accounts:

```
Honeydue categories                                   6 categories
Group your lines into the categories you use in Honeydue. Change
them any time; the Honeydue limits update as you go.

 [Bills & utilities      ]   $260 / mo   ×
 [Groceries              ]   $600 / mo   ×
 [Eating out & fun       ]   $370 / mo   ×
 + Add category

 Line                                Category
 Utilities (electric, gas, water)    [Bills & utilities ▾]
 Internet                            [Bills & utilities ▾]
 Groceries & household supplies      [Groceries         ▾]
 Gifts & holidays            yearly  [Not in a category ▾]
```

- Category names are text inputs (rename in place). Totals are the sum of `monthly(l)` over the
  active scenario's need/want lines in that category, counted the same way as the Honeydue list
  (so yearly lines are left out while the fund is on).
- "×" deletes a category with click-twice confirm; its lines become "Not in a category".
- "+ Add category" appends "New category" and focuses its name.
- The line list shows every need/want line of the active scenario (savings never have a
  category), with a select: all categories plus "Not in a category". Lines are listed in plan order.
- Categories may mix necessities and variable lines (Honeydue's categories do).
- Empty category names display as "Untitled category" in outputs.

**Side column "Honeydue limits"** becomes per category:
- One row per category (total of its lines, if > $0.50), with its line names underneath in small
  text; then one row per line that is not in a category (as today). Sorted by amount, largest first.
- The note changes to: "Enter these as monthly limits on your Honeydue categories. Group lines
  into categories in the Honeydue categories card. Savings stays out of Honeydue; the transfers
  above handle it."
- "Copy list" text: `Bills & utilities: $260 per month (Utilities, Internet, Phone)`, one per line.
- Yearly lines, fund on: left out of the limits (they are paid from the fund) and listed under
  the table: "Paid from the yearly-costs fund: Car registration $600 (Mar), Gifts & holidays $800
  (Dec). In those months Honeydue will show the category over its limit; that's expected."
  Copy list adds the same sentence at the end.
- Yearly lines, fund off: kept at 1/12 a month, with a note "includes yearly costs at 1/12 a month;
  expect a spike in the month they're paid".

"Copy this scenario" keeps each line's `cat`. Deleting a line needs no category clean-up.

### 3. Monthly check-in

**Editor column card "Monthly check-in"**, first in the editor column (directly under the summary).

States:
- **Due:** neither the previous nor the current calendar month has a check-in. The card shows
  "October check-in" with a "Start" button and a month select (previous month, the default, or
  the current month; never a month at or before the latest check-in, so no back-filling).
  Once the plan has been edited or imported (not on the untouched example plan), the summary's
  status area also shows a chip "October check-in not done".
- **In progress / done:** the latest check-in is shown as a form (below). It is "done" when every
  spend row has an actual; otherwise it shows "3 of 9 entered". (Goal rows always hold a value.)
- **History:** below the form, a list of earlier months ("September · $40 over plan"). Each opens
  the same form for that month (editable). Each month can be deleted with click-twice confirm.

Starting a check-in snapshots the comparison scenario (default: the active scenario; a select on
the card can change it while that check-in is the latest, which re-takes the snapshots and keeps
any actuals whose `key` still exists):
- `spend`: one row per category (even if planned $0), one row per need/want line not in a
  category with planned ≥ $0.50, and one final "Anything else" row (`key: 'other'`, planned $0)
  for spending in Honeydue categories that are not in the plan.
  A row's planned amount for check-in month $M$ is the monthly amounts of its non-yearly lines,
  plus, for each yearly line, its full amount if it is due in $M$, or $1/12$ of it if it has no
  due month (a dated yearly line due in another month adds nothing). This holds whether or not the
  fund is on. Rows with a yearly line get a `note`.
- `goals`: one row per savings line with a goal (mode not 'none').
- `fund`: when the fund is on, one row for the yearly-costs fund (section 5).
- A "Use current plan amounts" link re-takes the planned snapshots for that check-in (actuals kept by key).

```
Monthly check-in · October 2026                Compared with [Now ▾]
Enter each category's October total from Honeydue.

 Category              Planned   Actual        Difference
 Bills & utilities        $260   [   248 ]     $12 under
 Groceries                $600   [   655 ]     $55 over
 Transportation ¹         $750   [   742 ]     $8 under
 Anything else              $0   [    30 ]     $30 over
 Total (4 of 4 entered) $1,610     $1,675      $65 over plan
 ¹ includes Car registration, $600, due this month

 Savings balances at the end of October
 Emergency fund     Joint savings  [ 1,400 ]  planned +$700         On track
 Move-in fund       Joint savings  [   800 ]  planned +$400         Needs $35/mo more to make Nov 2027
 Yearly costs fund  Joint savings  [   117 ]  planned +$117 − $0    Short $700 by Mar 2027
 Joint savings holds $2,317 across these. Check that this matches the account's balance.

 Earlier months:  September · $40 over plan   August · on plan
```

Math (all amounts monthly dollars, rounded to whole dollars for display):
- Per spend row, with planned $p$ and actual $a$: $\Delta = a - p$; "over" if $\Delta > 0.5$
  (`--warn`), "under" if $\Delta < -0.5$ (`--ok`), otherwise "on plan".
- Total: sums over rows **with an actual entered**; the label says how many rows are entered.
- Blank actual = not entered (`null`), not zero.

Goal balances (one stored number per goal, so nothing can drift):
- A goal's current balance is the `balance` in the latest check-in that includes it, matched by
  line id, then by exact name (so a same-named goal in another scenario shows the same real money).
  Only a goal with no check-in uses `goal.saved`.
- The editor's "Saved so far" input shows the current balance. If the goal has a check-in, typing
  there edits that latest check-in's `balance` (and sets `assumed: false`). Otherwise it edits
  `goal.saved` as today.
  When the balance comes from a check-in, the input is labelled "Balance at end of <Mon YYYY>"
  (likewise "In the fund now"), so an edit after a lapse visibly changes that month.
- Re-taking matches typed actuals by key, else by row name, and adds any typed actual whose row is gone
  to "Anything else"; typed goal balances for goals the new scenario lacks are kept.
- Starting a check-in stores, per goal: `start` = the current balance; `months` = months since that
  goal's previous check-in (`monthIndex(month) − monthIndex(previousMonth)`), or, for its first,
  months since the base month (`max(0, monthIndex(month) − monthIndex(previous calendar month))`, so 0
  for last month: "Saved so far" already is last month's closing balance; changed after review);
  `balance` = `start + planned × months`; `assumed: true`. The user corrects only exceptions.
  Assumed balances show "assumed from plan" in the form, and the goal's status chip adds
  "(assumed)" while its current balance is assumed.
- Re-taking snapshots ("Compared with" or "Use current plan amounts") keeps `start` and `months`.
  It re-takes name/acct/target/planned, and recomputes `balance` only for rows still assumed.
- Deleting a check-in needs no restore step: the current balance falls back to the previous
  check-in that includes the goal, or to `goal.saved`.
- Under the goal rows, for each account holding two or more of the goals and the yearly-costs
  fund, show the sum of their balances with "Check that this matches the account's balance."
  No input.

### 4. Goal tracking

`monthIndex('YYYY-MM') = year × 12 + (month − 1)`. Goal target $G$ is computed as today
(`goalTarget`), using the current plan.

**Goal row in the editor** gains an optional date after "Saved so far":
`By [Month ▾] [Year ▾]` with an empty choice meaning "no date" (selects, not `<input type="month">`,
which desktop Safari and Firefox lack). Years: current year to current year + 10.

**Status** (shown in the side column "Savings goals" card as a chip, and on the check-in's goal rows):

Let $B$ be the goal's current balance (section 3) and $m$ the base month: the latest check-in month
that includes this goal; with no check-in, $B$ = `goal.saved` and $m$ = the previous calendar month.
Let $s$ be the current planned monthly amount.

- $B \ge G$: **Reached** (`--ok`).
- **With a date** `by`: $n = \text{monthIndex(by)} - \text{monthIndex}(m)$ contributions remain.
  - $n \le 0$: **Date passed, $\lceil G - B \rceil$ short** (`--bad`).
  - required $r = (G - B)/n$. If $s \ge r - 0.5$: **On track for <by>** (`--ok`).
    Otherwise **Needs $\lceil r - s \rceil$/mo more to make <by>** (`--warn`), plus the date it will
    be reached at the current pace if $s > 0$.
- **Without a date**, once the goal has at least one check-in: expected balance
  $E = \text{start}_1 + \sum_j \text{planned}_j \cdot \text{months}_j$ over that goal's check-ins
  in month order (start₁ from its first check-in). If $B \ge E - 0.5$: **On track** (`--ok`);
  otherwise **$\lceil E - B \rceil$ behind plan** (`--warn`). Keep the existing "about N months,
  around <date>" projection line.
- **Without a date and no check-ins yet:** no chip; the projection line as today.
- If a "months of necessities" target $G$ changed since the goal's latest check-in snapshot
  (`target`), add "Target changed from $X to $Y" to the goal's sub-line.

Goal identity across check-ins is the line id. If the compared scenario changes, goals are matched
to earlier check-ins by line id first, then by exact name.

### 5. Yearly costs

**Editor column card "Yearly costs"**, placed after Honeydue categories:

```
Yearly costs                                              $117 / mo
Set aside each month in [Joint savings ▾]     In the fund now [$     0 ]

 Item                               Per year   Paid in
 Car registration & maintenance        $600    [March                  ▾]
 Gifts & holidays                      $800    [December               ▾]
 To add one, add a line in Necessities or Variable and set How often to yearly.

 Next 12 months                                               Fund after
 Dec 2026  Gifts & holidays $800 · move it to Joint checking      −$567
 Mar 2027  Car registration $600 · move it to Joint checking      −$817
 Short $817 by Mar 2027. Put $817 in the fund now to cover every bill,
 or expect to pay part of them from checking. (A new fund takes a year to build up.)
```
(Sketch values are for 16 Nov 2026: base month October 2026, $B = 0$, $c = 1400/12$.)

- Lists every need/want line of the active scenario with `f === 'yr'`. "Paid in" is a select:
  January to December, or "Spread through the year" (`due: 0`, e.g. car maintenance).
- "Set aside each month in" is a select of the savings accounts plus "Don't set money aside"
  (`fund.acct = ''`).
- "In the fund now" shows the fund's current balance, under the same one-number rule as goals:
  the `fund.balance` of the latest check-in with fund data, else `fund.saved`. Typing there edits
  that check-in's balance (setting `assumed: false`), else `fund.saved`.
- Monthly set-aside $c = \sum a_i / 12$ over the scenario's yearly lines (dated and spread), where
  $a_i$ is the yearly amount.

**Transfers (fund on):** in the transfer calculation, each yearly line's monthly share goes to
`fund.acct` instead of its "Paid from" account. The step for that account reads
"… + yearly costs fund $117". Group totals, the summary and 50/30/20 are unchanged: yearly lines
stay necessities or variable spending. When a bill is due, it is paid from the line's "Paid from"
account, so the calendar says "move it to <Paid from account>" for that month.

**Projection (fund on):** base month $m$ and balance $B$ as for goals (latest check-in with fund
data; otherwise the previous calendar month and `fund.saved`). For $k = 1..12$:
$F_k = B + k\,c - \sum_{j=1}^{k} D(m + j)$, where $D$ of a month is the total of dated yearly
amounts due in that calendar month. Shortfall $S = \max(0, -\min_k F_k)$.
- $S = 0$: "Covered: the fund pays every yearly cost in the next 12 months." (`--ok`)
- $S > 0$: "Short $\lceil S \rceil$ by <month of the minimum>. Put $\lceil S \rceil$ in the fund now
  to cover every bill, or expect to pay part of them from checking." (`--warn`). Add "(A new fund
  takes a year to build up.)" while no check-in has fund data.
- The calendar lists each of the next 12 months that has a dated bill: month, bills, $F_k$
  (negative values in `--warn`).
- Spread-through-the-year lines have no scheduled draw; their share builds a buffer for irregular
  costs. The card says so in one line when there are any.

**Fund off:** the calendar still lists the next 12 months' bills (without balances), with the
line "These are paid from checking when due. Choose an account above to set money aside each month."

**Savings goals card (side column):** when the fund is on, its first row is "Yearly costs fund"
with its balance and the status chip above.

**Check-in (fund on):** one "Yearly costs fund" row in "Savings balances": `start` = current fund
balance; `months` = months since the previous check-in with fund data, or for the first one months
since the base month (0 for last month); `planned` = $c$;
`due` = total of dated bills due in the covered months; pre-filled
`balance = max(0, start + planned × months − due)` (a bill bigger than the fund empties it; checking
pays the rest), `assumed: true`. Re-taking snapshots and deleting work as for goals; a re-take keeps
the row's `start` and `months` and recounts `due` over those months.

### 6. Tour

**Entry points:**
- First open on a device (no `household-budget-planner:tour-seen` in localStorage): an info banner
  in the existing `#banner` slot: "New here? Take a 2-minute tour of what each part shows."
  [Start tour] [Not now]. Either button sets `tour-seen`. An import banner takes precedence.
- A "Tour" button in the header actions, always available.

`tour-seen` is per device, outside the plan state (not exported).

**Behaviour:**
- Steps follow the page's order. A step whose target is missing is skipped.
  1. Welcome (no target): the app plans the month; Honeydue tracks it.
  2. Scenarios tabs · 3. Summary · 4. Monthly check-in · 5. Income · 6. Necessities ·
  7. Savings (goals, optional date) · 8. Variable · 9. Honeydue categories · 10. Yearly costs ·
  11. Accounts · 12. Payday transfer plan · 13. Savings goals (status chips) ·
  14. Honeydue limits · 15. Compare scenarios · 16. Sharing between devices
  17. Finish (no target): "Replay any time with the Tour button."
  Each step's text says what the part shows and what to do with it, in two or three sentences.
- Highlight: a fixed-position outline box over the target's bounding rectangle with a large
  box-shadow dimming the rest (`0 0 0 100vmax` in a dim token), updated on scroll and resize.
  A transparent full-screen layer under the caption bar blocks clicks on the page.
- Caption bar: fixed to the bottom, full width on phones, max ~640px centred on laptops.
  Title, text, "n of N", Back, Next (Finish on the last step), Close. `role="dialog"`,
  `aria-modal="true"`, `aria-labelledby` the title; focus moves into it at start and returns to
  the Tour button (or the banner's place) at the end; Tab stays inside it; Esc closes;
  Left/Right arrows go back/next.
- Scrolling: `scrollIntoView({ block: 'start' })` with a small top margin; smooth only when
  `prefers-reduced-motion` is not set. While the tour runs, add bottom padding to the page equal to
  the caption bar's height so the last sections can scroll above it.
- The tour never changes plan data and works on whatever plan is loaded.
- New colours (dim layer, outline) are tokens with light and dark values.

### 7. Copy changes

- Honeydue limits note (section 2).
- Summary "Starting amounts are examples" note unchanged.
- CLAUDE.md: data model v2, the backup key, the tour key, the check-in and categories cards; mark
  feature ideas 1, 3 and 4 as done; README features list gains categories, check-in and the tour.

## Testing

At the rollback-guard commit (still v1): put a `v: 2` plan in localStorage, load, check the
newer-version banner, make an edit, and check the stored plan is byte-for-byte unchanged; importing
a `v: 2` file shows the newer-version message. Keep this check runnable later against that commit.

Extend `tests/smoke.js` (keep it dependency-free):
- `DATA_VERSION = 2`.
- Commit `tests/fixtures/plan-v1.json`: a v1 export of the current example plan (generic data).
  Import it into a fresh profile and check: plan accepted, `v` = 2, every line kept with its fields,
  `cats` and `checkins` empty, need/want lines have `cat: ''`.
- Load path migration: put the fixture's state in localStorage under the plan key, load, check
  migration and that `…:plan:v1-backup` holds the original.
- A file with `v: 3` is rejected with the newer-version message.
- Categories: rename a category and check the Honeydue list shows the new name and summed total.
- Check-in: start, check goal balances are pre-filled as assumed; enter actuals and correct one
  goal balance; reload, values kept; "Saved so far" shows the corrected balance. Start the next
  month and check its `start` equals the previous balance (no drift). Delete it and check the
  balance falls back.
- Goal date: set a date that is unreachable at the planned amount and check the "Needs … more" chip.
- Yearly costs: in the example plan (fund on, $0 saved, $600 due in March and $800 in December),
  check the transfer step to Joint savings includes the fund's $117, the Honeydue list leaves the
  two yearly lines out and names them in its note, and the shortfall equals the value computed in
  the test from $F_k$ for today's date. Turn the fund off and check transfers and the Honeydue list
  match today's app. In a check-in for a bill's due month, that row's planned amount includes the
  full bill.
- Tour: start from the Tour button, step to the end, check every step had a visible target or was a
  no-target step, close, focus returns to the Tour button; no console errors.
- Existing checks (offline, widths, themes, export/import round trip) keep passing.

Manual: look at the screenshots (laptop and phone, light and dark) for legibility of the new cards,
chips and the tour.

## Calls made without the user (check these)

- Categories are one list for the whole plan, edited in a card in the main column; lines are
  assigned there, not in each line's row.
- Check-ins are stored in the plan file, so both partners see them after export and import.
- The check-in card sits at the top of the main column. One check-in per month, no back-filling.
- Savings balances in a check-in start as "assumed from plan"; you correct only what differs.
- A goal's balance is shared by same-named goals across scenarios (it's the same money).
- An "Anything else" row catches spending in Honeydue categories that aren't in the plan.
- Yearly costs: each gets a due month; a yearly-costs fund sets aside the monthly share through
  the payday transfers and warns, with a one-time top-up, if a bill would come before the fund has
  enough. With the fund on, the Honeydue limits leave yearly costs out. The fund starts off for
  existing plans (their transfers don't change until you turn it on) and on in the example plan.
- The example plan gains example categories and a dated move-in goal.
- A rollback guard ships first; a backup of the pre-update plan is kept on each device.

## Left to the builder

Exact copy, spacing and styling within the tokens; code structure inside the IIFE; how the tour
overlay is updated on scroll; ids and helper names; order of implementation and commits.
