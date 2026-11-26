# Spending from a fund, goals achieved, and the cover-sheet order — design

Status: **approved (2026-11-24); steps 1–5 of §9 done — ready to ship** (step 5: release notes and rollback path in
CHANGELOG). Earlier: steps 1–4 of §9 implemented (step 4: the screens, and the goal progress basis decided
2026-11-25: goals count reserved + spent toward the target, covers lower it, emergency / sinking keep holdings only). Earlier: steps 1–3 of §9 implemented (the spend core; the expense context for the cover sheet;
goals achieved, INV-13, exclusions, the Q6 metrics and the Q8 nudge). Steps 4–5 not built. Step 3 deviations: two
restorations may still add to an achieved goal (the Q4 re-reserve of a cover, resolving a migrated reservation), so INV-13
checks reserve-without-source and incoming reallocate only; `editFund` also refuses a type change for an achieved goal;
`fundSpent` / `fundContributed` value each movement at its own rates (as §3.5 says) — the existing `movementValueInFund`
uses today's rate and is unchanged. Step 2 deviations: the «من الفلوس الحرة الأول» card takes exactly the shortfall (the gate's existing
rule: a cover is exactly what is missing), so only «من صندوق» has an editable total; `paySinkingFund` gets no expense context
(it already spends its own fund and ignores `options.spend`). Decisions: §6 (Q1, Q6, Q8 and §3.3, marked **Decided**). Additional
acceptance criteria: §10 (AC-1 … AC-10). Builds on data v9 (`CURRENCY_AND_FUNDS_DESIGN.md`: account-backed
reservations, INV-5, the cover gate; `RECEIVABLES_DESIGN.md`: the refill offer). All numbers here are made up.

---

## 0. The problem, in numbers

Account «كاش» holds 10,000. The goal «تابلت» has 6,000 reserved on it, so 4,000 is free. The user buys the tablet for
6,000 and records the expense.

| | Today | Wanted |
|---|---|---|
| What the gate sees | balance 4,000, reserved 6,000 → over-reserved by 2,000 | the purchase is the fund's purpose |
| What the sheet does | «العملية دي أكبر من المتاح بـ 2,000» → covers 2,000 from «تابلت» | asks where the 6,000 comes from |
| Result | «تابلت» still holds 4,000; free money 0 | «تابلت» spent 6,000 (achieved); free money still 4,000 |

The cause is structural, not a UI slip. `settle` (operations.ts) only measures the **over-reservation after** the
expense (`shortfallsBetween` → `overReserved`), so free money is always used first by construction, and the sheet can
only ask for the minimum (2,000). There is no notion of "this expense is what the fund was for".

The workaround (release 6,000 by hand, then record the expense) loses the link between the fund and the purchase. The
fund then ends at 0 / 6,000 and looks never started.

---

## 1. Schema — and why this does NOT need data v10

| Change | Stored? | Notes |
|---|---|---|
| `Fund.achievedAt?: string` (ISO) | yes, optional | present = achieved; absent = active (every existing fund). Reopening clears it. |
| `ReservationMovement.kind: 'spend'` | already exists | used today by `paySinkingFund`; now also by expenses. `sourceTransactionId` = the expense. |
| `OpOptions.spend?: { fundId, accountId, amount }[]` | no (an operation input, like `cover`) | "pay this much of the expense from that fund's reservation". |
| `Shortfall.expense?: { amount, freeBefore }` | no (carried by `NeedsCoverError`) | lets the sheet offer "from the fund" vs "free money first". |

**No version bump, no migration.** The v9 bump was needed because older code drops an unknown *collection* on save.
Here:

- Nothing new is a collection. `achievedAt` is an optional field on an existing record.
- Every fund write path spreads the record (`updateFund`, `editFund` → `normalizeFundShape` keep `...rest`), so
  today's v9 code **round-trips** `achievedAt` (verified by reading the code; a test pins it, §7).
- Absent means "not achieved", which is exactly the meaning of every existing fund, so no sub-step is needed.
- `'spend'` movements are already valid v9 data, and v9 code computes reservations from them correctly.
- **After an OTA rollback to v9 code:** achieved funds simply reappear as active (suggestions, NBA). No data loss, no
  money effect, and the next forward update hides them again. That is acceptable, so it doesn't justify a fail-closed
  bump.
- Backups: v9 files from before this release open unchanged. Files with `achievedAt` open in today's v9 app too, which
  ignores the field.

`CURRENT_VERSION` stays 9, and `hasStateShape` / restore checks are unchanged.

**Condition (AC-9).** The no-migration approach holds only if the compatibility tests in §7 pass: `achievedAt` must
survive every write path that touches a fund, plus backup export / restore and a simulated rollback round trip. If any
write path drops it, that path is fixed to spread the record. If that can't be done safely, the design falls back to a
v9 sub-step (or v10) and comes back for approval before going on.

---

## 2. Invariants

| Id | Rule | Where |
|---|---|---|
| INV-5, INV-8 | unchanged; a spend lowers a reservation and the balance by the same amount, so both hold | existing |
| **INV-12** (spend) | for every expense `t`: its `spend` movements (`sourceTransactionId = t.id`) are ≤ 0, all on `t.accountId`, and Σ \|spend\| ≤ `t.amount`. A spend never makes a fund's reservation on an account negative. | `settle` / ops (reject), fuzz after every step |
| **INV-13** (achieved) | an achieved fund receives no new `reserve`, incoming `reallocate`, or `adjust`; it can still lose money (`spend`, `cover`, `release`) and its leftover still follows transfers / exchanges (`follow_*` pairs) | ops (`FUND_ACHIEVED`), fuzz |

**Legacy data, no quarantine.** Today, deleting a sinking payment leaves its `spend` movement behind, pointing at
nothing. INV-12 is therefore checked only for spend movements whose source transaction exists. Dangling legacy spends
stay counted as spent, and nothing rewrites them: rewriting would change fund totals. From this release on, deleting an
expense removes its spend movements (§3.3), so no new dangling ones appear.

---

## 3. Operations and selectors

### 3.1 Spending from a fund when adding an expense (rule 1)

- `addTransaction(expense, options)` with `options.spend = [{ fundId, accountId: expense.accountId, amount }]`. The
  sheet computes `amount = min(expense, reservation(fund, account))` (`planSpend` in cover.ts, shared with the sheet).
- `settle` gains a first stage. It applies the `spend` movements (`kind 'spend'`, `sourceTransactionId`, the expense's
  rate snapshot) **before** measuring shortfalls. Validation: same account, each amount ≤ the fund's reservation there,
  Σ ≤ the expense. Otherwise `FinanceValidationError('SPEND_INVALID')`.
- Only then does the existing gate run. Because the fund's own money was consumed first, a shortfall remains only if
  the expense is larger than (fund spend + free money), and the cover flow asks for that part.
- `paySinkingFund` uses the same stage instead of its own inline spend. Its behaviour is identical (it already spends
  its own fund first).

### 3.2 The gate knows it is an expense (rule 2)

`settle` receives `context: { expense: { accountId, amount } }` from `addTransaction`, `updateTransaction` (expense),
`confirmOccurrence` (expense rules) and `paySinkingFund`. For a `'cover'` shortfall on that account it attaches:

```text
expense.amount     the expense (or the increase of an edited one)
expense.freeBefore max(0, balance − reserved) on that account before the operation
```

So the sheet can offer both ways (§5.2). Other operations (transfers, gold, opening balance, income delete) keep
today's sheet; there "spend" means nothing.

New option shape the sheet sends back:

```text
spend: [{fundId, accountId, amount}]   → 'spend' movements (the purchase was what the fund was for)
cover: [{fundId, accountId, amount}]   → 'cover' movements (borrowed to pay something else; Q4 re-reserve offer applies)
```

The gate accepts any split where spend + cover from funds ≥ the shortfall and ≤ min(expense, Σ reservations on the
account). Whatever is not taken from funds comes from free money.

### 3.3 Editing and deleting an expense that spent fund money (rule 5) — **Decided**

The link is derived: the fund(s) and amounts are the expense's `spend` movements. No counter is stored.

- **Delete:** its `spend` movements are removed in the same patch (tombstones, entity `reservationMovement`), so the
  money goes back to the fund on the same account. INV-5 can't break, because the balance rises by the expense ≥ the
  spend. **Decided:** this restore is automatic, and it applies to **sinking-fund payments too** (`paySinkingFund`
  creates the same `spend` movements). A sinking fund's `nextDueDate` is not moved back (a notice says so). If the
  fund is achieved, it **stays achieved** (AC-5).
- **Cover vs spend on delete (AC-6):** its `cover` movements keep today's behaviour (the one-tap Q4 «رجّع للصناديق؟»
  offer, never automatic). Spend means "the purchase was this fund's purpose", so undoing the purchase returns it; cover
  means "borrowed for something else", so returning it is the user's choice. A mixed expense (spend + cover + free money)
  reverses each part by its own rule in one patch (AC-7).
- **Edit** (amount, date, note, category): remove the old spend movements, then re-apply with the same fund(s): new
  spend = min(new amount, the fund's reservation after removal). Then the normal gate.
- **Edit account:** the fund's reservation is looked up on the new account; if it has none there, the spend becomes 0
  and the sheet says so before saving (§5.1).
- **Edit type** (expense → income or transfer): spend movements are removed.
- **Edit with a different `options.spend`:** the user changed «من صندوق» in the edit sheet, so the new fund applies.

### 3.4 Goal achieved (rule 3)

| Operation | Rules |
|---|---|
| `achieveFund(id, { releaseLeftover })` | goals only (`type 'goal'`, `FUND_NOT_A_GOAL` otherwise); sets `achievedAt = now`. With `releaseLeftover: true` it also releases the fund's remaining reservations, every account, through the existing release path (`release` movements), **in the same patch**. Never released without that flag. Twice = once. |
| `reopenFund(id)` | clears `achievedAt` (AC-3). Released money is not taken back (the user reserves again if wanted). |
| reserve / reallocate-in / editFund cash increase on an achieved fund | refused, `FUND_ACHIEVED` «الهدف ده اتحقق؛ رجّعه هدف مفتوح الأول» |
| leftover of an achieved fund (AC-4) | stays visible (fund detail, «أهداف اتحققت» row, Funds totals) and can be **released** (`withdrawFromFund`, existing) or **reallocated out** to an active fund (`reallocate`, existing; the achieved fund may only be the source). Never moved by itself. |

**Achievement is always explicit (AC-2).** Reaching or passing the target (reservations, spending or both) never sets
`achievedAt`. At most it shows the dismissible Q8 nudge, and only `achieveFund`, called from the user's
«تم الهدف 🎉» confirmation, sets it.

"Links the expenses that achieved it" is derived: the fund's `spend` movements and their `sourceTransactionId`s. No
list is stored, so editing or deleting a purchase updates the achieved summary by itself.

### 3.5 Selectors

```text
isAchieved(f)                      !!f.achievedAt
fundsByPriority(state)             now excludes archived AND achieved  → every rule-4 consumer at once:
                                   suggestAllocation(In) (AssignSheet, receivables Q8 refill), PlanEditorSheet,
                                   planning fund lines, nextActions rules 6–8, homeFunds, analytics fundsProjection,
                                   goals tab active list, review completedFunds
achievedFunds(state)               achieved, newest achievedAt first
fundSpent(state, fundId, to?)      Σ |spend| of the fund, each valued in the fund currency at its own snapshot
fundPurchases(state, fundId)       the expenses its spend movements point at (newest first)
spendOf(state, txId)               the expense's spend movements (for the edit sheet and the row chip)
planSpend(state, fundId, accountId, amount)   min(amount, reservation) — what «من صندوق» will take
fundContributed(state, fundId, month?)   money put in (reserve, adjust in) — the saving metric
fundReserved(state, fundId)              what is still reserved now (Σ net reservations, all accounts)
```

**Three distinct metrics (Q6, decided).** A fund's **contributions** (money put in), **spending** (`spend`), and
**remaining reservations** (what is still set aside) are separate selectors and are shown separately. They are never
netted into one "saved" figure. `cover` and `release` are neither contributions nor spending; they are money taken
back.

MoveMoneySheet's reallocation target list filters out achieved funds explicitly. `reservationsOn` (cover candidates)
keeps achieved funds' leftovers: it is reserved money, and offering it is correct.

**Proof that existing numbers don't move.**
- No existing fund has `achievedAt`, so `fundsByPriority` returns the same list.
- No existing operation passes `options.spend`, so `settle`'s new stage is a no-op and the gate measures exactly what
  it measures today.
- `paySinkingFund`'s spend amounts are identical.

The frozen-oracle report must stay diff 0 (§7).

**Intended behaviour changes on existing data (decided):**
1. §3.3: deleting an expense gives its spend back to the fund. Today this only affects deleted sinking payments.
2. Q6: `spend` no longer lowers a fund's monthly saving pace. Fund status ("behind" / "on track") and the plan's
   "allocated this month" can therefore change in a month that has a sinking payment, compared with today's v9 (not
   with the v7 oracle, which has no spend). The step that makes this change lists every number it moves, from a
   synthetic before/after report.

---

## 4. Interactions

| With | Behaviour |
|---|---|
| **Receivables refill (Q8)** | `receivableRefillSuggestion` → `suggestAllocationIn` → `fundsByPriority`: achieved funds are never proposed. |
| **Transfers / exchanges** | Spend movements are consumed money: they never follow (follow works on net reservations, which already exclude them). An achieved fund's leftover follows like any reservation (`follow_transfer` / `follow_exchange`, INV-13 allows the pairs). |
| **Recurring / processDue** | No fund link on rules in this release (Q7). An automatic expense that would touch reserved money stays blocked as today; confirming it opens the new sheet (§5.2) with both choices. `paySinkingFund` unchanged in behaviour. |
| **Cover gate elsewhere** | Gold purchase, transfer fees, income delete, opening-balance edit: unchanged sheet (cover only). |
| **Plan** | Achieved funds disappear from contribution suggestions and pickers; existing plan lines for them stay as history (shown, not suggested). |
| **Next Best Action** | Rules 6–8 skip achieved funds (via `fundsByPriority`). **Decided (Q8):** a new dismissible action «وصلت لهدف «تابلت»؟» (id `goal-reached-<fundId>`) when an active goal's reservations + spending ≥ target; its button opens the «تم الهدف 🎉» sheet; it never achieves by itself (AC-2). |
| **Backups / restore** | `achievedAt` travels in the fund record. No shape change. Older v9 backups → active funds. |
| **Monthly pace** | `countsAsSaving('spend')` is true today, so spending a goal mid-month makes it look "behind". **Decided (Q6):** `spend` is excluded from the saving pace; contributions, spending and remaining reservations are separate metrics (§3.5). |

---

## 5. UI and Arabic copy

All existing glass components (`FormSheet`, `Chip`/`ChipRow`, `Card subtle`, `ListRow`, `StatusChip`, `InsightCard`),
RTL, no new colours.

### 5.1 Expense sheet — «من صندوق» (rule 1, AC-1)

- **The primary entry point for intentional fund spending (AC-1):** shown whenever the expense's account has
  reservations, **including when free money is enough** and no cover would be asked. The cover sheet (§5.2) is only a
  second chance for an expense that is bigger than the free money.
- Shown only for **مصروف**, under the account line, when the selected account has reservations
  (`reservationsOn(state, accountId)`). Hidden otherwise (no empty control).
- A chip row: «من صندوق:» [بدون] [تابلت · ج.م 6,000] [طوارئ · ج.م 2,000] … Default «بدون» for a new expense; the existing
  fund for an edit.
- A live line under it:
  - full: «هيتصرف ج.م 6,000 من «تابلت»، وفلوسك الحرة مش هتتلمس.»
  - partial: «ج.م 5,000 من «تابلت» (كل اللي فيه) و ج.م 1,000 من الفلوس الحرة.»
  - edit after an account change with no reservation there: ««تابلت» مالوش فلوس في الحساب ده؛ المصروف هيتدفع من الفلوس الحرة.»
- Changing the account resets the chip to «بدون» unless the same fund has money there.
- Transaction row chip: «من صندوق: تابلت». Delete confirmation adds «الـ ج.م 6,000 هيرجعوا لصندوق «تابلت»».

### 5.2 CoverRequestSheet for an expense (rule 2) — the exact change

**Today:** title «محتاج تغطية»; «العملية دي أكبر من المتاح في «كاش» بـ 2,000» + fund chips; covers exactly the minimum.
Free money is already gone by the time the sheet speaks.

**New, for a `'cover'` shortfall that carries `expense`:**

- Title «تدفعه منين؟»; header line «المصروف ج.م 6,000 والفلوس الحرة في «كاش» ج.م 4,000 بس.»
- **Two choice cards, neither preselected (Q1, decided).** «تأكيد» stays disabled until one is chosen.
  1. **«من صندوق»** — «اصرف من فلوس صندوق كنت محوّش لها.»
     - Fund chips with editable amounts, prefilled only when exactly one fund on the account holds ≥ the expense (that
       fund, the full expense).
     - Live result: «من «تابلت» ج.م 6,000 · من الفلوس الحرة ج.م 0 · فلوسك الحرة هتفضل ج.م 4,000.»
     - Saved as **`spend`** movements (counts toward the goal; deleting the expense gives it back).
  2. **«من الفلوس الحرة الأول»** — «ادفع بالفلوس الحرة، والباقي سلفة من صندوق.»
     - Shows «ج.م 4,000 من الفلوس الحرة + ج.م 2,000 من:» with today's chips (lowest priority first, editable).
     - Live result: «فلوسك الحرة هتبقى صفر، و«تابلت» هيفضل فيه ج.م 4,000.»
     - Saved as **`cover`** movements (today's semantics; Q4 offer on delete).
- Inside either card, the fund amounts are editable between the minimum (the shortfall, 2,000) and the maximum
  (min(expense, Σ reservations)); the free-money part is shown as the rest, never typed.
- If even all funds can't pay it: the overdraft line (today's `negative` card) is added under the cards, one sheet as today.
- «إلغاء» changes nothing.

**Why no default.** The two choices leave different numbers: free money 4,000 vs 0, and the fund at 0 vs 4,000. The
sheet only appears when an expense is bigger than the free money, which is rare and significant. One explicit tap
costs less than a silent wrong guess, and a silent wrong guess is exactly the bug this design fixes. The prefill inside
«من صندوق» (one fund that covers the whole expense) only fills amounts; it does not pick the card.

**Recurring confirm:** `confirmOccurrence` gets the same sheet. Transfers / gold / other operations keep the current
sheet (only «من الفلوس الحرة الأول» semantics make sense there).

### 5.3 Fund detail — «تم الهدف 🎉» (rule 3)

- Goals only. A secondary button «تم الهدف 🎉»; emphasised (primary) when reservations + spent ≥ target.
- Tapping it opens a sheet «مبروك! 🎉»:
  - «الهدف: ج.م 6,000 · اتصرف عليه: ج.م 6,000 (١ مصروف)»;
  - if a leftover is reserved: «لسه محجوز ج.م 500 في «كاش»» with two buttons **«رجّع الباقي للفلوس الحرة»** /
    **«سيبه في الصندوق»** (no default; rule 3: ask, never auto);
  - without a leftover, one button «تم».
- Achieved detail: header chip «اتحقق ٢٠ نوفمبر» (ok tone), «الهدف ج.م 6,000 · اتصرف ج.م 6,000», the purchases list
  (tapping one opens the transaction), and **«رجّعه هدف مفتوح»** (AC-3).
- **Leftover, always visible (AC-4):** «لسه محجوز ج.م 500» per account, with **«رجّع للفلوس الحرة»** (release) and
  **«انقل لصندوق تاني»** (reallocate to an active fund, existing MoveMoneySheet; achieved funds are not offered as
  targets).
- After a linked purchase is deleted (AC-5): «الـ ج.م 6,000 رجعوا للصندوق. الهدف لسه متحقق؛ لو عايز ترجّعه مفتوح دوس
  «رجّعه هدف مفتوح».» The goal stays achieved.

### 5.4 Funds tab — «أهداف اتحققت»

- A collapsed group at the end of the tab: «أهداف اتحققت (n)». Rows: name · «اتحقق ٢٠ نوفمبر · اتصرف ج.م 6,000 من
  ج.م 6,000», trailing the leftover if any, else «🎉».
- Empty: the group is hidden.
- The fund summary on top («إجمالي المحجوز») still includes leftovers. It is reserved money.

### 5.5 Error messages (new codes)

| Code | Arabic |
|---|---|
| `SPEND_INVALID` | «المبلغ من الصندوق أكبر من اللي فيه في الحساب ده أو من المصروف» |
| `FUND_ACHIEVED` | «الهدف ده اتحقق؛ رجّعه هدف مفتوح الأول» |
| `FUND_NOT_A_GOAL` | ««تم الهدف» للأهداف بس» |

---

## 6. Edge cases (each with a recommendation)

| # | Case | Recommendation |
|---|---|---|
| Q1 | No default card in the expense cover sheet (§5.2) | **Decided: no default card; an explicit selection is required.** |
| Q2 | Expense smaller than the fund's reservation | spend = expense; the rest stays reserved (and is offered for release on «تم الهدف»). |
| Q3 | Fund reserved on several accounts | «من صندوق» spends only its part on the expense's account. No automatic move from other accounts; the line says how much came from free money. |
| Q4 | Fund in another currency than the account (an EGP goal with SAR reserved) | Spend in the account's currency; «اتصرف» shown in the fund currency at each movement's snapshot (`movementValueInFund`). |
| Q5 | Deleting the purchase after «تم الهدف» | **Decided (AC-5):** the spend goes back to the fund; the fund stays achieved, and a notice offers «رجّعه هدف مفتوح». Never reopens by itself. |
| Q6 | `countsAsSaving('spend')` makes a goal "behind" in the month it is spent | **Decided: exclude goal spending from the monthly saving pace;** contributions, spending and remaining reservations are distinct metrics (§3.5). Changes are listed per §3.5. |
| Q7 | Recurring expenses spending from a fund (e.g. a yearly bill from a sinking fund) | Not in this release; `paySinkingFund` covers bills. |
| Q8 | A nudge «وصلت لهدف «…»؟» when reservations + spent ≥ target | **Decided: included,** dismissible (existing `actionDismissals`), rule 4 priority; never auto-achieves (AC-2). |
| Q9 | «تم الهدف» for emergency / sinking funds | No: emergency never ends; sinking funds cycle (`paySinkingFund`). |
| Q10 | Spending from the emergency fund through «من صندوق» | Allowed (that is what it is for); counts as spend, not cover. |
| Q11 | Spending from an achieved fund's leftover | Allowed (e.g. a case for the tablet); it stays achieved. |
| Q12 | Gold purchase paid from a fund | Out of scope; asset purchases keep the cover-only sheet. |
| Q13 | Editing an achieved fund's target | Allowed (history); cash increase refused (`FUND_ACHIEVED`). |
| Q14 | Legacy dangling spend movements (deleted sinking payments) | Tolerated and counted as spent; INV-12 skips them; no rewrite. |
| Q15 | Old v9 code after an OTA rollback | Achieved funds look active again; nothing lost (§1). |

---

## 7. Test plan (synthetic data only)

**Logic (`tests/logic.test.ts`):**
1. **The tablet case** (10,000 / 6,000 / 4,000): the expense with `options.spend` gives fund 0, free 4,000, no cover
   asked. The same expense without it reproduces today's `NeedsCoverError(2,000)`. With «من صندوق» chosen in the
   cover options: 6,000 spend, free 4,000. With «من الفلوس الحرة الأول»: 2,000 cover, free 0.
2. **Spend validation:** wrong account, more than the reservation, more than the expense → `SPEND_INVALID`, state
   unchanged.
3. **Partial spend:** expense 6,500 with fund 6,000 and free 4,000 → spend 6,000 + 500 free, no question.
4. **Expense bigger than fund + free:** the gate asks for the rest; the sheet's split bounds (min = shortfall, max =
   min(expense, Σ reservations)).
5. **Edit:** amount down/up re-applies min(…); account change to one without the fund → spend 0; type change removes
   spend; a changed `options.spend` switches fund. Delete gives the spend back, cover movements keep the Q4 offer.
   INV-5 after each.
6. **`paySinkingFund`:** identical movements before/after the refactor; deleting a payment now restores its spend
   (documented change).
7. **Achieve:** goals only; leftover kept vs released (same patch, `release` movements); twice = once; reopen; reserve /
   reallocate-in refused while achieved; follow of a leftover still works.
8. **Exclusions:** achieved funds absent from `suggestAllocation(In)`, the receivables refill suggestion, plan
   suggestions, NBA rules 6–8, `homeFunds`, `fundsProjection`, MoveMoneySheet targets; present in `achievedFunds`,
   backups, history, and cover candidates (leftover).
9. **Selectors:** `fundSpent` in the fund currency at snapshots; `fundPurchases` follows edits/deletes.
10. **`settle` context:** `expense.amount` / `freeBefore` attached only for expense operations.
11. **Errors:** Arabic text for the 3 new codes.

**Frozen oracle / "nothing else moved":**
- Every oracle fixture at v9 and the receivables fixtures: `reportV8` diff 0 after this change (no achieved funds, no
  spend options).
- Pinning test: `updateFund` / `editFund` round-trip an unknown optional field (`achievedAt`), i.e. today's write
  paths would keep it after a rollback.

**Fuzz (D4 + receivables):**
- New random steps: an expense with «من صندوق» (valid and invalid), answering the cover with either card (random
  split within bounds), edit / delete such expenses, achieve (keep / release), reopen, reserve on an achieved fund
  (refused).
- After every step: INV-5, INV-8, INV-9…11, INV-12, INV-13; failed operations change nothing.
- `fundSpent + reservation + released` bookkeeping per fund stays consistent.

**Backup:** round trip with `achievedAt` and spend movements; a pre-release v9 file restores unchanged.

**Acceptance-criteria tests (§10), synthetic data only:**
- **AC-7, full reversal:** for an expense that is (a) all from a fund, (b) fund + free money, (c) free money + cover
  from another fund, (d) fund spend + cover + free money, and (e) a sinking-fund payment: deleting it restores every
  balance and every fund reservation to the state before it (spend automatically; cover after accepting the Q4 offer,
  or stays taken if declined). Asserted as a deep-equal of balances and per-(fund, account) reservations.
- **AC-8, INV-12 / INV-13 everywhere:** after each of: edit amount up/down, edit date/category, edit account (with and
  without the fund there), edit type, delete, a transfer and an exchange that make the fund's reservation follow, a
  confirmed recurring expense (blocked auto → cover sheet), `paySinkingFund`, achieve / reopen, leftover release /
  reallocate out, and a refused reserve or reallocate into an achieved fund. Also inside the fuzz, after every step.
- **AC-9, compatibility gate:** `achievedAt` survives `updateFund`, `editFund`, `addFund`-then-edit, `paySinkingFund`'s
  fund update, `deleteFund` of *another* fund, reallocate, release, follow, backup export → `openBackup`, `restoreFromBackup`
  and `replaceWithSeed`. Rollback simulation: run today's v9 write paths (`main` at `1c8f5b8`, the frozen copy of these
  operations used in tests) on a fund carrying `achievedAt`, then today's code reads it back. If any assertion fails,
  stop (§1, condition).
- **AC-10, atomicity:** every new or changed operation (expense with spend, cover-sheet retry with either card, edit,
  delete, `achieveFund` with / without release, `reopenFund`, leftover release / reallocate) is called with invalid input
  and with a refused cover; the state must be deep-equal afterwards. Cancelling the cover sheet (no retry) leaves the
  state unchanged. In the fuzz: every refused operation leaves `JSON.stringify(state)` identical.
- **AC-2:** a goal whose reservations + spending reach and pass the target is still active; only `achieveFund` sets
  `achievedAt`; the Q8 action appears and is dismissible.
- **AC-3 / AC-5:** reopen after keep and after release; deleting a linked purchase of an achieved fund restores the
  reservation and `achievedAt` is unchanged.
- **AC-6:** spend movements and cover movements are told apart everywhere: `fundSpent` counts only `spend`;
  `coversOf` (the Q4 offer) only `cover`; the cover sheet's «من صندوق» card writes `spend`, «من الفلوس الحرة الأول»
  writes `cover`.

**Browser check (last step):** the tablet scenario end to end; the cover sheet's two cards (no default); «تم الهدف»
keep / release; the achieved section; reopen; edit / delete of the purchase; 320 px and 360 px.

---

## 8. Docs to update (in the implementing change)

| Doc | What changes |
|---|---|
| `docs/TECHNICAL.md` | `Fund.achievedAt`; `OpOptions.spend`; `settle` stages; `Shortfall.expense`; INV-12/13; the operations (§3); selectors and the `fundsByPriority` change; the new sheet behaviour; tests. |
| `docs/USER_GUIDE.md` | «اصرف من صندوق» (expense sheet), the new «تدفعه منين؟» sheet with both choices, «تم الهدف 🎉», «أهداف اتحققت», reopen. Update «لما المصروف يلمس فلوس الصناديق». |
| `docs/CHANGELOG.md` | a new entry (1.2.0 OTA · data v9, no migration): users / technical; the delete-gives-spend-back change for sinking payments. |
| `docs/architecture/CURRENCY_AND_FUNDS_DESIGN.md` | §C2 (the expense cover is a choice, not minimum-first), D12 (shared spend stage), INV-12/13 in §1. |
| This file | status → implemented, with deviations. |

---

## 9. Build order (each a small green step: stage, commit command, wait)

1. **Spend core:** `OpOptions.spend`, `settle` stage 1, `planSpend`, `addTransaction` / `updateTransaction` /
   `deleteTransaction` spend consistency, `paySinkingFund` on the shared stage, INV-12, `SPEND_INVALID`. Tests 1–3, 5,
   6, 11; the oracle diff 0; fuzz for spends.
2. **Gate context for the sheet:** `Shortfall.expense` from expense operations (and confirm of expense rules), the
   split-bounds helper the sheet uses. Tests 4, 10.
3. **Achieved:** `achievedAt`, `achieveFund` / `reopenFund`, `FUND_ACHIEVED` guards, INV-13, `fundsByPriority`
   exclusion, `achievedFunds`, `fundSpent`, `fundPurchases`, NBA / refill / plan exclusions (+ Q8 nudge if kept),
   the round-trip pinning test. Tests 7–9; fuzz.
4. **UI:** «من صندوق» in the expense sheet; the new expense cover sheet («تدفعه منين؟», two cards); «تم الهدف 🎉» sheet;
   achieved detail; «أهداف اتحققت» group; row chip «من صندوق: …»; delete copy.
5. **Docs pass + browser check + release notes** (no migration; OTA to 1.2.0).

---

## 10. Approved decisions and acceptance criteria (2026-11-24)

**Decisions**

| | Decision |
|---|---|
| Q1 | No default card in «تدفعه منين؟». An explicit selection is required. |
| Q6 | Goal spending is excluded from the monthly saving pace. Contributions, spending and remaining reservations are distinct metrics. |
| Q8 | The dismissible achievement nudge «وصلت لهدف «…»؟» is included. |
| §3.3 | Deleting an expense automatically restores its linked fund spending, including sinking-fund payments. |

**Acceptance criteria** (each is a test in §7 and a line in the step report)

| # | Criterion | Where in this design |
|---|---|---|
| AC-1 | Fund selection is available directly on the expense sheet even when free money is sufficient; the cover sheet is not the only entry point for intentional fund spending. | §5.1 |
| AC-2 | Reaching the target never marks a goal achieved; achievement requires the user's explicit confirmation. | §3.4, §4 (Q8), §6 |
| AC-3 | Achieved funds can be reopened. | §3.4, §5.3 |
| AC-4 | Remaining reservations of an achieved fund stay visible and can be released or reallocated. | §3.4, §5.3 |
| AC-5 | Deleting an expense linked to an achieved fund restores its reservation without reopening the goal. | §3.3, §5.3, Q5 |
| AC-6 | Intentional fund spending (`spend`) stays distinct from releasing reservations to cover an unrelated expense (`cover`). | §3.2, §3.3, §5.2 |
| AC-7 | Every expense-linked financial movement is reversed, including mixed fund / free-money expenses. | §3.3, §7 |
| AC-8 | INV-12 and INV-13 are tested across edits, deletes, account changes, transfers, recurring payments and sinking-fund payments. | §2, §7 |
| AC-9 | Optional `achievedAt` survives every relevant write path and the rollback round trip; no migration only if these tests pass. | §1 (condition), §7 |
| AC-10 | Atomicity: cancelling or failing any operation leaves the financial state unchanged. | §3, §7 |

**Workflow (approved):** the owner creates the `funds-goals` branch from `main` and commits this design on its own
first. Implementation then follows §9 step by step on synthetic fixtures, with the frozen-oracle regression and the full
test suite each step. No merge into `main` and no OTA until the implementation is reviewed and approved.
