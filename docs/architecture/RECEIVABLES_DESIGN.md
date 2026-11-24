# Receivables (late salary, money owed to me) — design

Status: **approved (2026-11-24). Steps 1 and 2 of §10 are implemented** (schema, the v8 → v9 migration, INV-9…11, backup
shape and restore checks; operations and selectors, with tests and fuzz); steps 3–4 (UI, docs pass + browser check)
are not built yet. Decisions:
Q1 `writtenOffAt`; Q2 reject cross-currency collection in v1 with the workaround in the sheet; rule 8 chip only (no
forMonth grouping view); Q9 yes; Q10, Q11 not in v1; Q3–Q8 and Q12–Q16 as recommended. Deviations in step 1:
`settings.v9Step` is optional in the type (v8 data has none; it is always set after migrating); `receivableCollected`
(a §3.2 selector) was built in step 1 because the invariants need it; `assertInvariants` keeps INV-5 in
`invariantViolations` and adds `receivableViolations` beside it (not one merged list). Step 2: `updateTransaction`
keeps the existing receivable link whatever the form sends (the link belongs to the receivable operations), so a
plain income can't be linked and a collection can't be unlinked by an edit; `forMonth` on an income without a link is
refused (`RECEIVABLE_LINK_REQUIRED`, Q7); a forMonth mismatch on a write is `INVALID_MONTH` (field forMonth);
write-off and reopen are idempotent (`{}` the second time); two extra selectors for step 3, `duplicateSalaryReceivable`
(Q5) and `receivableRefillSuggestion` (Q8); new code `INVALID_KIND`. Q3–Q8, Q12–Q16 approved as recommended. All numbers in this document are
made up.

Builds on `CURRENCY_AND_FUNDS_DESIGN.md` (rounding INV-7, native amounts, account-backed funds INV-5, the cover
gate, fail-closed migrations). The pattern already exists for liabilities: a payment is an ordinary transaction
tagged `liabilityId`, and what is left is derived, never stored. A receivable is the mirror image of that, on the
income side.

---

## 0. Summary

- A **receivable** is a claim, not money. No selector that produces a money figure reads it: net worth, liquid,
  account balances, funds, unassigned, safe-to-spend and snapshots all stay exactly as they are.
- **Collecting** it records an ordinary **income** transaction (same currency, actual receipt date) tagged
  `receivableId` + `forMonth`. A collection therefore has the same effect on every number as typing that income by
  hand today. That is the whole proof that nothing else moves (§3.3).
- **Collected, remaining and status are derived** from those transactions. Only the write-off is stored, as
  `writtenOffAt`, and it is reversible.
- **Data v9**: one new collection `receivables`, two optional fields on income transactions, and a step-tracked,
  idempotent, fail-closed v8 → v9 migration (`settings.v9Step`). The pre-migration copy is
  `@wealth_finance_state_backup_v8`.
- Bumping the data version (instead of adding a v8 step 9) is deliberate. Today's v8 build only persists the
  collections it knows (`dataOf` / `partialize`). If an OTA rollback put v8 code on v9 data, v8 code would **silently
  drop `receivables` on its next save** and leave transactions pointing at nothing. With version 9, the v8 code fails
  closed instead (§7, release).

---

## 1. Schema

### 1.1 `Receivable` (new, `store/types.ts`)

```ts
export type ReceivableKind = 'salary' | 'other';
export type ReceivableStatus = 'open' | 'partial' | 'settled' | 'written_off'; // derived, see §3.2

export interface Receivable extends Synced {   // Synced = { updatedAt }
  id: string;
  label: string;            // the debtor: "الشركة", a person's name… trimmed, non-empty
  kind: ReceivableKind;
  forMonth?: string;        // 'YYYY-MM'; REQUIRED when kind === 'salary', optional otherwise
  amount: number;           // > 0, in `currency`, rounded to its decimals (INV-7). Never converted.
  currency: CurrencyCode;   // native, from the registry
  dueDate?: string;         // 'YYYY-MM-DD'
  note?: string;
  writtenOffAt?: string;    // ISO. Present = written off (status 'written_off'); cleared by reopen.
  createdAt: string;
}
```

**Deviation from product rule 2 (please confirm, Q1):** the stored field is `writtenOffAt`, not `status`. Rule 4
says status is derived except `written_off`. Storing the whole `status` would mean a stored value (`open` /
`partial` / `settled`) that can disagree with the transactions. With `writtenOffAt`, the only stored part of the
status is the one that isn't derivable, plus when it happened (shown in the UI). `receivableStatus()` returns
exactly the four values of rule 2.

No `rateSnapshotId`. A receivable is never valued "as it was". The only conversion is the informational total at
today's rates (§3.2).

### 1.2 Income transactions (`IncomeExpenseTransaction`)

```ts
  // Income only: this income collects (part of) that receivable…
  receivableId?: string;
  // …and copies its forMonth ('YYYY-MM'), for the "عن شهر أكتوبر" chip and the optional grouping.
  forMonth?: string;
```

`forMonth` is stored on the transaction (rule 3) and kept equal to the receivable's (INV-11). Editing the receivable's
`forMonth` re-stamps its collections in the same patch.

### 1.3 Everything else that lists collections

| Place | Change |
|---|---|
| `FinanceState` | `receivables: Receivable[]` |
| `SyncEntity` | `'receivable'` (tombstones on delete) |
| `dataOf` (`useFinanceStore.ts`) | `receivables` (persist + backup content) |
| `COLLECTIONS` in `replaceAllData` (`operations.ts`) | `{ key: 'receivables', entity: 'receivable' }` (restore / seed import tombstones) |
| `STATE_COLLECTIONS` / `hasStateShape` (`backup.ts`) | `'receivables'` |
| `stateSummary` | receivables count (dev log of migrations) |
| `seed.example.ts` | nothing to write: it goes through `migratePersistedState`, so it gains `receivables: []`. Your `seed.local.ts` follows the same pattern if it was copied from the example (not checked: I don't open that file). |
| `tests/legacy/*` | untouched (frozen v7 oracle) |

### 1.4 Migration v8 → v9 (`store/migrateV9.ts`, same shape as `migrateV8.ts`)

- `CURRENT_VERSION = 9`. New `settings.v9Step` (number). `V9_STEPS` is append-only, and `LATEST_V9_STEP = V9_STEPS.length`.
- **Step 1 `receivables`**: `receivables ??= []`. It does nothing to a state that already has the array. It validates what
  it finds: `receivables` must be an array of objects, and no transaction may carry a `receivableId` that doesn't
  resolve (impossible from real v8 data; it guards against hand-edited payloads). A violation **throws**.
- After the steps, `assertReceivableInvariants` (INV-9…11) runs. It throws on any violation, so the store refuses the
  data and leaves storage untouched (`hydration.ts`, fail-closed, as for v8).
- `migratePersistedState(persisted, version)`:
  - `version >= 9` → `applyV9Steps(persisted)` (completes a v9 payload from an earlier v9 build).
  - `version === 8` → `applyV9Steps(applyV8Steps(persisted))` (a v8 payload may itself be at an older v8 step).
  - `< 8` → the existing chain → `migrateV7toV8` → `applyV9Steps`.
- **Backups before migrating:**
  - The existing persist `migrate` already writes `@wealth_finance_state_backup_v${version}` before anything else. For
    a v8 → v9 upgrade, that is `@wealth_finance_state_backup_v8`, written once, before the main key can be overwritten.
  - `normalize` gains the same guard for v9 sub-steps. A payload at version 9 with `v9Step < LATEST_V9_STEP` first
    gets `@wealth_finance_state_backup_v9_before_step_${n}`.
  - The v8 completion in `normalize` stays for version-8 payloads.
- **Idempotent:** migrating twice equals migrating once, and a state at `LATEST_V9_STEP` comes back as the same object.
- **Restoring older backup files** (v0–v8) runs the same function, so they arrive with `receivables: []`. A v9 file in
  a v8 app gets `UNSUPPORTED_VERSION`: «النسخة الاحتياطية دي من إصدار أحدث من التطبيق؛ حدّث التطبيق الأول».

---

## 2. Invariants

| Id | Rule | Checked by |
|---|---|---|
| **INV-9** | For each receivable: `0 ≤ collected(r) ≤ r.amount` (+0.005 float noise), with `collected` summed in `r.currency` (INV-7 rounding). | write ops (reject), migration + restore (refuse), tests after every op (fuzz) |
| **INV-10** | Every `tx.receivableId` points at an existing receivable, the transaction is `type: 'income'`, and `tx.currency === receivable.currency` (so its account is in that currency). | same |
| **INV-11** | A linked transaction's `forMonth` equals its receivable's `forMonth` (both absent for an `other` without month). A salary receivable has `forMonth` matching `^\d{4}-(0[1-9]\|1[0-2])$`. | same |
| INV-1…8 | Unchanged. A collection is an income, so INV-5/INV-8 are handled exactly as for any income. | existing |

**Where:**
- `store/invariants.ts` gains `receivableViolations(state)` with codes `OVER_COLLECTED`, `UNKNOWN_RECEIVABLE`,
  `NOT_INCOME`, `CURRENCY_MISMATCH`, `FOR_MONTH_MISMATCH`, `FOR_MONTH_INVALID`.
- `assertInvariants` widens its `Pick` to include `receivables` and checks both families.
- `InvariantError`'s message names the receivable id.

**Handling violations — no quarantine collection.** v8 needed `unresolvedMovements` because real v7 data could be
ambiguous. Here there is no legacy data at all: every receivable is created by v9 code that validates on write. A
violation can only come from a hand-edited or corrupted payload, so:

- **Write path:** the operation throws `FinanceValidationError` and nothing changes (INV-6, through `runAction`).
- **Migration / hydration:** the migration throws and the data is refused untouched (fail-closed), with the existing
  `HydrationErrorGate` screen.
- **Backup restore:** `openBackup` runs the invariants after `hasStateShape`. A violation gives `INVALID_FILE`
  («الملف ده مش نسخة احتياطية سليمة من حصّالة») and the current data is not touched.
- **Display (belt and braces):** `receivableRemaining` clamps at 0, so a broken state can't show a negative claim.

---

## 3. Operations and selectors

### 3.1 New operations (`store/operations.ts`), all pure `Patch` returns, all `stamp`ed

| Operation | Rules | Error codes (new → Arabic in `errorMessages.ts`) |
|---|---|---|
| `addReceivable(input)` | label non-empty; amount > 0 rounded to its currency; currency known; salary ⇒ valid `forMonth`; optional `dueDate` valid. | `RECEIVABLE_FOR_MONTH_REQUIRED` «اختار الشهر اللي المرتب ده عنه» |
| `updateReceivable(r)` | label/note/dueDate free. `amount` ≥ collected. `currency` locked once it has a collection. `forMonth` change re-stamps every linked transaction in the same patch. `kind` salary→other keeps the month; other→salary needs one. | `RECEIVABLE_AMOUNT_BELOW_COLLECTED` «المبلغ مينفعش يبقى أقل من اللي اتحصّل (X)»; `RECEIVABLE_CURRENCY_LOCKED` «فيه تحصيلات، العملة مش هتتغيّر» |
| `deleteReceivable(id)` | only with **no** collections (rule 6); tombstone. | `RECEIVABLE_IN_USE` «فيه تحصيلات على المستحق ده؛ تقدر تشطبه بس» |
| `writeOffReceivable(id)` | sets `writtenOffAt = now`. **No ledger effect**: transactions, reservations and balances are untouched, so there is no cover gate. Allowed on open and partial; refused on settled (nothing left). | `RECEIVABLE_SETTLED` «اتحصّل كله، مفيش حاجة تتشطب» |
| `reopenReceivable(id)` | clears `writtenOffAt`. | — |
| `collectReceivable({ receivableId, accountId, amount, date, categoryId?, note? }, options?)` | builds an income through the **same** `addTransactionCore` path (validation, rounding, rate snapshot, `lastUsed`), adding `receivableId` + `forMonth`. Category default: `cat-income-salary` («راتب») for salary, `cat-income-other` («دخل آخر») otherwise. Refuses an amount over the remaining and a written-off receivable. Goes through `settle` like every write (an income never needs a cover; this keeps one code path). | `RECEIVABLE_OVER_COLLECTED` «ده أكتر من الباقي (X)»; `RECEIVABLE_WRITTEN_OFF` «المستحق ده متشطب؛ رجّعه مفتوح الأول»; `CURRENCY_MISMATCH` (existing) |

**Existing operations touched:**

- `validateIncomeExpense`: when `receivableId` is set, the transaction must be an income (`RECEIVABLE_PAYMENT_NOT_INCOME`),
  the receivable must exist and match its currency, `forMonth` must equal the receivable's, and INV-9 must hold
  counting this transaction **instead of** its previous version (so editing an amount within the limit works).
  This one place covers `addTransaction`, `updateTransaction` and `collectReceivable`.
- `updateTransaction`:
  - A linked transaction can't change type (an income can't become an expense/transfer); the store rejects it and the
    sheet hides the type segment.
  - It can't move to an account in another currency (`CURRENCY_MISMATCH`).
  - The date is free (cash basis).
  - Lowering the amount reduces the account balance, so it goes through the **existing cover gate** like any edit.
- `deleteTransaction`: unchanged. The receivable's collected/status update by themselves (derived), and the existing
  gate applies (deleting an income lowers a balance).
- `restoreFromBackup` / `replaceWithSeed`: through `COLLECTIONS` (§1.3).
- `deleteAccount`: unchanged. `ACCOUNT_IN_USE` already refuses an account with transactions, and collections are
  transactions.
- `processDue` / recurring: **unchanged** (§5).

### 3.2 New selectors (`store/selectors.ts`)

```text
receivableCollections(state, id)         → income transactions with receivableId === id (newest first)
receivableCollected(state, r)            → sumIn(amounts, r.currency)
receivableRemaining(state, r)            → max(0, roundIn(r.amount − collected))
receivableStatus(state, r)               → writtenOffAt ? 'written_off'
                                            : remaining ≤ 0.005 ? 'settled'
                                            : collected > 0 ? 'partial' : 'open'
receivableOverdue(state, r, today)       → status ∈ {open, partial} && dueDate < today
openReceivablesByCurrency(state)         → Record<currency, Σ remaining> over open + partial (the "غير محصّل" totals)
openReceivablesValue(state, to)          → Σ valueNow(remaining, currency → to), INFORMATIONAL ONLY, today's rates
```

Written-off and settled receivables count 0 in the totals.

### 3.3 Proof that net worth, safe-to-spend and unassigned are unaffected

1. **Before any collection.** Grepping the money selectors (`accountNetFlow`, `accountBalance`, `liquidTotal`,
   `holdingsTotal`, `liabilitiesTotal`, `netWorth*`, `liquidByCurrency`, `fund*`, `reservation*`, `unassigned*`,
   `monthSummary`, `monthFlows`, `planProgress`, `safeToSpend*`, `analytics.*`, snapshots) shows they read
   `accounts`, `transactions`, `holdings`, `liabilities`, `funds`, `reservationMovements`, `unresolvedMovements`,
   `monthlyPlans` and `settings`, never `receivables`. Adding, editing, writing off or deleting a receivable writes
   only `receivables` (+ tombstones), so every one of those numbers is identical. Test: the v8 oracle report is
   byte-equal with any set of receivables added (§6).
2. **A collection.** It is an income transaction whose only extra fields (`receivableId`, `forMonth`) are read by the
   receivable selectors alone. So the state with a collection gives the same numbers as the state with the same
   income typed by hand. Test: report(state + collection) ≡ report(state + plain income with the same account, amount,
   date and category).
   - It is correct that a collection **does** raise cash, net worth, unassigned and the month's income: it is now real
     money, received on that date (rule 8, cash basis).
3. **Safe-to-spend** = what is left on flexible plan lines. It reads planned limits and expenses only, so a receivable
   changes nothing. `expectedIncome` of a plan is typed by the user, not computed.
4. **Unassigned** = Σ available − Σ unresolved, from balances and reservations, so the same reasoning as 1 and 2 applies.

---

## 4. UI

Everything reuses the existing glass components: `FormSheet`, `SectionHeader`, `ListGroup` / `ListRow`, `StatusChip`,
`Money`, `Segment`, `AmountInput`, `PastDateField`, `EmptyState`, `Card variant="subtle"`, `InsightCard`. No new
colours: status tones map onto existing `StatusChip` tones. RTL as everywhere: right-aligned text, money on the left,
Arabic dates via `formatDateAr`, months via the existing Arabic month names.

### 4.1 Assets → section «غير محصّل»

- **Position:** after «استثمارات تانية», before «الالتزامات» (things that aren't cash, above things you owe).
- **Header:** `SectionHeader title="غير محصّل" actionLabel="+ مستحق"`.
- **Caption:** «فلوس ليك عند حد ولسه ماوصلتش. مش محسوبة في صافي الثروة ولا في فلوسك.»
- **Totals row (per currency):** e.g. «ر.س 6,000 · ج.م 2,500». Below it, informational in the reporting currency:
  «≈ ج.م 81,000 بأسعار النهارده (للمعلومية بس)».
- **Rows (open + partial)**, sorted by dueDate then forMonth:
  - Title: the label.
  - Subtitle: «مرتب · عن شهر أكتوبر ٢٠٢٦ · مستحق ٥ نوفمبر». For partial: «اتحصّل ر.س 2,000 من ر.س 6,000».
  - Trailing: the **remaining** (`Money`).
  - Chip:
    | Status | Chip text | Tone |
    |---|---|---|
    | open | «مستنيه» | neutral |
    | open, overdue | «متأخر» | attention |
    | partial | «اتحصّل جزء» | neutral |
- **Closed:** a collapsed group «المقفولة (n)» holds the settled («اتحصّل» positive) and written-off («اتشطب» muted)
  receivables.
- **Empty state:** the header with «+ مستحق» stays, plus one line: «مفيش فلوس ليك عند حد دلوقتي. لو مرتبك اتأخر سجّله
  هنا عشان متنساهوش.» It is a single caption row, not a big `EmptyState`, so Assets doesn't grow for people who never
  use it.

### 4.2 `ReceivableSheet` (add / edit), `components/assets/ReceivableSheet.tsx`

**Title:** «مستحق جديد» / «تعديل المستحق».

**Fields:**
1. `Segment` النوع: «مرتب» | «حاجة تانية».
2. «من مين؟», placeholder «مثال: الشركة».
3. «عن شهر» (salary only): month picker, default **last month**.
4. `AmountInput` with a currency picker over enabled currencies. Default: the currency of the last salary income's
   account, else the reporting currency. Locked with a caption once collected: «العملة مش بتتغيّر بعد أول تحصيل».
5. «ميعاد الاستحقاق (اختياري)»: date field.
6. «ملاحظة (اختياري)».

**Edit mode adds:**
- A summary card: «اتحصّل X من Y · الباقي Z».
- The list of collections. Each row opens `TransactionSheet`.
- Actions:
  - Primary «سجّل تحصيل».
  - «اشطبه» with a confirm: «هتقفل المستحق ده من غير ما يتسجّل أي فلوس. تقدر ترجّعه بعدين.»
  - When written off, «رجّعه مفتوح» replaces «اشطبه».
  - «احذف», only without collections. Otherwise a caption: «فيه تحصيلات، تقدر تشطبه بس».

### 4.3 `CollectSheet`, `components/assets/CollectSheet.tsx`

**Title:** «تحصيل: <label>».

**Fields:**
- `AmountInput`, prefilled with the remaining. Hint «الباقي X». Above the remaining: «ده أكتر من الباقي (X)»
  (save disabled).
- «في حساب»: only non-archived accounts **in the receivable's currency**. If there are none: «مفيش حساب بـ<currency>؛
  ضيف حساب الأول» and save is disabled.
- Date: النهارده / امبارح / تاريخ تاني (the actual receipt date).
- Category: default «راتب» for salary.
- Note.

**After saving:**
- Message «اتسجّل ر.س X في <account>».
- Then, **only if** some fund is below target **and** the account has available money, a one-tap offer (rule 7, never
  automatic): «تحب تكمّل الصناديق اللي ناقصة؟» with «أيوه» / «بعدين».
- «أيوه» opens the existing `AssignSheet` with new optional props `initialCurrency`, `initialAccountId` and `prefill`:
  - currency = the receivable's currency;
  - account = the collection account;
  - amounts from `suggestAllocationIn(state, currency, min(collected now, account available))`, limited to funds
    below target;
  - every amount editable.
- Saving goes through the existing `allocateMany` → `planReserve` (account-backed, INV-5, Q13 block beyond
  available). No new reserve logic.

### 4.4 Transactions

- On a linked income, `TransactionRow` and `TransactionSheet` show the chip «عن شهر أكتوبر» and, in the sheet,
  «تحصيل: <label>» (tapping it opens the receivable).
- The type segment is hidden, like a gold purchase, with the caption «دي تحصيل لمستحق، نوعها مش بيتغيّر».
- The account picker offers only accounts in the receivable's currency.
- Deleting a collection works as today (cover gate if needed). The receivable reopens by itself, so the delete
  confirmation adds one line: «المستحق هيرجع مفتوح بالمبلغ ده».

### 4.5 Analytics (rule 8)

- Income stays cash-basis (`date`): no change to `monthSummary`, `monthlyTrend` or `spendingFlow`.
- **Cheap, recommended:** the `forMonth` chip on drill-down rows (it comes free from `TransactionRow`).
- **Not cheap, recommend deferring:** a separate "group income by forMonth" view. There is no income-by-period
  report to hang it on today. Adding `forMonth` as a drill filter (`drillParams` / `parseDrillParams`) is about
  20 lines; worth it only if you want to tap a chip and see "everything about October".

### 4.6 Entry points

1. Assets → «+ مستحق».
2. Assets row → `ReceivableSheet` → «سجّل تحصيل».
3. Optional, Q9: a Home Next Best Action «مرتب أكتوبر لسه ماوصلش؟» for an overdue receivable, with «سجّل التحصيل».

---

## 5. Interactions

| With | Behaviour |
|---|---|
| **processDue / recurring** | No coupling in v1. A recurring salary rule keeps recording or asking as today. Receivables are never created or collected automatically. `blockedDue` is unchanged (a collection is never blocked). Possible later: «المرتب ماوصلش؟ سجّله مستحق» on a due salary occurrence (Q10). |
| **Cover gate / `CoverRequestSheet`** | Collecting is an income, so no shortfall. Lowering or deleting a collection lowers a balance, so the existing gate and the **one** cover sheet apply, and `runAction` never shows it as an error. Write-off / reopen / edit receivable have no ledger effect, so no gate. |
| **Transfers / exchanges** | `receivableId` only on incomes. Moving collected money later is an ordinary transfer/exchange with its reservation-follow rules. A receivable paid in another currency: Q2. |
| **Reporting currency** | Only `openReceivablesValue(state, to)` converts, at today's rates, labelled informational. Nothing is stored converted. Changing the reporting currency changes only that line (INV-1 property test extended). |
| **Funds** | Never read receivables. The refill offer only *proposes* reserves through the existing flow. |
| **Backups** | Export includes `receivables` (via `dataOf`), plain and encrypted. Import: v0–v8 files gain `[]`; v9 is validated (`hasStateShape` + INV-9…11). Newer files are refused. Restore-safety suite extended (§6). |
| **Net worth snapshots** | Unchanged (no receivables in breakdowns). |
| **Monthly review / plan** | Unchanged in v1. Possible later: the review lists open salary receivables (Q11). |

---

## 6. Test plan (synthetic data only)

**Logic (`tests/logic.test.ts`, new describe blocks):**

1. **CRUD:** add (salary needs forMonth; month format; amount rounding; unknown currency); update (amount ≥ collected;
   currency lock after first collection; forMonth change re-stamps collections atomically); delete (refused with
   collections; tombstone without).
2. **Collect:** partial → `partial`; the rest → `settled`; over → `RECEIVABLE_OVER_COLLECTED` and state unchanged;
   wrong-currency account → `CURRENCY_MISMATCH`; written-off → refused; the income carries `receivableId` + `forMonth`,
   the receipt date and the default category.
3. **Derived consistency:** edit a collection's amount (up within the limit / down) → collected follows; edit beyond →
   refused; delete a collection → back to `partial`/`open`; changing a linked income's type or its account currency →
   refused.
4. **Write-off:** zero ledger effect (balances, reservations, transactions deep-equal); status `written_off`; reopen →
   previous derived status; write-off of a settled one → refused; partial + write-off keeps collected.
5. **Cover gate:** deleting a collection whose money is reserved → `NeedsCoverError` through `runActionWith` ends in
   the cover flow, never an error message (same harness as Phase D).
6. **Selectors:** per-currency totals exclude settled/written-off; informational value at today's rates; overdue.
7. **Errors:** every new code has an Arabic message (`errorMessage` test).

**Oracle / "nothing else moved":**

- Every v7 oracle fixture (`exampleSeedV7`, `richV7`, local seed when present) migrated to **v9** gives a `reportV8`
  **identical** to the v8 report (diff = 0).
- The same fixtures with random receivables added (no collections) → identical report.
- **Equivalence:** report(state + `collectReceivable`) deep-equals report(state + `addTransaction` with the same
  income).
- INV-1 property: changing `reportingCurrency` changes no stored amount, now including receivables.

**Fuzz (extend the D4 fuzz):**

- New random ops: add/update/delete receivable, collect (random amounts incl. over-collection and wrong currency),
  edit/delete a collection, write-off, reopen.
- After every step: INV-5, INV-8, INV-9…11. A refused op changes nothing (INV-6).
- `netWorth(state) === netWorth({ ...state, receivables: [] })` when the receivable ops add no transactions.
- Run all three existing variants (grant negative / strict accounts / local seed).

**Migration:**

- v8 fixtures at every v8 sub-step → v9: `receivables: []`, `v9Step = LATEST_V9_STEP`, everything else deep-equal.
- Idempotent: twice = once; a current state returns the same object.
- v7 → v9 and v1 → v9 chains.
- Fail-closed: `receivables` not an array / a dangling `receivableId` / over-collected → throws; the hydration test
  harness keeps storage untouched.
- The persist harness (zustand + fake storage) writes `@wealth_finance_state_backup_v8` **before** the main key on a
  version-8 payload.

**Backup:**

- Round trip plain + encrypted with receivables and collections → deep-equal.
- A v8 file → `receivables: []`.
- A v10 file → `UNSUPPORTED_VERSION`.
- Restore-safety additions: `receivables: [null]` / not an array / dangling `receivableId` / over-collected / forMonth
  mismatch → `INVALID_FILE` with «الملف ده مش نسخة احتياطية سليمة من حصّالة», and the frozen current state is unchanged.

---

## 7. Edge cases and open questions (each with a recommendation)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Store `status` or `writtenOffAt`? | **`writtenOffAt`**: status is derived, only the non-derivable part is stored (§1.1). |
| Q2 | Salary owed in SAR but paid in EGP (or the reverse). | **v1: refuse** (rule 3). The sheet explains: «التحصيل لازم يبقى بنفس العملة. لو اتدفع بعملة تانية: اشطب المستحق وسجّل الدخل عادي.» Later, if it happens often: a "collected in another currency" option that stores both amounts like an exchange. |
| Q3 | Employer pays more than owed (bonus with the late salary). | Refuse over-collection (rule 3). The sheet suggests: «سجّل الزيادة كدخل منفصل». |
| Q4 | Collect on a written-off receivable. | Refuse, with a one-tap «رجّعه مفتوح» in the same sheet. |
| Q5 | Two salary receivables for the same label + month. | Warn («فيه مستحق لنفس الشهر بالفعل»), don't block (two partial employers, corrections). |
| Q6 | Receipt date before `createdAt` or before `forMonth`. | Allow (a backdated entry, an advance). Dates before `trackingStartDate` are ignored by `monthSummary` as for any income. |
| Q7 | `forMonth` on a plain income (on-time salary). | **Not in v1**: only collections carry it. Cheap to add later (the field already exists on the type). |
| Q8 | Refill offer: which amount and which funds? | `min(this collection, account available)`, funds **below target** only, by existing priority, in the collection currency, all editable. Shown only when that list is non-empty. |
| Q9 | Home Next Best Action for an overdue receivable? | **Yes, dismissible**, only when `dueDate` has passed: «مرتب أكتوبر لسه ماوصلش» → «سجّل التحصيل». Small; can be cut from v1 if you prefer. |
| Q10 | Recurring salary ↔ receivable link. | **Not in v1.** It touches the due inbox and skipping semantics; revisit after real use. |
| Q11 | Monthly review mentions open receivables? | Later (one line in the review), not in v1. |
| Q12 | Lowering a receivable's amount below collected. | Refused (INV-9). Write it off instead if the debtor won't pay the rest. |
| Q13 | Currency change on a receivable without collections. | Allowed (nothing derived depends on it yet). |
| Q14 | Rounding. | Amounts rounded to the currency's decimals on save (INV-7). `settled` uses the 0.005 tolerance. |
| Q15 | Archived accounts. | Not offered for collection (same as other pickers). Existing collections on them stay valid. |
| Q16 | Sync later. | `updatedAt` + tombstone entity `receivable`, like every collection. |

---

## 8. Release

- **Bundle:** this feature + the stage-1 restore-safety fixes (`store/backup.ts`, already tested) ship in one OTA.
- **Note on git state:** at the time of writing, `main` (`98373ba`) does **not** contain the stage-1 commits
  (`852fe20`, `5f537f4`); they are on `stage-1` / `origin/stage-1` only. Merge stage-1 into main (or base
  `receivables` on stage-1) so this OTA really carries them.
- No native changes are expected, so it ships as an `eas update` to the 1.2.0 build; keep 1.2.0.
- **OTA rollback is not a data rollback.** After this OTA a phone holds data v9. Republishing the v8 OTA would
  **fail closed** on v9 data (by design, instead of dropping receivables). So a "rollback" must be a new OTA with v9
  code (fix forward), or a manual restore of `@wealth_finance_state_backup_v8` / an exported backup on a v8 build.
- **Before updating:** export a backup.
- **After first launch:** expect every number unchanged, an empty «غير محصّل» section, and `v9Step` = latest.

## 9. Docs to update (in the implementing change)

| Doc | What changes |
|---|---|
| `docs/TECHNICAL.md` | data model (Receivable, the income fields, FinanceState); migrations table (v8 → v9, `v9Step`, the backup key); invariants INV-9…11; ops/selectors and error codes; Assets section, sheets, refill offer; backup (`hasStateShape` collections, restore-safety cases); tests count; limitations (Q2/Q7/Q10/Q11). |
| `docs/USER_GUIDE.md` | new section «فلوس ليك عند حد («غير محصّل»)»: add, collect (partial), write off / reopen, why it isn't in net worth, the refill offer, the «عن شهر» chip. |
| `docs/CHANGELOG.md` | a new entry (date · 1.2.0 · data v9): users / technical, **plus: "this release also ships the stage-1 restore-safety fixes (2026-11-23 entry)"**, and flip that entry's "not shipped yet" note. |
| `docs/architecture/CURRENCY_AND_FUNDS_DESIGN.md` | status line: "receivables: see RECEIVABLES_DESIGN.md (data v9)", and INV-9…11 added to the invariant list in §1. |
| This file | status → implemented, with any deviations. |

## 10. Build order (each a small green step, stage + commit command + wait)

1. **Schema + migration v9 + invariants + backup shape**, with migration/backup/restore-safety tests and the oracle
   "unchanged" check. No UI.
2. **Operations + selectors** (CRUD, collect, write-off/reopen, `validateIncomeExpense` link rules), with logic,
   equivalence and fuzz tests.
3. **UI:** the Assets section, `ReceivableSheet`, `CollectSheet`, transaction chip and type lock, the refill offer
   (`AssignSheet` props), and the optional NBA.
4. **Docs pass + one browser check** on synthetic data: add salary receivable → partial collect → refill offer →
   collect rest → delete a collection (reopens) → write off / reopen → backup round trip.
