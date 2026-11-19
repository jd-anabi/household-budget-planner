# Pay schedules: paychecks twice a month, every two weeks or weekly (data model v4)

Status: approved 2026-11-19

## Why

Every amount in the app is monthly. That fits one earner, who is paid once a month. Another earner's
pay schedule isn't known yet, so the app assumes the most common US schedule, every two weeks: in BLS
data, 63.6% of education and health employers pay biweekly, 18.4% twice a month, 9.9% weekly and 8.1%
monthly. Hourly and shift-based paychecks also vary, with differentials and overtime.

Two things break with non-monthly pay today:
- Someone paid every two weeks would have to type a monthly figure the app never sees on a pay stub.
- The payday plan says "Set these up as recurring transfers" but gives monthly amounts.

Where pay lands (joint, or each person's own account then moved over) is undecided. That is
already handled by v3 ("lands in" per income, pooled or separate payday plan), so this piece is
only about **how often** pay arrives.

This is piece 1 of the three the user chose: pay schedules, then planned changes over time, then
interest on savings.

## Goals

- Each income has a pay schedule: monthly, twice a month, every two weeks, or weekly. Its amount is
  entered per paycheck (for monthly, that is the monthly amount, as today).
- **Budget on the paychecks every month has** (the user picked this, "approach B"). Every month's
  plan counts the regular paychecks (1, 2, 2 and 4 respectively), so monthly bills are never short.
  The extra paychecks (two a year with pay every two weeks, usually four with weekly pay) are shown
  separately, with the months they fall in and where each should go.
- The payday plan says how often to set each transfer up and for how much.

## Non-goals

- Paychecks that vary. One typical amount per income; overtime and extra shifts are extra on top.
- Exact paydays for monthly or twice-a-month pay (they don't change the plan).
- Income tracking or a payday calendar beyond the next 12 months' extra paychecks.
- Netting a person's transfers across their own incomes (raised in the v3 final review; revisit if
  anyone has two incomes landing in different accounts).
- Counting extra paychecks in goal projections, the yearly-costs fund or 50/30/20. They stay out
  of the monthly plan; a check-in sees them anyway, as higher balances.
- Changing how pooled transfers are worked out.

## Anti-goals (failure even if it works)

- An upgraded v3 plan whose numbers change in any way before someone edits it.
- A plan that tells a person paid every two weeks to set up a transfer that fires on every paycheck.
  That would be 26 transfers a year, the approach the user rejected.
- Joint checking coming up short in a two-paycheck month.

## Constraints

As for v3 (CLAUDE.md, and the v3 design's Constraints):
- plain ES5 in the IIFE; tokens; both themes; 390px; inputs only in the editor column;
- delegated events; click-twice for destructive actions;
- no new app files, so `sw.js` is unchanged;
- bump `v` to 4 and migrate v1/v2/v3 on load and import;
- back up a stored v3 plan to `…:plan:v3-backup` before upgrading;
- the v3 app already refuses `v > 3`, so a rollback is safe.

## Approaches considered (for extra paychecks; the user picked B)

- **A. The same amount from every paycheck.** Each paycheck moves $\tfrac{12}{26}T$ of a monthly
  transfer $T$. Exact over a year, and one fixed transfer at the bank. But ten months a year joint
  receives $\tfrac{12}{13}T$ (7.7% short), and a run of two-paycheck months leaves it up to about
  $\tfrac{5}{13}T$ behind.
- **B. Budget on the paychecks every month has; the rest are extra (picked).** Every month gets
  exactly $T$, and a person's budgeted income is counted conservatively, which matters while
  paychecks vary. The extra paychecks become a deliberate boost to savings.

## Decided by the user

- Assume the most common schedule, every two weeks, for the not-yet-known job. Let any income be set to any of the four schedules.
- One earner's pay is monthly.
- Approach B.
- Where pay lands may change (joint, or own account then moved). v3 already covers this, and
  nothing here may assume one way.

## Design

### 1. Data model v4

```
income (v4) = v3 income + {
  every:   'mo' | 'semi' | 'biwk' | 'wk',   // monthly, twice a month, every two weeks, weekly
  payday:  '' | 'YYYY-MM-DD',               // any one known payday; used only by 'biwk' and 'wk'
  extraTo: '' | acctId                      // where extra paychecks go; '' = leave them where they land
}
amt: the amount of ONE paycheck (for 'mo' this is the monthly amount, exactly as before)
```

Pay schedule table (`PAY`):

| every | label | regular paychecks a month $k$ | extra paychecks a year | step |
|---|---|---|---|---|
| `mo` | Monthly | 1 | 0 | – |
| `semi` | Twice a month | 2 | 0 | – |
| `biwk` | Every two weeks | 2 | 2 (some years 3) | 14 days |
| `wk` | Weekly | 4 | 4 (some years 5) | 7 days |

- **Budgeted monthly income** of income $x$: $m(x) = k \cdot \text{amt}$. Every place that now reads
  `n(x.amt)` as monthly take-home reads $m(x)$ instead: `calc().I`, `isActive` (active if
  $m(x) \ge 0.5$), `payBy`, `splitPlan`'s $I_i$, the People card meta, and the scenario tab and
  compare figures.
- **Migration v3 → v4** (`v3to4`, chained after `v2to3`, on load and on import): every income gets
  `every: 'mo'`, `payday: ''`, `extraTo: ''`, and `v = 4`. With `every: 'mo'`, $m(x)$ equals the old
  `amt`, so every number is unchanged. Unknown fields are kept.
- **Validation:** `every` is one of the four; `payday` is `''` or a real calendar date
  `YYYY-MM-DD`; `extraTo` is `''` or passes `okId`. A dangling `extraTo` (account removed) is shown
  as "Leave it where it lands", and nothing is moved.
- **`acctUses`** counts `extraTo` only while the income is `biwk` or `wk`. Otherwise the setting is
  hidden, so an account it names must not be blocked from removal.
- **Never store a value that would fail validation.** The payday input stores its value only when
  it is a real calendar date `YYYY-MM-DD`; anything else (for example a browser that shows the date
  box as plain text) stores `''`. A malformed stored plan is refused and replaced by the example on
  the next load, so this matters.
- **Every income the app creates carries the v4 fields:** `newIncome` gives `every: 'mo'`,
  `payday: ''`, `extraTo: ''`; "+ Copy this scenario" copies them; "+ New scenario" has no incomes.
  The test plans built by hand in `tests/smoke.js` (`minPlan()`, `sepPlan()`, and any other plan
  stamped `v: DATA_VERSION`) gain the fields.
- **The People banner after an upgrade** ("add the people in your household") shows only when the
  plan came from v1 or v2 (stored `from` ≤ 2, or an imported file whose `state.v` ≤ 2). A v3 plan
  upgraded to v4 already has people and gets no banner.
- **Backups:** a stored v3 plan is copied to `household-budget-planner:plan:v3-backup` before
  upgrading, only if that key is empty (the same rule as v1/v2).

### 2. Income card

```
 [Take-home pay      ] [Sam ▾]  [Every two weeks ▾]  $ [ 1,500 ] per paycheck   lands in [Checking · Sam ▾]   ×
     = $3,000 a month (2 paychecks) · a recent payday [2027-01-01]  · extra paychecks go to [Joint savings ▾]
     Use a typical paycheck; overtime and extra shifts come on top.
```

- A "How often" select (`#ie-<incId>`) next to the amount. The amount's label reads "a month" for
  monthly and "per paycheck" otherwise.
- For any non-monthly income, a second line shows "= $X a month (k paychecks)".
- For `biwk` and `wk`, the second line also has:
  - "A recent payday", a date input (`#ip-<incId>`). It is optional; without it the plan says
    "two extra paychecks a year" without months.
  - "Extra paychecks go to", a select (`#ix-<incId>`) offering "Leave it where it lands" plus every
    account, grouped by owner. When an income is first switched to `biwk`/`wk` with
    `extraTo === ''`, it defaults to the first Shared savings account, else the person's own first
    savings account, else `''`.
  - The hint "Use a typical paycheck; overtime and extra shifts come on top."
- Changing "How often" re-renders the editor, with focus on the select. The amount is not
  converted: the user re-reads their pay stub.
- Changing "extra paychecks go to" also re-renders the editor, focus kept, because it changes which
  accounts are in use (as "lands in" does).
- Changing the payday calls `refresh()`.
- On phones the row wraps, with no horizontal scroll at 390px.

### 3. Payday plan

**When to set transfers up.** A transfer is set up at the frequency of the pay that funds it:
- **Monthly income:** once a month (as today).
- **Any other schedule:** **twice a month, half each.** This is B in practice: a bank transfer
  every two weeks would fire 26 times a year (approach A). Twice-a-month transfers fire 24 times,
  matching the 24 regular paychecks, and leave the extra paychecks untouched. Weekly pay uses
  twice a month as well, since weekly transfers would overfund.

**Separate pay** (v3's per-income blocks). For income $i$ with $T_{i,a}$ a month to account $a$:
- monthly: steps as today, under "Once a month";
- otherwise: each step shows $\lceil T_{i,a}/2\rceil$ (the keep: rounded down), under "Twice a month, on the 15th and the last day"
  for every two weeks or weekly (a month's first regular paycheck is in by the 14th, the second by the 28th), or
  "Twice a month, after paydays" for twice a month, with "($X a month)"
  in its why-text. "Keep in …" is shown the same way.

**Pooled pay.** All pay lands in one account, so the transfers out of it stay monthly (one list, as
today). When any active income in the scenario isn't monthly, a note says: "Set these up once a
month, on the last day of the month, after the month’s paychecks have landed."

**Extra paychecks** (a block under the plan, in both modes, when any active income is `biwk`/`wk`):

```
Extra paychecks (not in the monthly plan)
  Sam · Jan 2027, Jul 2027, Dec 2027: move $1,500 each to Joint savings
  (Mar 2027 …) or: "Sam · two a year (add a recent payday to see the months): $1,500 each, left in Checking · Sam"
```

- The months come from `extraMonths(x, fromKey, 12)`. Paydays are `payday + j·step` days for
  every integer $j$, before and after the date given (day arithmetic in UTC, so daylight saving
  can't shift a date). A month in the window `fromKey … fromKey+11` is listed when it holds more
  paydays than $k$ (3 for `biwk`, 5 for `wk`). `fromKey` is the current month. Copy says
  "usually two a year" (or four): some years have three (or five).
- The amount is the whole paycheck (`amt`): under B none of it is in the monthly plan.
- Destination: `extraTo`'s label, or "left in <landing account>" when `''` or dangling.
- If the destination is the landing account itself, it reads "left in <landing account>".

### 4. Other places

- **Summary card:** when the scenario has extra paychecks, one line under the totals:
  "Plus about $X a year in extra paychecks, outside the monthly plan." Here
  $X = \sum_x \text{extra}(x)\cdot\text{amt}$, using the table's usual count (2 or 4).
- **Compare scenarios:** a row "Extra paychecks a year", shown only when some scenario has any.
- **Tour:** the Income step mentions how often pay arrives and extra paychecks; the Payday plan
  step mentions twice-a-month transfers.
- **Example plan:** Sam is paid every two weeks, $1,500 a paycheck, so his budgeted $3,000 a month
  is unchanged. His payday is a Friday near today, computed at creation, and his extra paychecks go
  to Joint savings. Alex stays monthly.
- **Docs:** CLAUDE.md (data model v4, the pay table, budgeting on regular paychecks, the
  twice-a-month rule, extra paychecks, backups, the example); README (features).

## Testing

- `DATA_VERSION = 4`. Add `tests/fixtures/plan-v3.json`: a v3 export of the current example, made
  with the current app before any change, with the clock fixed at 2026-11-01T09:00 (as for the v2
  fixture).
- Migration: v1, v2 and v3 files import as v4. Every income has `every: 'mo'`, `payday: ''`,
  `extraTo: ''`; everything else is deep-equal to the input; the stored-v3 load path writes
  `…:plan:v3-backup`. Equivalence: the payday plan, `calc()` and `splitPlan()` of every upgraded
  scenario are unchanged.
- Guard: a `v: 5` plan is refused.
- Budgeted income: `biwk` with amt 1500 gives `calc().I` contribution 3000; `semi` 1500 gives 3000;
  `wk` 700 gives 2800; `mo` 3000 gives 3000.
- `extraMonths`, hand-checked: payday `2027-01-01` (a Friday), window `2027-01` … `2027-12`:
  - `biwk` gives `['2027-01', '2027-07', '2027-12']` (2027 has 27 such paydays);
  - `wk` gives `['2027-01', '2027-04', '2027-07', '2027-10', '2027-12']`.
- Payday plan, separate mode: a `biwk` income's steps are half the monthly $T_{i,a}$, under "Twice a
  month"; a monthly income's steps are unchanged. Pooled with a `biwk` income: the monthly list is
  unchanged and the note shows.
- Extra paychecks block: with the fixed date 2026-11-16 and payday `2027-01-01`, the listed months
  are the ones in Nov 2026 … Oct 2027 (Jan 2027 and Jul 2027) with the paycheck amount and the
  destination label. Without a payday, the "two a year" wording shows.
- Income row: changing "How often" keeps focus on the select; the amount label switches between
  "a month" and "per paycheck"; there is no horizontal scroll at 390px.
- An account used as `extraTo` by a `biwk`/`wk` income has no ×; switching that income back to
  monthly makes the × reappear.
- A typed non-date in the payday box is stored as `''`, and the plan still loads after a reload.
- A stored v3 plan upgrades without the People banner; a stored v2 plan still shows it.
- Example: Sam is `biwk` with amt 1500, `extraTo` = Joint savings, and a payday.

## Calls made without the user (check these)

- Transfers funded by non-monthly pay are set up twice a month, half each, not per paycheck. That
  makes B work at a real bank.
- Pooled transfers stay monthly; a note says to schedule them after the month's paychecks.
- Extra paychecks default to a Shared savings account (else the person's own), changeable to
  "Leave it where it lands" or any account.
- The amount is entered per paycheck, and switching schedule doesn't convert it.
- Weekly pay budgets on 4 paychecks a month; the rest (usually 4 a year) are extra.
- A payday date is optional; without it the plan gives the count, not the months.
- Extra paychecks stay out of goal projections, the yearly fund and 50/30/20.
- The example's Sam is paid every two weeks ($1,500), so the example's totals don't change.

## Left to the builder

Exact copy and layout within the tokens; helper names beyond `PAY`, `m(x)` (any name) and
`extraMonths`; how the date input looks; commit order.
