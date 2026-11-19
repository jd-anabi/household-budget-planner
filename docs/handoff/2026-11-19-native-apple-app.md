# Handoff: Household Budget Planner as a native Apple app

**For:** the first Claude Code session of the new SwiftUI project, on the owner's Mac.
**Read this fully before doing anything.** Then start with a design conversation (brainstorming);
don't write code until the owner has approved a design. Section 8 lists the open questions.

**Source of truth for the existing app:** the web app at commit
`c41f4e91c9d199f8188846f972804c7c2f3eb2b4` of https://github.com/jd-anabi/household-budget-planner.
At that commit, read in this order:
- [`CLAUDE.md`](https://github.com/jd-anabi/household-budget-planner/blob/c41f4e91c9d199f8188846f972804c7c2f3eb2b4/CLAUDE.md):
  the data model and every rule, precisely.
- [`index.html`](https://github.com/jd-anabi/household-budget-planner/blob/c41f4e91c9d199f8188846f972804c7c2f3eb2b4/index.html):
  the whole app, plain JavaScript.
- [`tests/smoke.js`](https://github.com/jd-anabi/household-budget-planner/blob/c41f4e91c9d199f8188846f972804c7c2f3eb2b4/tests/smoke.js):
  358 behaviour checks. Many have hand-computed expected values, so they make a good executable spec
  to port into Swift tests.
- `docs/superpowers/specs/`: the three design docs, with the reasoning behind each feature.

The repo is public. Keep it that way only if the owner wants to; the native app's repo should
probably be private.

## 1. What the product is

A planner for a household's monthly money, not a tracker. You enter take-home pay and the
budget items. The app shows:
- the split into necessities, savings and variable spending;
- the payday transfers to set up between accounts;
- savings goals and when they'll be reached;
- the monthly category limits to type into your day-to-day tracking app.

A monthly check-in compares the tracking app's actual totals with the plan. The household can be
one person or several. Pay can be pooled into one account or kept separate, with shared costs split
by a rule.

**Hard lines, carried over:**
- No bank connections and no per-transaction tracking.
- No analytics, no ads, no server of our own, no third-party APIs with user data.
- Nothing the user types leaves their devices except through their own iCloud.

## 2. Decisions already made by the owner

- **SwiftUI, one codebase for iPhone, iPad and Mac.** Windows and Android come later, as a separate
  port.
- **The money rules live in their own Swift package** (no UI, fully unit-tested), so they are the
  portable spec for the later ports.
- **iCloud sharing** so a household (for example a couple) edits one plan from several devices
  and Apple IDs, with no export/import step. No server of our own. Aim for the App Store privacy
  label "Data Not Collected".
- **It's a product for other households, sold on the App Store.** The owner will pay the Apple
  Developer Program fee. The pricing model is still open (§8): paid upfront, or free with a one-time
  unlock.
- **Everything below must be handled, not scoped out:**
  - wording that doesn't assume one tracking app (the web app says "Honeydue" throughout);
  - currency and locale;
  - a first-run setup that collects real numbers instead of editing an example;
  - a privacy policy;
  - accessibility (Dynamic Type, VoiceOver, contrast).
- **The website will be retired eventually.** Existing users move their plan by exporting a plan
  file from the web app and importing it into the native app (§6).
- **The timeline feature (§7) is designed but not built.** It goes into the native app.

## 3. Features today (web app, plan format v4)

- **People:** named household members, any number from 1 up.
- **Accounts:** spending (checking) or savings/investing. Each is Shared or owned by one person.
- **Scenarios:** independent versions of the plan ("Now", "Both working"), shown as tabs. Add, copy
  or delete them. A "Compare scenarios" table sits side by side.
- **Income:** each income has:
  - whose pay it is;
  - which spending account it lands in;
  - a pay schedule: monthly, twice a month, every two weeks or weekly;
  - an amount per paycheck;
  - optionally a known payday and where extra paychecks go.
- **Items** in three groups (necessities, savings, variable): amount, how often (monthly, weekly,
  yearly), and the account it's paid from or saved into.
- **Categories:** items are grouped into the tracking app's categories. The app lists a monthly
  limit per category.
- **Goals on savings items:** a dollar amount, or N months of necessities (emergency fund),
  optionally with a "by" month. Each goal has a status (on track, behind, needs $X/mo more).
- **Yearly-costs fund:** yearly bills get a due month. A twelfth is set aside each month into a
  savings account, with a 12-month projection that warns about shortfalls.
- **Payday transfer plan:**
  - pooled pay gives one list;
  - separate pay gives one list per person, splitting shared costs by take-home, equally, or by
    set percentages;
  - transfers funded by non-monthly pay run twice a month;
  - an extra-paychecks list.
- **Monthly check-in:** actual totals per category versus plan; goal and fund balances (pre-filled
  as "assumed from plan" until edited); history.
- **Summary:** totals, what's left to assign, and a 50/30/20 reference.
- **Sharing:** export/import of a JSON plan file (to be replaced by iCloud sharing).
- **A guided tour, light/dark themes, and a 390px phone layout.**

## 4. The rules (summary; CLAUDE.md has the exact ones)

All amounts are monthly after-tax dollars unless stated.

- **Monthly conversion:** weekly × 52/12, yearly × 1/12.
- **Pay schedules.** `amt` is one paycheck. The monthly take-home counts only the regular
  paychecks: $m = k \cdot \text{amt}$, with $k = 1, 2, 2, 4$ for monthly, twice a month, every two
  weeks and weekly.
  - Extra paychecks are 2 a year for every two weeks (some years 3) and 4 a year for weekly (some
    years 5). They are outside the plan.
  - A month has an extra paycheck when it holds more than $k$ paydays, counting paydays as
    $\text{payday} + j \cdot \text{step}$ for every integer $j$. Do the day arithmetic in UTC.
- **Transfers, pooled pay** (every active income lands in one account $d$): move $N_a$ to each
  other account $a$, where $N_a$ is the monthly total of items sent there. The rest stays in $d$.
- **Transfers, separate pay** (two or more landing accounts). Weights $w_p$:
  - by take-home: $I_p/\sum I$;
  - equally: among people with pay;
  - set percentages: scaled to 100%; a sum of 0 means equally.
- **Whose cost an item is** goes by its *bearer* account, its own `acct`:
  - $\sigma_p = 1$ for p's own account, $w_p$ for a shared one, 0 for someone else's.
  - Its money goes to its *destination*: the fund account for a yearly item while the fund is on,
    else `acct`.
- **Who moves what:**
  - $O_{p,a} = \sum \sigma_p m$ over items with destination $a$.
  - Income $i$ moves $T_{i,a} = (I_i/I_p)\,O_{p,a}$ to every account but its landing account.
  - $L_p = I_p - \sum_a O_{p,a}$.
- **Warnings:**
  - $L_p < -0.5$: "<Name>’s share is $X more than <Name>’s pay".
  - An account owned by someone with no pay whose items total more than $0.50: "Nobody’s pay
    covers <account>".
- **Non-monthly pay in the payday plan:** shown as half of $T$, twice a month, "on the 15th and
  the last day". A month's first regular biweekly paycheck lands by the 14th and the second by
  the 28th. Moves are rounded up to the dollar.
  - Twice-a-month pay: "after paydays".
  - Pooled pay with any non-monthly income stays monthly, "on the last day of the month".
- **Yearly fund:** $c = \sum a_i/12$ over yearly items.
  - Projection: $F_k = B + k c - \sum \text{bills due in months } 1..k$.
  - Shortfall: $S = \max(0, -\min_k F_k)$.
- **Goals:**
  - Target: an amount, or $N \times$ the scenario's monthly necessities.
  - Balance: one number per goal, the latest check-in's balance for that goal (matched by item id,
    then by name), else "saved so far".
  - With a "by" month: on track if $s \ge (G-B)/\text{months left}$.
  - Without one: on track if the balance is at least the planned path since the first check-in.
- **Check-in:**
  - One per month, no back-filling.
  - Planned per category for that month: a dated yearly item counts in full in its due month and
    0 otherwise.
  - Goal and fund rows are pre-filled as $\text{start} + \text{planned} \times \text{months}$ and
    marked assumed until edited.
- **50/30/20 is a reference tick, not a target.**

## 5. Data model (web, v4)

See CLAUDE.md "Data model (`state`, v4)" at the pinned commit for the full shape. In short:
- `people`;
- `accounts` keyed by id, with `kind` and `owner`, plus `acctOrder`;
- `cats`;
- `fund`;
- `checkins`;
- `scenarios`, each with `split`, `incomes` (`who`, `to`, `every`, `payday`, `extraTo`) and
  `lines` (items: `g`, `amt`, `f`, `acct`, `cat`, `due`, `goal`).

The native app should design its own model (SwiftData or Codable; see §8), but it must be able
to **import** every web version (§6).

## 6. Importing web plan files

- **The envelope:** `{ app: 'household-budget-planner', v, exportedAt, exportedBy, state }`.
  Versions 1–4 exist in the wild.
- **The upgrade chain:** v1→v2→v3→v4 (`v1to2`, `v2to3`, `v3to4` in index.html). Each step only
  adds fields.
- **Validation** (`validPlan`) refuses malformed plans instead of half-loading them. Port the same
  strictness, including ids that are `Object.prototype` names and duplicates.
- **Test inputs:** `tests/fixtures/plan-v1.json`, `plan-v2.json` and `plan-v3.json` at the pinned
  commit (generic example data). Import each, and check the numbers match the web app's (the smoke
  tests give expected values).
- **A newer `v` than the app knows is refused**, and never saved over.

## 7. Timeline (designed with the owner, not built)

**Goal:** say when one scenario gives way to another ("Now" until a job starts, then "Both
working"), and have the forward-looking parts account for the switch. The owner chose all of the
following.

- **The base.** A plan-level timeline:
  - "From now: <scenario>", then any number of "From <month>: <scenario>" rows;
  - edited in a Timeline card;
  - a helper that gives the scenario in force for any month;
  - no timeline means everything behaves as before.
- **Check-ins:** starting one defaults to the scenario in force that month; it can still be
  changed. Past check-ins keep their scenario.
- **Goals and the yearly fund across the switch,** when the open scenario is on the timeline:
  - a goal is reached in the first month $t$ with $B_0 + \sum_{k=1}^{t} s_{\sigma(k)} \ge G$, where
    $\sigma(k)$ is the scenario in force in month $k$;
  - "by" dates are judged against that path;
  - the fund projection uses each month's set-aside and bills;
  - a scenario not on the timeline is a pure "what if", judged as if it applied from now on;
  - edge cases: a goal present in only one scenario contributes nothing in the other's months; a
    "months of necessities" target uses the scenario in force at the goal's date, or at the end of
    the 12 months.
- **The year ahead:** a read-only view of the next 12 months.
  - Columns: month, take-home, spending, to savings (savings items plus the fund's set-aside),
    left to assign, notes.
  - Notes cover: a scenario switch, yearly bills due, extra paychecks, and goals reached.
  - On a phone, stacked rows per month.
- **What stays per scenario:** the payday plan, the category limits and the summary keep
  describing the open scenario.

## 8. Open questions for the first design conversation

1. **Storage and sync:**
   - SwiftData with CloudKit;
   - Codable documents synced through CloudKit with `CKShare` for sharing between Apple IDs;
   - or a document-based app in iCloud Drive.

   Sharing a plan between two people is the core requirement. Conflicts happen when both edit at
   once.
2. **Pricing model:** paid upfront, or free with a one-time unlock: a non-consumable in-app purchase,
   which can be shared through Family Sharing. Decide what's free.
3. **Minimum OS versions** (they drive which SwiftUI, SwiftData and Swift Testing features are
   available).
4. **Layout:** an iPhone tab or navigation structure versus a Mac/iPad sidebar; how the "editor"
   and the "results" (transfers, goals, limits) are arranged.
5. **Tracking-app neutral wording.** For example, "Category limits for your tracking app". Decide
   whether to keep Honeydue-specific help.
6. **Currency and locale:** formatting, decimals, and the first-day-of-week/month conventions used
   by pay dates.
7. **First-run setup:** what it asks (people, pay and schedules, rent, fixed bills, accounts) and
   how it hands over to the main screens.
8. **Privacy policy** hosting and text; App Store privacy label; app name and trademark check.
9. **Testing:** Swift Testing for the money package (port the smoke tests' expected values); UI
   tests for key flows; CI.
10. **Order of work.** A sensible start:
    - the money package and import first, proven against the web fixtures;
    - then the model and sync;
    - then the UI;
    - then the timeline.

## 9. Things learned the hard way (keep doing these)

- **Plan data on people's devices is a contract.** Version it, migrate step by step, back up before
  upgrading, never drop unknown fields, and refuse newer versions instead of overwriting them.
- **Equivalence tests:** after any data-model change, prove an upgraded plan's numbers are
  unchanged.
- **Check numbers by hand** in tests (the smoke tests show many hand-derived values).
- **Never store a value that would fail validation.** A refused plan is worse than an unchanged one.
- **Keep personal details out of a public repo,** including design docs.
