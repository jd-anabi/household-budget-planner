# People, accounts, "items", and one generic example (data model v3)

Status: draft for approval, 2026-11-18

## Why

The app assumes a couple: account slots called "My checking" and "My savings", incomes called
"My take-home pay" and "Partner take-home pay", a partner with no account of their own. The
household using it wants it to fit **their own household as it changes**: one person on their
own for a while, two people, or more later. Each person should appear by name, so pay, accounts
and personal spending say whose they are.

How money moves is not settled. Today one person earns. The plan is to pool both paychecks in one
pot when the partner gets a job, "but things can change". So the app must handle pooled pay and
separate pay without asking the household to choose now. A planner is where you'd compare the
two, so both should be expressible as scenarios.

The two example scenarios ("Now", "Both working + rent") are specific to this couple's story.
They should become one generic example that the household replaces with their own scenarios.

This is the first of four pieces, in the order the user chose:

0. **This design:** people, accounts, "items" wording, one generic example.
1. Per-paycheck transfers (biweekly / twice-monthly pay).
2. Planned changes over time (a timeline of scenarios).
3. Interest on savings.

Pieces 1 to 3 get their own designs later. This one shapes data model v3 so that they only add
fields (section 10).

## Goals

- **People:** a People card where the household enters names; add, rename and remove people;
  always at least one ($n \ge 1$).
- **Accounts as a list:** add, rename and remove accounts. Each account is a **spending** account
  (checking) or a **savings** account (savings or investing), and is owned by **Shared** or by one
  person. A person's name shows wherever their accounts appear and updates when they're renamed.
- **Incomes:** each income says whose pay it is and which spending account it lands in.
- **Payday plan:** when every paycheck lands in the same account, it works exactly as today.
  When paychecks land in different accounts, it shows each person's transfers, using a
  per-scenario rule for splitting shared costs, and flags anyone whose share is more than their pay.
- **One generic example scenario** replaces the two current ones.
- **Wording:** the app says "item", never "line".

## Non-goals

- Logins, per-person privacy, or merging two devices' edits (sync stays "export, then import replaces").
- Neutral wording instead of "Honeydue", a currency setting, or a setup wizard. The user scoped
  this to their own household.
- Per-paycheck amounts, a timeline, interest (pieces 1 to 3).
- Tracking who actually paid what. The app is a planner.
- Replacing plans already stored on devices with the new example. They are upgraded, not replaced.
- Changing the device-name field in the sharing card (except its placeholder, section 7).

## Anti-goals (failure even if it works)

- An upgraded plan whose totals, transfers, Honeydue limits, goal statuses, yearly-costs fund or
  check-ins differ from before the upgrade, before anyone edits it. Only labels may change, because
  the owner's name now shows next to an account.
- A stored plan or plan file that stops loading or loses fields.
- Removing a person or an account that silently deletes an income, an item, or check-in history.
- A pooled household having to think about split rules. The split control only appears when
  paychecks land in more than one account.

## Constraints (from CLAUDE.md and the code)

- Plain ES5-style JavaScript in the existing IIFE in `index.html`. Inline CSS through the existing
  tokens, both themes legible. No libraries, no build step, no new external loads.
- No new app files, so `sw.js` `ASSETS` and `CACHE` don't change. Fixtures under `tests/` are not app files.
- The state shape and export format are a contract. Bump `v` to 3, migrate v1 and v2 on load and
  on import, keep importing every older version, never drop fields (unknown ones included).
- The side column is rebuilt on every keystroke (`refresh()`), so **all new inputs go in the
  editor column**. The side column stays read-only.
- Events are delegated on `#root` (`data-scope` / `data-id` / `data-field`, `data-act`).
  Value edits call `changed()` + `refresh()`; structural changes re-render the editor.
- Renaming a person or an account must not cost the input its focus. Selects that show the name
  are updated in place, as `acct` and `cat` renames do today.
- Destructive actions use click-twice, not `confirm()`.
- Phone breakpoint 680px, check at 390px. Visible focus states. Respect `prefers-reduced-motion`.
- Privacy: the example stays generic, and no real names, numbers or bank details are committed.

## Approaches considered

1. **Each income says who earns it and where it lands (picked by the user).** People own accounts,
   each income has a person and a landing account, and the payday maths covers pooled, separate
   and mixed pay. If everything lands in one account it reduces to today's plan. Most work (the
   transfer maths is rewritten), and it is the only option that lets "pooled" and "separate" be
   compared as two scenarios.
2. **Same people and accounts, but one pot per scenario.** Keeps today's single "paychecks land in"
   account per scenario. Smaller, but separate pay can't be planned, and adding it later means
   another change to the plan file format.
3. **Names only (dropped).** Keeps the five fixed account slots and only fills names into labels.
   It can't give a third person their own accounts, so it fails $n \ge 1$.

## Decided by the user

- It's for their own household as it changes. Scope: people and accounts. No Honeydue-neutral
  wording, currency setting or setup wizard.
- Approach 1.
- One very generic example scenario replaces "Now" and "Both working + rent". The household will
  create their own scenarios and delete the example if they want.
- Pooling: planned as one pot once the partner works, but it may change, so both must work.
- After this piece: per-paycheck transfers, then planned changes over time, then interest, in that order.

## Design

### 1. Data model v3

New and changed fields only. Everything in v2 stays as it is.

```
state (v3) = v2 fields + {
  v: 3,
  people: [{ id, name }],               // n ≥ 1, display order
  accounts: { <acctId>: { name, note,   // still an object keyed by id, as in v2
               kind: 'spend' | 'save',  // + spending (checking) or savings/investing
               owner: '' | personId } },// + '' = Shared
  acctOrder: [acctId],                  // + display order of the accounts the app shows
  scenarios[i]: + split: { mode: 'income' | 'equal' | 'custom', pct: { <personId>: number } }
                  depositTo             // kept; v3 reads it only as a fallback (below)
  scenarios[i].incomes[j]: + who: personId, + to: acctId   // whose pay, which spending account it lands in
  fund.acct: '' | the id of any savings account            // was '' | 'jsav' | 'msav' | 'inv'
}
```

- **Account ids.** The v2 ids (`jchk`, `mchk`, `jsav`, `msav`, `inv`) stay as ordinary ids, so no
  item's `acct`, no check-in's `acct` and no `fund.acct` changes. New accounts get `nid()` ids.
  `accounts` stays an object keyed by id so migration only adds fields. `acctOrder` gives the order.
- **Kinds.** `spend`: pays necessities and variable items; paychecks land here. `save`: receives
  savings items and the yearly-costs fund. These replace `SPEND_ACCTS` and `SAVE_ACCTS`.
  An account's kind is chosen when it's created and doesn't change.
- **`depositTo`** is no longer shown. A new income uses it as its landing account only when the
  scenario has no other income to copy from (section 4).
- **`split`** is per scenario, since one scenario may be pooled and another separate. `pct` keeps
  entries for every person ever given one. Entries for people who no longer exist are ignored,
  not deleted.

**Validation** (a malformed plan is refused, not half-loaded, as today). Every id that ends up in
HTML attributes must pass `ID_RE`: people ids, `acctOrder` entries, account keys, income `who` and
`to`, and `pct` keys. Further rules:
- `people` is a non-empty array of objects.
- `acctOrder` is an array.
- Every `acctOrder` entry is a key of `accounts`, with `kind` in {`spend`, `save`}.
- At least one account of each kind exists.
- `fund.acct` is `''` or a savings account in `accounts`.
- `split.mode` is one of the three values.

Dangling references are tolerated and shown gracefully, as `catName` does for categories:
- An owner who no longer exists is treated as Shared.
- An item's or a check-in row's `acct` that no longer exists shows as "Deleted account".
- An income whose `to` isn't a spending account lands in the first spending account.

The app itself never creates dangling references (sections 2 and 3).

### 2. People card

In the editor column, after "Yearly costs" and before "Accounts", with `data-tour="people"`.

```
People                                                     2 people
Who's in the household. Names show on accounts and pay.

 [Alex                  ]  2 accounts · $3,200 take-home here   ×
 [Sam                   ]  1 account · $2,800 take-home here    ×
 + Add person
```

- Name inputs rename in place. Selects and labels that show the name update without re-rendering
  the input being typed in. An empty name displays as "Person N" (N = position).
- The meta text after each name is the builder's call (it may be dropped on phones). The figures
  are the active scenario's.
- "+ Add person" appends "Person N" and focuses its name.
- "×" removes a person, with a click-twice confirm whose second state says what will happen, e.g.
  "Click again: Sam's 1 account becomes shared, Sam's pay moves to Alex". There is no × while only
  one person is left. Removing person $p$:
  - their accounts become Shared (`owner: ''`);
  - every income with `who = p`, in every scenario, moves to the first remaining person (amounts and
    landing accounts unchanged, so no money disappears);
  - their `pct` entries stay stored and are ignored;
  - check-ins don't reference people and are untouched.

### 3. Accounts card

The existing card (`data-tour="accounts"`), now grouped by owner: Shared first, then each person in
People order.

```
Accounts                                         Rename to match your banks
Shared
 [Joint checking   ] [Shared bills        ]  Spending   [Shared ▾]   ×
 [Joint savings    ] [Emergency, vacation ]  Savings    [Shared ▾]
 Alex
 [Checking         ] [Personal spending   ]  Spending   [Alex   ▾]   ×
 Sam
 [Checking         ] [Personal spending   ]  Spending   [Sam    ▾]
 + Add spending account   + Add savings account
```

- Each row: name, note, its kind as text ("Spending" / "Savings"), and an owner select (Shared plus
  each person). Changing the owner moves the row to that group (re-render the editor).
- "+ Add spending account" / "+ Add savings account" add a Shared account named "New checking" /
  "New savings" and focus its name.
- "×" (click twice) appears only when nothing uses the account. "In use" means some item (in any
  scenario) has it as `acct`, some income (in any scenario) has it as `to`, or it is `fund.acct`.
  A used account shows a faint "used by N" in place of the ×. The last spending account and the last
  savings account can never be removed. Check-ins that mention a removed account show "Deleted account".

**How accounts are labelled elsewhere.** Labels appear in item rows, the yearly-costs card, the
payday plan, the goal tags, the Honeydue tags, the check-in tags and the calendar. They show the
account's name with its owner's name, e.g. "Checking · Alex", unless the name already contains the
owner's name (case-insensitive) or the account is Shared. The exact format is the builder's call.
In every account select, options are grouped with `<optgroup>` by owner, so two accounts both
named "Checking" are distinguishable. Item rows offer accounts of the matching kind, as today.

### 4. Income card

The scenario-level "Paychecks are deposited into" select goes away. Each income row becomes:

```
 [Alex's take-home pay ]  [Alex ▾]  $ [ 3,200 ]  lands in [Joint checking ▾]   ×
 [Sam's take-home pay  ]  [Sam  ▾]  $ [ 2,800 ]  lands in [Joint checking ▾]   ×
 + Add income
```

- "Whose" lists the people. "Lands in" lists spending accounts, grouped by owner. On phones the row
  wraps to two lines (layout is the builder's call; no horizontal scroll at 390px).
- **A new income:**
  - `who` = the first person with no income in this scenario, else the first person.
  - `to` = the landing account of the scenario's first income, else `depositTo` if it is a spending
    account, else the first Shared spending account, else the first spending account. So adding an
    income to a pooled scenario keeps it pooled.
  - Name: "Take-home pay" (the builder may personalise it).
- **Pooled vs separate.** Call an income *active* if its amount is ≥ $0.50. The scenario is
  **pooled** when all active incomes land in the same account (or there are none). Otherwise it is
  **separate**. A $0 placeholder income landing elsewhere doesn't make a scenario separate.
- **Split control.** Shown in this card only while the scenario is separate:
  `Split shared costs [In proportion to take-home ▾ | Equally | Set percentages]`. With "Set
  percentages", one % input per person appears, with their sum ("adds up to 90%").

**Weights.** Let $I_p$ be person $p$'s active take-home in this scenario and $E = \{p : I_p > 0\}$
the people with pay in it.
- *In proportion to take-home* (default): $w_p = I_p / \sum_{q} I_q$.
- *Equally:* $w_p = 1/|E|$ for $p \in E$, and $0$ for everyone else. You can't split a bill with
  someone who has no pay in this scenario.
- *Set percentages:* $w_p = \text{pct}_p / \sum_q \text{pct}_q$, over all current people (missing
  entries count as 0). If the sum isn't 100, the card says "Shares are scaled to add up to 100%".
  If the sum is 0, fall back to *equally*.

In every mode $\sum_p w_p = 1$ whenever anyone has pay.

### 5. Payday transfer plan

Notation:
- Active incomes $i$, with amount $I_i$, person $p(i)$ and landing account $d(i)$.
- $I_p = \sum_{i: p(i) = p} I_i$.
- $N_a$ = the monthly amount routed to account $a$. This is `calc().by[a]` exactly as today:
  items by `acct`, and yearly items' share to the fund account while the fund is on.

**Pooled** (one landing account $d$). Exactly today's plan: move $N_a$ to every account
$a \ne d$ in `acctOrder` with $N_a > 0.5$, and keep $I - \sum_{a \ne d} N_a$ in $d$. Today's
diagram, steps and alert are unchanged apart from account labels. A migrated plan is always pooled
(section 8), so its payday plan is identical to v2's.

**Separate** (two or more landing accounts). Each person pays for the accounts they own, plus
their share of the shared ones. Person $p$'s monthly obligation to account $a$ is:

$$
O_{p,a} = \begin{cases} N_a & \text{owner}(a) = p \\ w_p\, N_a & a \text{ is Shared} \\ 0 & \text{owned by someone else} \end{cases}
$$

- A person with several incomes splits their obligations across them in proportion to amount:
  $\alpha_i = I_i / I_{p(i)}$.
- Income $i$ moves $T_{i,a} = \alpha_i\, O_{p(i),a}$ to each account $a \ne d(i)$.
- Of what stays in $d(i)$, $\alpha_i\, O_{p(i),d(i)}$ is planned spending there and the rest is unassigned.
- Person $p$'s leftover is $L_p = I_p - \sum_a O_{p,a}$. If no account is unfunded (below), then
  $\sum_p L_p = I - P$, the household's "left to assign".

The side column shows one block per person who has pay:

```
Alex's pay · $3,200 into Joint checking
  Move to Joint savings          $348   57% of shared savings $610
  Move to Checking · Alex        $150   Alex's own account
  Keep in Joint checking       $2,421   57% of shared spending $2,948 + $739 not assigned yet
Sam's pay · $2,800 into Checking · Sam
  ...
```

(Sketch values are illustrative.) Each block reuses the existing steps list. A per-person diagram
is the builder's call; it must fit 390px. Warnings, in `--bad`:
- **A share bigger than the pay:** $L_p < -0.5$ gives "Alex's share is $X more than Alex's pay.
  Lower some amounts or change the split."
- **An unfunded account:** an account owned by someone with $I_q = 0$ and $N_a > 0.5$. Its money
  isn't covered by anyone: "Nobody's pay covers Checking · Sam ($150): Sam has no take-home in this
  scenario. Move those items to a shared account, or add Sam's pay." Such accounts are flagged,
  not silently paid from shared money.

When there is no active income at all, the plan shows today's "Add income to see the transfer
plan." Group totals, the summary, 50/30/20, Honeydue limits, goals, the yearly-costs fund and
check-ins don't depend on pooled vs separate.

### 6. Wording: "item", not "line"

"Group" already means Necessities / Savings / Variable, and Honeydue categories also group things,
so a single entry like "Rent" is an **item**. The UI already says "Item" and "+ Add savings item".
Replace every user-visible "line" / "lines":
- the Honeydue note ("Group lines into categories…"),
- the yearly-costs note ("add a line in Necessities…"),
- the categories card description and its "Line" column header,
- "Add necessities or variable lines to group them.",
- "No spending lines yet.",
- the categories tour step,
- the README and CLAUDE.md prose.

Code identifiers, `data-scope="line"`, the `lines` field and the `'line:' + id` check-in keys stay
as they are. They are internal or part of the file contract, and renaming them would need a
migration with no visible gain. CLAUDE.md records the rule: "item" on screen, `lines` in data.

### 7. Generic example (`defaults()`)

One scenario replaces "Now" and "Both working + rent":
- `id: 'example'`, name "Example", `sub` "Example numbers: replace them with yours".
- Two people, **Alex** and **Sam** (generic, gender-neutral), each with an income, both landing in
  Joint checking (pooled, split by take-home).
- Accounts:
  - Shared: Joint checking (spending), Joint savings (savings), Retirement / investing (savings).
  - Alex: Checking (spending). Sam: Checking (spending).
- Items: generic versions of today's example. "Rent or mortgage" and the usual bills; groceries;
  transport; insurance; health; "Car registration & maintenance" yearly, due March; an emergency
  fund (6 months of necessities); "Vacation" with an amount goal dated 12 months after today;
  retirement / investing; dining, entertainment, subscriptions, shopping, personal care;
  "Gifts & holidays" yearly, due December; "Personal spending: Alex" and "Personal spending: Sam"
  each paid from that person's Checking; a buffer.
- The same six generic Honeydue categories with items assigned, and the yearly-costs fund on into
  Joint savings with $0, as in v2's example.
- Round, generic amounts. The exact numbers are the builder's call.

The device-name placeholder "e.g. J" becomes a generic one ("e.g. Alex").

This changes what a fresh device and "Reset to example plan" show. Plans already stored keep
their own scenarios (section 8). People, accounts and categories belong to the whole plan, so
deleting the example tab keeps them, ready to rename.

### 8. Upgrade and safety

`migrate(p)` chains: v1 → v2 (the existing step), then v2 → v3. It is used on load and on import,
and works on a copy that only adds fields. **v2 → v3:**
- `people = [{ id: nid(), name: 'Person 1' }]`.
- The five v2 account ids all exist afterwards. A missing one is created with `name` = its id and
  `note: ''`, which is how v2 displayed a missing account. Kinds: `jchk`, `mchk` → `spend`;
  `jsav`, `msav`, `inv` → `save`. Owners: `mchk`, `msav` → Person 1; the rest Shared.
- `acctOrder = ['jchk', 'mchk', 'jsav', 'msav', 'inv']`. Other keys of `accounts`, if any, are kept
  untouched and not shown (v2 never showed them either).
- Every income: `who` = Person 1. `to` = the scenario's `depositTo` if that is `jchk` or `mchk`,
  else `jchk`. Every positive income therefore lands in the same account, so every migrated
  scenario is pooled and its payday plan equals v2's.
- Every scenario: `split = { mode: 'income', pct: {} }`.
- `v = 3`. Unknown fields everywhere are kept.

**Backups.** Before upgrading a stored plan of version $k$ (1 or 2), copy its raw JSON to
`household-budget-planner:plan:v{k}-backup`, only if that key is empty. The v1 key keeps its name,
so existing v1 backups stay where they are. The storage key `…:plan:v1` doesn't change.

**Rollback guard.** Already in place: the v2 app refuses any plan with `v > 2` and never saves over
it. Rolling this piece back is a plain revert. A device back on v2 shows the newer-version banner
and leaves the v3 plan alone. The v3 app keeps the same guard for `v > 3`.

**After an upgrade.** After an upgrade on load, or an import of a v1/v2 file, a one-time info
banner says: "New: add the people in your household. Accounts and pay now say whose they are."
[Go to People] [Dismiss]. "Go to People" scrolls to the People card and focuses the first name.
Banner precedence: newer-version error, then import result, then this, then the tour offer.

### 9. Tour

- Add a "People" step before "Accounts".
- Update these steps:
  - *Scenarios:* drop "after you both work and pay rent"; use a generic example such as "after a
    new job or a move".
  - *Income:* whose pay it is and where it lands.
  - *Payday transfer plan:* one list when pay is pooled, one per person when it isn't.
  - *Categories:* say "items".
- Steps whose target is missing are already skipped.

### 10. Room for pieces 1 to 3 (no fields added now)

- **Per-paycheck transfers** will add a pay schedule to each income. The per-income transfers
  $T_{i,a}$ above are exactly what it divides per paycheck.
- **Planned changes over time** will refer to scenario ids by month. Nothing is needed now.
- **Interest on savings** will add a rate to savings accounts. It needs accounts to have ids and
  be a list, which v3 provides.

Don't add these fields in this piece. Each piece bumps `v` when it ships.

### 11. Docs

- **CLAUDE.md:**
  - data model v3 (people, accounts with kind and owner, `acctOrder`, `split`, income `who`/`to`);
  - the pooled/separate payday rules and weights;
  - the per-version backup keys;
  - the "item" vs `lines` rule;
  - the new example;
  - the People card's place in the editor order;
  - feature ideas reordered as pieces 1 to 3.
- **README:** features (people, accounts, pooled or separate pay) and the payday-plan sentence,
  which today names "joint checking, joint savings, personal savings".

## Testing

Extend `tests/smoke.js` (dependency-free, as now):
- `DATA_VERSION = 3`.
- **Fixtures.** Keep `tests/fixtures/plan-v1.json`. Add `tests/fixtures/plan-v2.json`: a v2 export
  of the current two-scenario example, made with the current app before `defaults()` changes.
  Generic data only.
- **Migration** (import and load path, v1 and v2 fixtures):
  - `v` = 3, one person, the five accounts with the kinds and owners above, `acctOrder` as above,
    every income has `who` = that person and `to` = its scenario's `depositTo`, every scenario has
    `split.mode` `'income'`;
  - everything else deep-equal to the input (v2) or to the v1→v2 result (v1);
  - the stored-v2 load path writes `…:plan:v2-backup`, and the v1 path still writes `…:plan:v1-backup`.
- **Equivalence.** For each scenario of the migrated v2 fixture, the transfer items, amounts and
  "keep" equal the v2 rule computed in the test (sums by `acct`, landing = `depositTo`).
- **Guard:** a `v: 4` file or stored plan is refused with the newer-version message.
- **People:**
  - add a person; rename them while typing and check that an income's "whose" select and the
    account optgroup labels update and the name input keeps focus;
  - remove a person (click twice) and check their accounts become Shared and their incomes move
    to the first person, with the income total unchanged;
  - no × when one person is left.
- **Accounts:**
  - add a spending account and a savings account, rename one, change an owner;
  - an account in use has no ×;
  - the last spending account and the last savings account can't be removed;
  - the fund select lists only savings accounts.
- **Separate mode:**
  - set two incomes to land in different accounts and check the split control appears;
  - *by take-home:* for a Shared account with $N_a$, Alex's transfer is $\frac{I_A}{I_A + I_S} N_a$;
  - *equally:* $N_a/2$;
  - *set percentages* 70/30: $0.7\,N_a$; percentages adding up to 90 show the scaling note;
  - a share bigger than the pay shows the warning;
  - a zero-pay person's own account with items shows the unfunded warning;
  - pointing both incomes at one account again hides the control and restores the pooled plan.
- **Example:** one scenario, two people, pooled.
- **Existing sections:** sections that rely on the old example (categories, check-in, goals,
  yearly, tour, scenarios, resets, …) are updated to the new example's names and numbers. What
  they check stays the same.
- **Wording:** the page's visible text (all cards and tour steps) has no match for `/\blines?\b/i`.
- **Layout and console:** no horizontal scroll at laptop and 390px in both themes, with incomes
  showing four fields and accounts grouped; no console errors.

Manual: look at the screenshots (laptop and phone, light and dark) for the People card, the grouped
Accounts card, the income rows and the per-person payday blocks.

## Calls made without the user (check these)

- On-screen wording is "item" (proposed in conversation; the user didn't object). The `lines`
  field in the plan file keeps its name.
- Accounts keep the names you type. The owner's name is shown with them, and account menus are
  grouped by owner.
- An account's kind (spending or savings) is fixed when it's created.
- An account that's in use can't be removed. Neither can the last spending account or the last
  savings account.
- Removing a person makes their accounts Shared and gives their pay to the first remaining person.
- "Pooled" means every income above $0 lands in the same account. Only then is the split hidden.
- "Equally" splits only among people with pay in that scenario. Percentages that don't add up to
  100 are scaled, with a note.
- In separate mode, an account owned by someone with no pay is flagged, not quietly paid from
  shared money.
- Upgraded plans get one placeholder person, "Person 1", who owns the old "My checking" and
  "My savings" and all incomes. A one-time banner asks for names.
- The People card sits after Yearly costs, before Accounts.
- Example: one scenario "Example", two people "Alex" and "Sam", pooled into Joint checking.

## Left to the builder

Exact copy, layout and styling within the tokens; the account label format; the per-person diagram
(or none) in separate mode; the People card's meta text; example amounts; helper names and code
structure inside the IIFE; order of commits.
