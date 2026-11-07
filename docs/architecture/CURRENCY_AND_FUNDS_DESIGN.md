# Currency + Funds Architecture — Design (data v8)

**Status (2026-11-07):** approved (all of §J as recommended). **Phase B — engine and precision — is implemented on branch
`currency-v8`** (rates as a USD table with immutable snapshots, countries, currencies as data, rounding INV-7, holdings
cost in native currency, reporting and plan currency preferences, selectors and screens on the reporting currency, the
frozen-v7 oracle and the v7 → v8 sub-steps). Dry run on the owner's real backup: every difference to v7 is rounding,
within half a minor unit per contributing row. **Phase C — ledger — is implemented on the same branch** (transfer vs
exchange, fees as spending in "رسوم", atomic edit / delete, recurring exchanges confirm-only, migration sub-step 7).
Deviations from this document, decided with the owner: a v7 same-currency transfer with unequal amounts migrates to a
transfer + a fee (sent > received) or a "تسوية" income (received > sent) instead of a same-currency exchange; the "تسوية"
category is created only when needed. **Not built yet:** Phase D (account-backed reservations, cover flow, unresolved
migration; funds / unassigned in the reporting currency), the gold price object, the exchange-rate list UI,
per-country gold pricing (product phase).

**Based on:** a read of `store/*`, `utils/currency.ts`, `utils/formatters.ts`, `utils/prices/*`, `constants/*`,
`components/**` and `app/**` as of data v7 / app 1.2.0 (unbuilt), plus a read-only run of the current logic against
`store/seed.local.ts` (§G). Where the document says "today" it means that code.

**Audience:** the only user of the app. Because of that, no backward-compatibility layers, legacy UX or dual-mode
code are designed. The only compatibility kept: restoring v1–v7 backups through the migration chain (§F).

---

## 0. Summary

| Topic | Today (v7) | Target (v8) |
|---|---|---|
| Currency model | Closed union `EGP \| SAR \| USD`; EGP is the pivot (`rateToEGP`, `SAR_EGP`, `USD_EGP`) | Any ISO 4217 code from a data registry; one rate table against USD; A→USD→B |
| Rates on records | `rateToEGP` + optional `ratesSnapshot` (missing on old records → today's rates) | Every record that can be projected carries `rateSnapshotId` (immutable, deduplicated snapshot table) |
| Display | EGP hard-coded on Home / Assets / Review / Goals; Analytics offers EGP or SAR | One `reportingCurrency` preference (+ per-screen override); everything is a projection |
| Cross-currency money | `transfer.toAmount`, with a default computed at today's rate | Only a recorded `exchange` (sent + received + fees). Transfers are same-currency |
| Funds | Free-floating "movements" with an optional currency; implicit FX ("covered by whichever money is available") | Account-backed reservations `{fundId, accountId, amount in the account's currency}`; hard invariant `Σ reservations(account) ≤ balance` |
| Overspending fund money | Allowed silently, repaired afterwards ("غطّي") | Blocked before saving; a cover sheet releases reservations atomically with the expense |
| Rounding | Ad-hoc `round2` in a few places; otherwise float everywhere and the display rounds | Round to currency decimals at every write and every aggregation boundary; sums in integer minor units |
| Countries | `'EG' \| 'SA'`, hard-coded in types and UI | ISO 3166-1 alpha-2 from a registry, data-only to extend |

Three phases after this document (A = this doc): **B** currency engine + precision, **C** ledger (exchange, fees,
same-currency transfers), **D** account-backed funds. One migration `v7 → v8` that grows with the phases (§F, §I).
None of the phases needs a native module, so they can ship through `eas update` to a 1.2.0 build (§I).

Top risks (detail in §J): legacy migration chain is coupled to current selectors; a failing migration today falls
back to the seed and overwrites storage at launch; invariant enforcement must cover *every* write path
(including auto-recorded recurring items); migrating funds to accounts can be ambiguous; rounding discipline is
cross-cutting.

---

## 1. Principles → enforceable invariants

The six agreed principles, each turned into something a test can check.

| # | Invariant | Enforced by |
|---|---|---|
| INV-1 | No stored native amount is a function of rates, preferences or the clock. Changing `reportingCurrency`, `planCurrency`, enabled currencies or rates changes no native amount and no historical projection. | Property test: snapshot the state, change those settings / push new rates, deep-equal every collection except `settings` and appended `rateSnapshots` |
| INV-2 | Each ledger entry is single-currency (income, expense, same-currency transfer, asset purchase, fee, reservation movement). The only currency boundary is an `exchange` with exactly two sides, both entered/confirmed by the user. | Validators in `operations.ts`; static test that `operations.ts` imports no conversion function except the whitelisted *suggestion* helpers (§D) |
| INV-3 | A rate snapshot is immutable and append-only. A projection of a past record uses only that record's snapshot. | No `update` on `rateSnapshots`; test with rate changes |
| INV-4 | `balance(account) = round(opening + Σ ledger effects)`, in the account's currency. | Selector + precision tests |
| INV-5 | For every account, after every committed operation: each `reservation(fund, account) ≥ 0` and `Σ_funds reservation(fund, account) ≤ max(0, balance(account))`. The only way to consume reserved money is a confirmed cover that releases reservations *in the same atomic patch*. | `assertInvariants(state)` run after every operation in unit tests and in a fuzz test |
| INV-6 | Every operation returns one patch or throws / returns `needsCover`; nothing is partially applied. | Fuzz test: failed operation leaves state deep-equal |
| INV-7 | Money values are rounded to the currency's decimals when written and when aggregated; aggregation sums integer minor units. | Precision tests (§H) |
| INV-8 | Reservations are a partition of cash, not extra money: moving, reserving or releasing never changes net worth. | Property test across random operation sequences |

About INV-5 and negative balances: the principle says "available must never go below 0". A balance that is itself
negative (an overdraft) is a different situation; see Open question Q1. The design allows it only on an explicit,
confirmed save, and such an account carries no reservations.

---

## A. Inventory

Classification legend: **E** = assumes EGP as base/pivot · **H** = hard-codes `EGP|SAR|USD` or `EG|SA` ·
**C** = converts between currencies · **T** = uses today's rate on a native or past amount (violates principle 3) ·
**I** = implicit FX (violates principle 2) · **OK** = conversion is legitimate (a current valuation or an amount
being typed now) but must move to the new engine. Phase = where the fix lands.

### A1. Types and constants

| Where | What it does | Class | Fix | Phase |
|---|---|---|---|---|
| `store/types.ts` `CurrencyCode` | Closed union of 3 codes | H | ISO string validated against `CURRENCY_REGISTRY` | B |
| `store/types.ts` `Location`, `NetWorthBreakdown {EG, SA}`, `LocationBreakdown {cashEGP…}` | Two countries as object keys; EGP amounts | H, E | `CountryCode` from `COUNTRY_REGISTRY`; `Record<CountryCode, …>`; values in `valuedIn` currency | B |
| `store/types.ts` `RatesSnapshot {SAR_EGP, USD_EGP}`, `ExchangeRates` | EGP-pivot pair, two currencies only | E, H | `RateTable` (USD base) + `RateSnapshot` (§B) | B |
| `store/types.ts` `TransactionBase.rateToEGP`, `ratesSnapshot?` | EGP pivot; snapshot optional (legacy gap) | E, T | `rateSnapshotId` required | B |
| `store/types.ts` `TransferTransaction.toAmount` | Cross-currency transfer is just a transfer | I | Split into `transfer` (same currency) and `exchange` | C |
| `store/types.ts` `FundMovement {amount, currency?, ratesSnapshot?}` | No account; `currency` optional ⇒ "covered by any money" | I | `ReservationMovement` with required `accountId` | D |
| `store/types.ts` `GoldHolding/CurrencyHolding.purchaseCostEGP` | Cost forced into EGP; native amount lost | E | `purchaseCost: Money` + snapshot | B |
| `store/types.ts` `Settings.goldPrice24kEGP/21kEGP`, `exchangeRates`, `lastGoldUsdPerOunce` | Market inputs in EGP; 2 rates | E, H | `settings.rates`, `settings.goldPrice {currency, perGram24k, perGram21k}` | B |
| `store/types.ts` `NetWorthSnapshot {netWorthEGP, liquidEGP, holdingsEGP, breakdown, ratesSnapshot?}` | Past net worth stored in EGP | E | `valuedIn` + `rateSnapshotId` (projectable to any currency) | B |
| `constants/currencies.ts` `DEFAULT_RATES`, `CURRENCIES`, `CURRENCY_NAMES_AR`, `CURRENCY_LABELS` | 3-currency registry, EGP-pivot default | H, E | `CURRENCY_REGISTRY` (code, symbol, names, decimals) + `DEFAULT_RATE_TABLE` | B |
| `constants/market.ts` `GOLD_PRICE_24K/21K` | EGP default gold prices | E | Default `goldPrice` object | B |
| `utils/formatters.ts` `CURRENCY_SYMBOLS`, `formatCurrency` | Symbols for 3 codes; always 0–2 decimals (wrong for JPY 0 / KWD 3) | H | Symbol + decimals from the registry; min 0 / max `decimals` | B |
| `store/operations.ts` `CURRENCY_CODES` (plan validation), `assertCurrency` | Hard-coded list | H | Registry lookup | B |
| `store/selectors.ts` `CURRENCY_ORDER`, `zeroByCurrency`, `liquidByCurrency` | Records over exactly 3 currencies | H | Record keyed by the currencies actually present | B/D |
| `store/recurring.ts` `CurrencyTotals`, `upcoming()` | `{EGP,SAR,USD}` totals | H | Open record | B |
| `store/analytics.ts` `DisplayCurrency = 'EGP' \| 'SAR'`, `parseDrillParams` (accepts only EGP/SAR), `['EGP','SAR','USD']` in `moneyMap`/`runway`, `['EG','SA']` in `byLocation` | Hard-coded display set and countries | H | `CurrencyCode` + enabled list; countries from data | B |
| `store/planning.ts` `DEFAULT_PLAN_CURRENCY = 'SAR'` | Plan default baked into code | H | `settings.planCurrency` | B |

### A2. Conversion engine and price feeds

| Where | What it does | Class | Fix | Phase |
|---|---|---|---|---|
| `utils/currency.ts` `rateToEGP` (switch over 3 codes), `toEGP`, `fromEGP`, `convertCurrency`, `snapshotRates` | Whole engine is EGP-pivot over 3 codes | E, H, C | New `convert(amount, from, to, table)` via USD; `roundMoney`; `project()` | B |
| `utils/currency.ts` `historicalAmountIn` | Falls back to *today's* rates for the target leg when the record has no snapshot | T | Snapshot required after migration (§F gives migrated records an *estimated* frozen snapshot) | B |
| `utils/prices/calc.ts` `RANGES`, `fxFromUsdRates` (extracts only EGP and SAR), `goldPricesEGP` | Hard-coded sanity ranges for two currencies; gold in EGP | H, E | Parse the whole USD table for enabled currencies; per-currency relative-change guard; gold in `goldPrice.currency` | B |
| `utils/prices/fetchPrices.ts` `fetchLivePrices`, `PriceFetchResult.fx: RatesSnapshot` | Returns the 2-number snapshot | E | Return `RateTable` | B |
| `store/operations.ts` `updateRates`, `updateSettings`, `applyLivePrices`, `setPricePreferences`, `replaceWithSeed` | All speak `SAR_EGP/USD_EGP` and EGP gold prices | E, H | Operate on `settings.rates` / `goldPrice`; append a snapshot when rates change and a record is next written | B |
| `app/settings.tsx` (rate form + read-only rows "ريال سعودي ← جنيه", gold 24/21 in EGP) | Two rate fields, EGP gold | H, E | List of enabled currencies, "1 X = ? reporting"; gold currency picker | B |

### A3. Selectors and read models

| Where | What it does | Class | Fix | Phase |
|---|---|---|---|---|
| `selectors.ts` `accountBalanceEGP`, `liquidTotalEGP`, `holdingValueEGP`, `holdingPnlEGP`, `holdingsTotalEGP`, `totalAssetsEGP`, `liabilitiesTotalEGP`, `netWorthEGP`, `netWorthBreakdown`, `netWorthFigures`, `netWorthByLocation`, `stateSummary` | Current valuations (today's rates: correct) but the output currency is EGP and countries are `EG/SA`; liabilities silently attributed to Egypt | E, H, OK | Take `to: CurrencyCode` (default `reportingCurrency`); liabilities get `country` | B |
| `selectors.ts` `netWorthAsOf` | "As of" net worth at *current* rates and prices (no history) | T (documented approximation) | Keep, label as estimate; its output feeds estimated snapshots only | B |
| `selectors.ts` `transactionAmountIn` | Historical conversion via `historicalAmountIn` | C, T (pre-snapshot records) | Use `rateSnapshotId` | B |
| `selectors.ts` `transactionNetEGP`, `groupTransactionsByDay.netEGP`, `monthSummary`, `monthFlows`, `suggestedEmergencyTarget` | `amount * rateToEGP` hard-coded EGP | E | Project through the record's snapshot to `reportingCurrency` | B |
| `selectors.ts` `movementAmountIn` | Historical, but falls back to today's rates when the movement has no snapshot | T | Snapshot required | B/D |
| `selectors.ts` `movementValueInFund` (used by `monthPace`, `fundStatus`, `fundMonthShortfall`, `analytics.fundsProjection`) | A *past* movement valued at **today's** rate to judge "allocated this month" | T | Use the movement's own snapshot for "this month" flows; today's rate only for current balances | D |
| `selectors.ts` `fundAllocated`, `fundCashByCurrency`, `fundAllocatedIn`, `fundCurrent`, `fundProgress`, `fundRequiredMonthly`, `fundSuggestedMonthly`, `fundLinkedValue` | Per-currency cash from account-less movements, valued at today's rate in the fund currency (valuation) | C, OK | Cash = Σ reservations per account (native), valued at current rates | D |
| `selectors.ts` `unassignedByCurrency` (steps 1–3) | Currency-less movements draw on *other currencies at today's rate*, deficits net across currencies | **I** | Replaced by `Σ available(account)` per currency; no netting | D |
| `selectors.ts` `unassignedSummary`, `unassignedEGP`, `unassignedEGPWithFundCash`, `fundAmountsEGP` | EGP totals | E | Reporting-currency totals | D |
| `selectors.ts` `withdrawalPlan` | Takes fund cash from other currencies "converted at today's rate" | **I** | Removed: release works per account | D |
| `selectors.ts` `planCover` (+ `remainingEGP`), `defaultCoverFundId` | Covers a currency deficit from funds | E | Cover operates per account and always reaches 0 | D |
| `selectors.ts` `suggestAllocation(state, amountEGP)`, `suggestAllocationIn` | Fund suggestions converted at today's rate | OK (a suggestion about the future) | Keep, new engine, produce per-account splits | D |
| `analytics.ts` `scan`, `totalsOf`, `fundsNet`, `drillTransactions`, `netWorthSeries` (`fromEGP(egp, currency, rates)` over snapshot rates), `moneyMap` (`fromEGP(...)` at today's rates), `runway` (`convertCurrency` at today's rates), `fundsProjection` | Historical parts use record snapshots (good); everything pivots on EGP; `DisplayCurrency` is EGP/SAR | E, H, C | Reporting currency; same historical/current split, new engine | B (D for funds) |
| `planning.ts` `convert`, `recurringMonthly`, `suggestedContributions`, `spendImpact`, `amountInCurrency`, `planProgress` | Future amounts at today's rates (legit); past spending via snapshots (legit) | OK, C | New engine; plan currency preference | B |
| `review.ts` `monthReview` (`amountEGP = tx.amount * tx.rateToEGP`, `fundCurrency = plan?.currency ?? 'EGP'`) | EGP-only review | E | Reporting currency | B |
| `nextActions.ts` `amountToShow`, emergency rule (`toEGP(fundCurrent…)`, `'EGP'` literals), "uses foreign currency" rule (`!== 'EGP'`), rule 2 "fund money spent" | EGP assumptions; rule 2 exists only because overspending is allowed | E, H | Reporting currency; rule 2 replaced by "needs cover" / "unresolved reservations" | B/D |
| `snapshots.ts` `snapshot`, `netWorthChange` (`amountEGP`) | EGP snapshots | E | `valuedIn` + `rateSnapshotId` | B |
| `backup.ts` `BackupPreview.netWorthEGP` | EGP preview | E | Reporting currency | B |

### A4. Operations (write paths)

| Where | What it does | Class | Fix | Phase |
|---|---|---|---|---|
| `operations.ts` `addTransaction` | `rateToEGP: input.rateToEGP ?? rate(...)`, `ratesSnapshot` | E | `rateSnapshotId: ensureSnapshot()`; no free `rateToEGP` override | B |
| `operations.ts` `addTransfer` | `toAmount ?? convertCurrency(amount, from, to, rates)` — a cross-currency transfer without an explicit received amount gets today's rate | **I** | Same-currency only; cross-currency ⇒ `addExchange` with required `receivedAmount` | C |
| `operations.ts` `updateTransaction` (`transactionCurrency`, `keepRates`) | Re-snapshots when currency changes | E | New snapshot only when the currency changes (kept) | B/C |
| `operations.ts` `buyGold`, `updateGoldPurchase`, `syncPurchaseCost` | Cost = `amount × rateToEGP` (EGP) | E | `purchaseCost = {amount, currency}` natively | B/C |
| `operations.ts` `newMovement`, `allocateToFund`, `withdrawFromFund` | Optional `currency` ⇒ fund currency, "covered by whichever money is available" | **I** | `reserve/release(fundId, accountId, amount)` | D |
| `operations.ts` `worsensShortfall`, `allocateMany`, `withdrawMany` | Shortfall measured in EGP, netted across currencies | I, E | Per-account `available` check | D |
| `operations.ts` `editFund` (`cashAllocation` adjustment, comment "covered by any currency's money") | Sets a fund's cash by an unattributed adjustment | **I** | Edit details only; reservations edited through reserve/release | D |
| `operations.ts` `paySinkingFund` | Expense + `withdrawalPlan` at today's rate | I | Expense with `fundId`; `spend` movement on the paying account | D |
| `operations.ts` `updateFundMovement`, `deleteFundMovement`, `deleteFund` | Free edits, no balance check | — | Reservation-aware validation; `deleteFund` releases | D |
| `operations.ts` `updateAccount`/`deleteAccount`/`accountInUse` | Currency lock when used by transactions | — | "In use" includes reservations | D |
| `operations.ts` `occurrenceTransaction`, `processDue`, `confirmOccurrence` | Cross-currency recurring transfer: if the amount is overridden, `toAmount` is recomputed at today's rate | **I** | Recurring `exchange` requires explicit `receivedAmount`; `processDue` never records something that would breach INV-5 (§C, R3) | C/D |
| `operations.ts` `validatePlan` | `CURRENCY_CODES` list | H | Registry | B |

### A5. UI

| Where | What it does | Class | Fix | Phase |
|---|---|---|---|---|
| `components/dashboard/NetWorthCard.tsx`, `MonthlySnapshot.tsx`, `app/review.tsx`, `app/assets.tsx` totals, `components/assets/HoldingSheet.tsx`, `assetsUi.signedDifference`, `components/settings/RestoreSheet.tsx` | EGP `<Money currency="EGP">` literals | E | Reporting currency | B |
| `app/assets.tsx` (currency segment `[EGP,SAR,USD]`, location segment, `LOCATION_LABELS`, `purchaseCostEGP: toEGP(...)`, `converted EGP` rows), `components/assets/EditAccountSheet.tsx`, `assetsUi.groupAccountsByLocation`, `components/transactions/GoldFields.tsx` | Hard-coded options and conversion into EGP at today's rate | H, E, C | Options from the registries; native cost | B |
| `components/transactions/TransactionRow.tsx` (`converted: tx.amount * tx.rateToEGP`, `from?.currency ?? 'EGP'`), `app/(tabs)/transactions.tsx` (`day.netEGP`) | EGP secondary line | E | Projection via snapshot | B |
| `components/transactions/TransactionSheet.tsx` (`convertedToAmount` auto-follow, `impactCurrency ?? 'EGP'`, `currency={amountCurrency ?? 'EGP'}`) | Cross-currency transfer prefilled and *followed automatically* at today's rate until edited | **I** | Exchange sheet: received amount is a required, visible field; market value shown only as a labelled suggestion | C |
| `components/recurring/RuleSheet.tsx` (`currency ?? 'EGP'`, `toAmount`) | Cross-currency recurring transfer | I | Recurring exchange, `confirm` mode only | C |
| `components/analytics/*` (`CURRENCY_OPTIONS`, `LOCATIONS`, `MoneySections` currency list) and `app/(tabs)/analytics.tsx` (`useState('EGP')`) | Hard-coded display options | H | Enabled currencies, default = preference | B |
| `components/plan/PlanEditorSheet.tsx` (currency segment `[SAR,EGP,USD]`; "changing the currency converts every amount at current rates"), `AddLineSheet.tsx` | Plan amounts rewritten by FX when the plan currency changes | C, OK | Keep as an explicit user action but show the rate used and confirm | B |
| `components/funds/*` (`AssignSheet`, `MoveMoneySheet`, `CoverSheet`, `FundSheet`, `PaySinkingSheet`, `UnassignedPanel`, `fundsUi.ts`, `app/fund/[id].tsx`, `app/(tabs)/goals.tsx`) | Per-currency movement UI, EGP totals, free "cash allocation" text field, previews at today's rate | I, E, C | Account-backed sheets (§D) | D |
| `components/ui/Money.tsx` `converted` prop | Secondary line | — | Fed by `project()` | B |

### A5b. Seeds, migrations, tests (hidden coupling)

| Where | What it does | Class | Fix | Phase |
|---|---|---|---|---|
| `store/migrations.ts` imports `holdingValueEGP`, `liquidTotalEGP` (v1→v2) and `missingPastSnapshots` (v6→v7, which calls current `netWorthAsOf`) | **Old migrations run today's selectors.** After v8 changes the selectors, restoring a v1–v6 backup would run v8 code on v7-shaped data | — | Freeze the v1–v7 chain with its own types and helpers (§F12) | B |
| `store/seed.local.ts` / `seed.example.ts` | Written in the v3 shape (`rateToEGP`, `location`) and run through the chain; `seed.local` transactions have **no** `ratesSnapshot` | — | Unchanged; they flow through the frozen chain + v8 step | B |
| `store/useFinanceStore.ts` `migrate` / `onRehydrateStorage` | On a failing migration the store keeps the seed, sets `hasHydrated`, and the callback's own `setState` persists the seed over the real data at launch (§J R2) | — | Fail-closed hydration | B |
| `tests/logic.test.ts` (274 tests; my estimate from the suite names is that roughly 40% touch `rateToEGP`, `fundMovements`, `unassigned*`, transfers, plan conversion, "native amounts never drift", analytics or migrations) | Written against the v7 API | — | Rewrite per phase; freeze v7 selectors as a test-only oracle (§H) | B–D |

---

## B. Target data model

Types are illustrative TypeScript; names may change in review, shapes should not. Everything keeps `Synced`
(`updatedAt`) and the tombstone log.

### B1. Currencies, countries, rates

```ts
export type CurrencyCode = string;            // ISO 4217 alpha-3; must exist in CURRENCY_REGISTRY
export type CountryCode  = string;            // ISO 3166-1 alpha-2; must exist in COUNTRY_REGISTRY

// constants/currencies.ts — DATA. Adding a currency = adding an entry.
export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;                             // 'ج.م', 'ر.س', '$', 'د.ك', '¥'
  nameAr: string;
  nameEn: string;
  decimals: number;                           // ISO 4217 minor-unit exponent: EGP 2, SAR 2, USD 2, KWD 3, JPY 0
}
export const CURRENCY_REGISTRY: Record<CurrencyCode, CurrencyMeta>;   // ships: EGP, SAR, USD

// constants/countries.ts — DATA.
export interface CountryMeta { code: CountryCode; nameAr: string; defaultCurrency?: CurrencyCode }
export const COUNTRY_REGISTRY: Record<CountryCode, CountryMeta>;      // ships: EG, SA

// Units of each currency per 1 USD. perUsd.USD === 1 always.
export interface RateTable { base: 'USD'; perUsd: Record<CurrencyCode, number> }

// Immutable, append-only, deduplicated. id = first 16 hex of sha256(canonical JSON of {perUsd, quality}),
// so the same table always has the same id (idempotent migration, future multi-device merge).
export interface RateSnapshot extends RateTable {
  id: string;
  takenAt: string;                            // ISO, first time this table was recorded
  source: 'manual' | 'open.er-api' | 'exchangerate.fun' | 'migrated';
  quality: 'recorded' | 'estimated';          // 'estimated': rebuilt by the migration for a legacy record (§F2)
}
// state.rateSnapshots: RateSnapshot[]

// settings.rates: the CURRENT table (what current valuations use). Mutable (user edit / live fetch).
export interface CurrentRates extends RateTable { updatedAt: string; source: RateSnapshot['source'] }
```

**Conversion.** `convert(amount, from, to, table)` = `amount / table.perUsd[from] * table.perUsd[to]`; same
currency returns `amount` untouched (no float noise); throws `RATE_MISSING` if a code is absent. It returns an
*unrounded* float; the caller rounds once, at the boundary, with `roundMoney(x, currency)`.

**`project(record, to)`** (historical) uses the record's snapshot; **`value(amount, from, to)`** (current
valuation) uses `settings.rates`. These are the only two ways a number changes currency in a read model.

**Snapshot lifecycle.** `ensureSnapshot(state)` runs inside every operation that writes a record needing
rates: if the latest snapshot equals `settings.rates.perUsd` it returns its id; otherwise it appends a new
snapshot (patch includes `rateSnapshots`). A snapshot only contains the *enabled* currencies
(`settings.enabledCurrencies`), which keeps it tiny. If a currency is enabled later, the app immediately appends a
snapshot containing it; a historical projection into a currency absent from a record's snapshot uses the
**earliest** snapshot that contains it and is marked approximate (`≈`) — stable, because that earliest snapshot
never changes.

**Storage cost.** About 150 bytes per snapshot (id, time, source, three rates) × ≤ 365 per year ≈ 55 KB/year worst
case (a new snapshot only when the rates changed and something was written). Today's AsyncStorage payload is one JSON key; no size problem is
expected below ~2 MB (Android's default quota is 6 MB).

### B2. Preferences

```ts
interface Settings {
  rates: CurrentRates;
  enabledCurrencies: CurrencyCode[];          // ≥ 1; currencies offered in pickers and kept in snapshots
  reportingCurrency: CurrencyCode;            // default for every projection (Home, Assets, Review, Analytics…)
  planCurrency: CurrencyCode;                 // default for new monthly plans (each plan still keeps its own currency)
  goldPrice: { currency: CurrencyCode; perGram24k: number; perGram21k: number; updatedAt: string };
  // priceSource, localPremiumPct, lastPriceFetchAt, lastPriceFetchError, fxSource, lastGoldUsdPerOunce,
  // trackingStartDate, deviceId, lastBackupAt, appLockEnabled, dueNotificationsEnabled, lastUsed — unchanged
}
```

Screens may override `reportingCurrency` locally (Analytics already has its own switch); the override is UI state,
never persisted data (INV-1).

### B3. Accounts

```ts
interface Account extends Synced {
  id: string; name: string; type: 'cash' | 'bank' | 'wallet';
  currency: CurrencyCode;                     // locked once the account is used by a transaction or a reservation
  openingBalance: number; openingDate?: string;
  country: CountryCode;                       // was `location`
  allowNegative?: boolean;                    // default false; see Q1
  createdAt: string; archived?: boolean;
}
```

Balance, reserved and available are **derived** (§E), never stored.

### B4. Transactions

```ts
interface TxBase extends Synced {
  id: string; date: string; note?: string; createdAt: string;
  rateSnapshotId: string;                     // replaces rateToEGP + ratesSnapshot
  recurringRuleId?: string; occurrenceDate?: string;
}
interface Fee { accountId: string; amount: number; categoryId?: string }   // amount in that account's currency, > 0

interface IncomeExpense extends TxBase {
  type: 'income' | 'expense'; accountId: string; currency: CurrencyCode;   // currency === account.currency (validated)
  amount: number; categoryId: string; liabilityId?: string; oneTime?: boolean;
  fundId?: string;                            // expense paid out of a fund's reservation (sinking-fund payment)
}
interface Transfer extends TxBase {           // SAME currency only
  type: 'transfer'; fromAccountId: string; toAccountId: string;
  amount: number;                             // leaves `from`, arrives in `to`
  fees: Fee[];                                // each charged to `from` or `to`; default []
}
interface Exchange extends TxBase {           // currencies differ
  type: 'exchange'; fromAccountId: string; toAccountId: string;
  sentAmount: number;                         // from.currency
  receivedAmount: number;                     // to.currency — entered by the user, never computed
  fees: Fee[];
}
interface AssetPurchase extends TxBase {
  type: 'asset_purchase'; accountId: string; currency: CurrencyCode; amount: number; holdingId: string;
}
```

**Account effect** of each transaction: income `+amount`; expense and asset purchase `−amount`; transfer
`from −amount`, `to +amount`; exchange `from −sentAmount`, `to +receivedAmount`; every fee `−fee.amount` on
`fee.accountId`. **Reporting effect:** fees are expenses (category "رسوم", added as a default category by the
migration); transfers and exchanges are *not* income or spending. The effective rate of an exchange is
`receivedAmount / sentAmount` (derived, displayed, never stored). No realized FX gain/loss is tracked (Q9).

### B5. Fund reservations

```ts
interface Fund extends Synced {
  id: string; name: string; type: 'emergency' | 'goal' | 'sinking';
  targetAmount: number; currency: CurrencyCode;   // the TARGET's currency; it does not restrict what is reserved
  deadline?: string; priority: number; monthlyContribution?: number;
  linkedHoldingIds: string[]; createdAt: string; archived?: boolean;
  frequency?: SinkingFrequency; nextDueDate?: string;
}

type ReservationKind =
  | 'reserve' | 'release'                  // user puts money aside / gives it back
  | 'reallocate'                           // pair: one fund → another, same account (groupId)
  | 'follow_transfer'                      // pair: reservation moves with a same-currency transfer (groupId = tx id)
  | 'follow_exchange'                      // pair: reservation converted by an exchange at its recorded rate
  | 'spend'                                // a sinking-fund payment consumed it (sourceTransactionId)
  | 'cover'                                // released to cover spending/edit (sourceTransactionId)
  | 'adjust';                              // migration / repair only

interface ReservationMovement extends Synced {
  id: string; fundId: string; accountId: string;
  amount: number;                          // signed, in the ACCOUNT's currency (never stores a currency of its own)
  kind: ReservationKind; groupId?: string; sourceTransactionId?: string;
  date: string; note?: string; rateSnapshotId: string;   // so "saved this month" can be projected historically
}
// state.reservationMovements (replaces fundMovements)
// reservation(fund, account) = round(Σ amount); never stored.

// Migration-only quarantine (§F7). Counts toward the fund's total, never toward an account's available.
interface UnresolvedMovement { id; fundId; amount; currency; date; note?; reason: 'ambiguous' | 'insufficient' | 'negative' | 'no_account' }
// state.unresolvedMovements: [] after resolution
```

### B6. Holdings, liabilities, snapshots

```ts
interface Money { amount: number; currency: CurrencyCode }
GoldHolding     { …; weightGrams; karat; purchaseCost: Money; purchaseRateSnapshotId: string; country: CountryCode }
CurrencyHolding { …; currency; quantity; purchaseCost: Money; purchaseRateSnapshotId: string; country: CountryCode }
Liability       { …; principal; currency; country: CountryCode }       // country 'EG' on migration = today's behavior
NetWorthSnapshot{ id; month; valuedIn: CurrencyCode; netWorth; liquid; holdings;
                  breakdown: Record<CountryCode, { cash; gold; currencies; liabilities }>;
                  rateSnapshotId; takenAt; estimated? }
RecurringRule   { …; kind: 'income' | 'expense' | 'transfer' | 'exchange'; fees?: Fee[]; toAmount? /* exchange: receivedAmount */ }
```

A gold or currency holding bought through an `asset_purchase` takes its `purchaseCost` from that transaction in
the account's native currency (today's code already guarantees `purchaseCostEGP = amount × rateToEGP`, so the EGP
value is identical, but the native amount is no longer lost).

---

## C. Rules and examples

**Fake numbers.** Rates `R1`: `perUsd` EGP 50, SAR 4, USD 1, so 1 SAR = 12.5 EGP (SAR 4 keeps arithmetic clean).

Starting state used by every example:

| Account | Currency | Balance | Reserved | Available |
|---|---|---|---|---|
| A1 كاش مصر | EGP | 20,000 | 8,000 (F1) | 12,000 |
| A2 بنك | SAR | 5,000 | 2,500 (F2 2,000 + F3 500) | 2,500 |
| A3 كاش ريال | SAR | 1,000 | 0 | 1,000 |

Funds: F1 طوارئ (target EGP, priority 1), F2 سفر (SAR, 2), F3 تأمين (sinking, SAR, 3 — lowest priority).

**Shortfall rule used below.** For an account and an operation: `shortfall = max(0, Σ reservations − max(0,
balance_after))`. If `shortfall = 0` the operation saves with no prompt.

### C1. Expense within available — no prompt
Expense 300 SAR on A2. Available 2,500 ≥ 300. Saves immediately. A2: balance 4,700, reserved 2,500, available
2,200. No reservation movement.

### C2. Expense touching reserved money — cover sheet, atomic
Expense 2,800 SAR on A2. Available 2,500 → shortfall 300. **Before saving**, the Cover sheet appears: "المصروف ده
أكبر من المتاح بـ 300 ر.س. هتاخدهم من صناديق: [تأمين ✓ 500] [سفر 2,000]". Default selection: lowest priority first
(F3). The sheet's Save button is enabled only when the selection covers the shortfall exactly.
On confirm, **one patch**: the expense + `ReservationMovement{F3, A2, −300, kind:'cover', sourceTransactionId}`.
Result: A2 balance 2,200; reserved F2 2,000 + F3 200 = 2,200; available 0. Cancel ⇒ nothing is written.

*Sinking fund payment* (the fund's own money): F3 pays a 400 SAR bill from A2 ⇒ expense (`fundId = F3`) +
`spend{F3, A2, −400}`; no cover prompt (it is the fund's money). A2 balance 4,600, F3 100, available 2,500. A
700 SAR bill: 500 from F3's reservation, 200 from available (no prompt while available ≥ 200; otherwise the
shortfall goes through a cover).

### C3. Same-currency transfer moving reservations — no prompt, inline notice
- Transfer 2,000 SAR A2 → A3, 2,000 ≤ available 2,500: only available money moves. A2 balance 3,000, reserved 2,500,
  available 500; A3 balance 3,000, available 3,000.
- Transfer 4,000 SAR A2 → A3 (initial state): the part above available (4,000 − 2,500 = 1,500) is reserved money
  that must leave A2. Default split proportional to each fund's reservation on A2: F2 80% → 1,200, F3 20% → 300
  (largest-remainder rounding; the last fund takes the remainder). Four movements `follow_transfer`
  (`groupId = tx.id`): `F2 A2 −1,200`, `F2 A3 +1,200`, `F3 A2 −300`, `F3 A3 +300`. Result A2: balance 1,000, reserved
  1,000, available 0. A3: balance 5,000, reserved 1,500, available 3,500. The sheet shows "1,500 ر.س من فلوس
  الصناديق هتتنقل مع التحويل" with an edit link; it is a notice, **not** a confirmation (no fund loses money).

### C4. FX exchange with reservations and fees
Fees go to the account named in the fee; reserved money is only ever *converted* for the exchanged amount, never
for fees (fees must fit in available, else they are a cover like any expense).

- **Within available.** Exchange 1,000 SAR (A2) → 12,400 EGP (A1), bank fee 5 SAR on A2. Outflow 1,005 ≤ 2,500.
  A2 balance 3,995, available 1,495. A1 balance 32,400, available 24,400. Effective rate 12.4 (market 12.5, 0.8%
  lower, shown as a hint). The fee is a 5 SAR expense in "رسوم". Net worth moved only by the spread and the fee.
- **Touching reservations** (initial state). Exchange 3,000 SAR → 37,200 EGP (12.4), fee 5 SAR on A2. Available
  after the fee: 2,495; shortfall for the exchanged amount: 3,000 − 2,495 = 505. A confirmation is required:
  "505 ر.س من فلوس الصناديق هتتحوّل لجنيه بسعر 12.4: سفر 404 → 5,009.60 ج.م، تأمين 101 → 1,252.40 ج.م". Movements
  `follow_exchange` (one group): `F2 A2 −404`, `F2 A1 +5,009.60`, `F3 A2 −101`, `F3 A1 +1,252.40` (404 × 12.4,
  101 × 12.4; the two EGP amounts add to 6,262.00 = 505 × 12.4). Result: A2 balance 1,995, reserved 1,596 + 399 = 1,995,
  available 0. A1 balance 57,200, reserved 8,000 + 5,009.60 + 1,252.40 = 14,262.00, available 42,938.00. F2 is now
  reserved across SAR and EGP accounts; its value at today's rate is 1,596 + 5,009.60 / 12.5 = 1,996.77 SAR (the 3.23
  SAR drop is exactly the 0.8% spread on 404 — visible as a valuation, not recorded as a gain/loss).
- **Rules.** The exchange is `sentAmount` + `receivedAmount` + `fees`, validated: currencies differ, amounts > 0,
  fee accounts ∈ {from, to}. `receivedAmount` is a required field; the market-rate value is shown beside it as a
  labelled suggestion (and a soft warning when it differs from market by more than 5%).

### C5. Deleting or editing transactions that reservations depend on
What reservations depend on: (1) money-increasing entries (income, transfer-in, exchange-in, opening balance up);
(2) `follow_*` movements tied to a transfer/exchange; (3) `cover`/`spend` movements tied to an expense. The rule is
one function: **compute the final state of the edit, then validate INV-5; if it fails return `needsCover`.**

| Operation | Behavior |
|---|---|
| Delete income of 3,000 SAR on A2 (initial balance 5,000 ⇒ 2,000 < reserved 2,500) | `needsCover{A2, 500}` ⇒ Cover sheet (default F3 500). Confirm ⇒ delete + `cover` movement in one patch; cancel ⇒ unchanged |
| Edit expense amount / account | Treated as delete + add for balance purposes; final state validated; shortfall ⇒ cover |
| Delete a transfer / exchange that has `follow_*` movements | Reverse the ledger effect and the movement group (reservations return to the source account). If a fund already released or spent some of that money on the destination, the reversal is capped at what is still reserved there and the rest is validated normally (may need a cover). Delete of an exchange also removes its fees |
| Edit an exchange | Reverse both legs, the fees and the `follow_exchange` group, then apply the new values with the same algorithm; all or nothing |
| Delete an expense that had `cover` movements | Expense removed; the released reservations are **not** re-created automatically. Optional one-tap offer "رجّع المبلغ للصناديق" (Q4) |
| Edit opening balance ("set current balance") down | Same as deleting income: validated, may need a cover |
| Archive / delete an account | Blocked while it has transactions or non-zero reservations |
| Delete a fund | Its reservations become available (existing delete confirmation text updated); linked holdings unlink as today |

Invariants are enforced on the **present** state only; the history of reservations is never rebuilt retroactively
(back-dated edits are validated by what is true now).

### C6. Fees
- Same-currency transfer 1,000 SAR A2 → A3 with a 5 SAR fee: A2 −1,005, A3 +1,000, one 5 SAR expense (category
  "رسوم"). The transfer itself is not spending. The fee account defaults to the source and may be set to the
  destination.
- Exchange with a destination-side fee: 1,000 SAR → 12,400 EGP, fee 30 EGP on A1 ⇒ A2 −1,000, A1 +12,370.
- Fees count as expenses in Analytics, plan progress and safe-to-spend (they are real costs), always projected
  through the transaction's own snapshot.

### C7. Auto-recorded recurring items
`processDue` has no user to ask. An `auto` occurrence that would breach INV-5 is **not recorded**: it stays in the
due inbox as a `confirm` item flagged "محتاج تغطية" and a Next Best Action points to it. Recurring `exchange`
rules are `confirm` mode only (an unknown executed rate must not be auto-recorded).

---

## D. UX defaults

Goal: no routine action asks for an account the system can choose.

### D1. Defaults (no prompt)

| Action | Account / currency behavior |
|---|---|
| Add income / expense | As today: `lastUsed[type].accountId` (falls back to the first active account). The user sees and can change it, but is never forced |
| Reserve to a fund | Currency = the fund's target currency (changeable). Account = the account in that currency with the largest *available*; ties ⇒ last used for reserving, then oldest. If one account cannot cover it, the amount is split across accounts in that currency (largest available first) and the sheet shows "600 من بنك، 400 من كاش". No account picker unless the user taps "غيّر" |
| Distribute many funds (`AssignSheet`) | Same engine per fund; currency chosen once at the top (as today) |
| Release / withdraw from a fund | Largest reservation first, across accounts, in the chosen currency |
| Reallocate between funds | Source account = where the source fund has the most reservation in the chosen currency; split across accounts if needed |
| Sinking-fund payment | Paying account = account holding the fund's largest reservation; fallback `lastUsed.expense` |
| Cover sheet | Default funds = lowest priority first; the default selection already covers the shortfall |
| Transfer | From / to as chosen; reservations follow automatically (C3) |
| Exchange | From / to as chosen; received amount pre-suggested, required to be visible and saved as shown |

Ties are always broken deterministically (largest, then oldest account id), never by asking. The only account
prompts left are the ones that define the action itself (new transaction, transfer/exchange from→to).

### D2. Exactly when a confirmation is required

1. **Cover** — any operation that would consume reserved money for spending (expense, asset purchase, fee, edit
   that lowers the balance below Σ reservations).
2. **Exchange converting reservations** — the shortfall of the exchanged amount comes from reserved money.
3. **Edit/delete whose final state breaks INV-5** — resolved through the cover sheet or cancelled.
4. **A transaction that makes an account's balance negative** on an account without `allowNegative` (Q1).
5. **Delete a fund or an exchange** (destructive; existing pattern).
6. **Resolving unresolved legacy reservations** (one-time sheet, §F7).
7. **Exchange rate far from market** (soft warning above 5%).

Not confirmations: expense/income within available, reserve (blocked if above available — an error, not a
prompt), release, reallocate, transfers (even when reservations follow — a notice only), fee entry, edits that
keep the invariants.

### D3. The one place suggestions use a market rate
Suggestions (future-looking or being typed now) may use today's rate: fund monthly suggestions across currencies,
plan suggestions, the exchange sheet's "suggested received amount", `spendImpact`. They are labelled and never
silently saved: `operations.ts` may import only a whitelisted `suggest*`/`market*` helper from the engine; a static
test fails the build if it imports `convert`/`value`/`project` directly (INV-2).

---

## E. Read models

All pure functions of the state; amounts native unless the name says `In`. Rate policy in the last column.

| Read model | Definition | Rates |
|---|---|---|
| `accountBalance(a)` | `round(opening + Σ effects)` in the account's currency | none |
| `accountReserved(a)` | `Σ_funds reservation(fund, a)` | none |
| `accountAvailable(a)` | `balance − reserved` | none |
| `accountsView()` | per account: balance, reserved, available, `byFund[]`, country | none |
| `currencyView(c)` | Σ balance / reserved / available over accounts in `c` (native, no conversion) | none |
| `fundView(f)` | `byAccount[] {accountId, currency, amount}`, `byCurrency{}`, `linkedValue`, `valueInFundCurrency` = Σ `value(amount, accountCurrency, fund.currency)` + linked, `progress` | **current** (valuation) |
| `unassigned()` | `Σ available` per currency (no netting between currencies); `totalIn(reporting)` = `Σ round(value(...))` | native: none; total: current |
| `netWorth(to = reporting)` | `Σ round(value(balance_a)) + Σ round(value(holding)) − Σ round(value(liability))`, summed in minor units. Reservations are not added (INV-8) | **current** |
| `netWorthByCountry(to)` | same, grouped by `country` (liabilities by their own `country`) | current |
| Analytics / month summary / plan progress / review (flows) | `Σ round(project(record, reporting))` over income, expense and fees | **record snapshot** |
| Funds "saved this month" | Net of `reserve`, `release`, `spend`, `cover`, `adjust` movements of the month, each `project`ed with its own snapshot; `reallocate` and `follow_*` pairs excluded (zero-sum) | record snapshot |
| Net worth history | Each snapshot's own figures re-projected from `valuedIn` using *its* `rateSnapshotId` | snapshot |
| Runway | Balances / unassigned: current rates; average essentials: record snapshots | mixed, as today |
| Holdings P&L | `value(holding now) − project(purchaseCost, reporting)` using the purchase snapshot | current − snapshot |

**Aggregation rule (INV-7).** Project each item, round it to the reporting currency's decimals, then sum in
integer minor units ("sum of rounded parts"), so listed rows always add up to the shown total. The difference from
"round the sum" is at most half a minor unit per row; it is accepted on purpose.

**Rounding helper** (`utils/money.ts`):
- `roundMoney(x, code)` — half away from zero, computed on the decimal representation so `1.005 → 1.01` and
  `-1.005 → -1.01` (a plain `Math.round(x * 100) / 100` gives `1`). The exponent-string trick
  (`Number(Math.round(Number(abs + 'e' + d)) + 'e-' + d)`) fails for values JS prints in exponent form
  (`1e-7`, `1e21`), so the real implementation must handle those; B5 includes them.
- `toMinor/fromMinor`; `sumMoney(values, code)` (minor-unit sum); `splitMoney(total, weights, code)` (largest
  remainder, sums exactly).
- Called at: every operation input that becomes stored, every `ReservationMovement` amount, every conversion result
  that is stored or shown as money, every aggregate.

**Where floats can still drift (documented, not eliminated).**
1. Stored decimals are binary approximations (0.1 + 0.2 ≠ 0.3). Mitigation: round at write; sum in minor units. The
   seed already shows the problem today: `monthSummary` returns `13889.849999999999` for August's net.
2. A conversion is `a / perUsd[from] * perUsd[to]` — two roundings of order 1e-16 relative. Harmless once rounded
   to the currency's decimals, except when the exact result lies on a half-unit boundary (then the half-away rule
   is applied to a value that may be a hair off the boundary). Property test in §H.
3. Rates are floats; a rate typed as `47.1234` is stored as the nearest double.
4. Integers above 2^53 (≈ 9×10^13 major units at 2 decimals) lose exactness. Not reachable for personal finance.
5. Ratios and averages (percentages, runway months, monthly averages) are not money and are not rounded.
6. `toLocaleString` formatting (Hermes vs V8) can differ on exact halves; the formatter is fed values already
   rounded to the currency's decimals so no display rounding happens.
7. `planSuggestion` rounds limits to whole units (`Math.round`) regardless of currency decimals (a KWD plan limit
   loses its fraction); plans are whole-unit by design.

**Future option, not in this scope:** integer minor units (or BigInt) for stored amounts. It removes drift at the
root but touches every amount, parser, formatter and rate multiplication. The helpers above isolate the
representation, so the later switch is a data migration plus changes inside `utils/money.ts`.

---

## F. Migration v7 → v8

Pure, deterministic, idempotent, no React Native imports; runs on a normal v7 state, on restored v7 backups and
(through the chain) on v1–v6.

### F1. Before migrating (your one-time manual work)
Ship a dry-run tool with the phase that adds each step: `npm run migrate:dry -- <decrypted-backup.json>` prints,
without writing anything: per-account balance before/after, the net worth before/after at the backup's rates,
snapshots built (and which are *estimated*), every fund movement's proposed account, every unresolved movement
with its reason, records whose amounts had more decimals than their currency, and any invariant that would fail. You
fix the backup file from that report, re-run until clean, and import it.

### F2. Rates
`settings.exchangeRates {SAR_EGP, USD_EGP}` → `settings.rates`; each record's rates → `rateSnapshotId`.
Legacy rates are EGP-per-unit values `R` (`R[EGP]=1`, `R[SAR]=SAR_EGP`, `R[USD]=USD_EGP`). The v8 table is
`perUsd[c] = R[USD] / R[c]`, so `perUsd.USD = 1` and every pairwise rate `A→B = R[A]/R[B]` is exactly what v7 used
(lossless; measured relative error 1.8×10⁻¹⁶, §G).
For a transaction with a legacy record: `R` = its `ratesSnapshot` (else the settings rates at migration time), then
**override its own currency** `R[X] := rateToEGP` (this preserves custom or edited `rateToEGP` values, which v7
used for the source leg). Snapshots are deduplicated by content hash. A record with **no** `ratesSnapshot` gets a
snapshot flagged `quality: 'estimated'`: its own currency vs EGP is exact; other currencies use the settings rates
at migration time. Today those records already convert at today's rates; the migration freezes them at
migration-time rates (so they stop drifting — the intended principle). You can replace them in the backup fix
(§F1), e.g. with the 12.57/50 the seed used.

### F3. Transactions
- `rateToEGP`, `ratesSnapshot` → `rateSnapshotId` (F2).
- `transfer` with equal currencies → `transfer` (`fees: []`). `transfer` with different currencies → `exchange`
  (`sentAmount = amount`, `receivedAmount = toAmount`, `fees: []`). Account effects are identical, so balances are
  unchanged.
- `income` / `expense` / `asset_purchase` keep their fields; amounts rounded to currency decimals (F13 reports changes).
- Default category "رسوم" is added if missing (merged by id, like `migrateV2toV3`).

### F4. Locations → countries
`account.location → country` (same codes: `EG`/`SA` are already ISO 3166-1). Holdings without a location become
`country: 'EG'` explicitly (v7 treated missing as Egypt). Liabilities get `country: 'EG'` (v7 subtracted them from
Egypt), so `netWorthByLocation` is identical.

### F5. Holdings
`purchaseCostEGP` → `purchaseCost`. Holdings linked to an `asset_purchase` transaction get the transaction's
native `{amount, currency}` (equal in EGP by construction); others get `{amount: purchaseCostEGP, currency: 'EGP'}`.
`purchaseRateSnapshotId` = the linked transaction's snapshot, else an *estimated* migration-time snapshot.
`goldPrice24kEGP/21kEGP` → `settings.goldPrice {currency: 'EGP', …}`.

### F6. Net worth snapshots, preferences, defaults
Each `NetWorthSnapshot` → `valuedIn: 'EGP'`, same figures, `rateSnapshotId` from its `ratesSnapshot` (else estimated).
`reportingCurrency: 'EGP'` (what the app shows today), `planCurrency: 'SAR'`, `enabledCurrencies: ['EGP','SAR','USD']`.
Past `estimated` snapshots stay flagged.

### F7. Fund movements → reservations
For each fund (priority ascending, then id), group its movements by currency (`movement.currency ?? fund.currency`),
net them per group (`N`). Chronological order and notes are kept: every original movement becomes a
`ReservationMovement` with `kind: 'adjust'` (no original `kind` existed) on the chosen account.

Account choice for a group with `N > 0` — **only when unambiguous**:
1. Candidates = active (non-archived) accounts in that currency whose remaining capacity ≥ `N`, where
   capacity = `balance(account) − Σ reservations already assigned to it` (processing order is deterministic, so the
   result is reproducible).
2. Exactly one candidate ⇒ assign the whole group to it. Otherwise ⇒ **unresolved**, reason `ambiguous` (≥ 2
   candidates) or `insufficient` (0 candidates). A group with `N < 0` ⇒ `negative`. No candidate account in the
   currency ⇒ `no_account`.

Unresolved groups move to `state.unresolvedMovements`, keep counting toward the fund's total, never count against an
account's available, and surface in a banner + Next Best Action. A minimal in-app resolver (pick an account; INV-5
checked; one confirmation) removes them. **No FX is invented**: currency-less v7 movements are read in the fund's
currency; if v7 covered them with *another* currency's money at today's rate (the implicit FX of
`unassignedByCurrency` step 2), the dry-run flags it and the group is treated as above (it will usually end up
`insufficient`).
`fundContributions` in plans are untouched. Tombstone entity `fundMovement` → `reservationMovement`.

### F8. Recurring rules
`transfer` rules with different account currencies → `exchange` rules (`toAmount` kept as the received amount), `mode`
forced to `confirm` (an auto exchange at an unknown rate is not allowed); same-currency transfer rules unchanged.

### F9. Validation inside the migration (fail closed)
After building the v8 state, `migrateV7toV8` runs `assertInvariants` and a **reconciliation** against the v7 input
(computed with the frozen v7 selectors): account balances equal; `liquidByCurrency` equal; net worth at current
rates equal within 0.005 reporting units; per-fund totals equal (resolved + unresolved); transaction and holding
counts equal. Any mismatch throws; nothing is written (F10).

### F10. Failure behavior (new)

> **Status (2026-11-07): shipped on main as a separate change** (`store/hydration.ts`, `HydrationErrorGate`,
> 11 tests; see CHANGELOG). Failing or newer-than-supported data is never written over and shows the error screen
> with raw export and retry. The text below describes the problem it fixes; Phase B only adds the v8-specific
> reconciliation (F9) on top.
Today a throwing `migrate` ends in zustand's `.catch`, and the app's `onRehydrateStorage` callback ignores the error,
so the store keeps the seed and the callback itself calls `setState({ settings, hasHydrated: true })`, which zustand
persists immediately — the seed is written over the real data at launch, labelled with the current version (§J R2).
v8 changes this:
hydration receives the error, sets `migrationError`, **does not persist**, blocks writes, and shows a blocking
screen with the stored payload's version and a "export raw data" button. The pre-migration payload is already saved
under `@wealth_finance_state_backup_v7` (existing behavior) and the dry-run report under
`@wealth_migration_report_v8`.

### F11. Sync metadata
Every migrated entity keeps `updatedAt`; new entities (`rateSnapshots`, reservation movements) get
`updatedAt = migration time`. `rateSnapshots` are content-addressed and immutable, so they need no tombstones.

### F12. Keeping v1–v7 restores alive
The chain is frozen before anything else changes (Phase B, first commit): `store/legacy/types.v7.ts` (copy of today's
types), `store/legacy/selectors.v7.ts` (the subset the chain needs: `toEGP`, `holdingValueEGP`, `liquidTotalEGP`,
`netWorthAsOf`), and `migrations.ts` imports only those. The v6→v7 snapshot backfill (which runs *today's* selectors)
is removed from the chain: v6→v7 only adds empty collections, and the existing runtime `SnapshotRunner` fills missing
months with v8 logic (estimated, as before). Existing migration tests become fixtures run through the whole chain
to v8.

### F13. Report
Output (also stored at `@wealth_migration_report_v8`): counts, balances, net worth before/after, estimated snapshots
(count and which records), records rounded to currency decimals (with the delta), fund assignments, unresolved list,
rejected-as-ambiguous reasons.

---

## G. Impact on my data

**What was run.** The current logic (v7 selectors) on `store/seed.local.ts`: 3 accounts, 15 transactions, 9 gold
holdings, **0 funds, 0 fund movements**, rates 12.57 / 50, gold 6,500 (24k) / 5,687.5 (21k). The design's results are
computed with the design's formulas (same inputs). Important limit: **your real funds and movements are in the app /
your backup, not in the repo**, so the fund part of G is by rule, not by measurement — the dry-run (§F1) produces the
exact list for your data. Send me a decrypted backup or run it yourself once Phase D lands.

### G1. Identical (accounts, amounts, allocations)
| Item | v7 today | v8 design |
|---|---|---|
| Account balances (native) | EGP 14,000 · SAR 12,000 · SAR 8,000 | identical (no rounding effect: whole numbers) |
| Every transaction amount and currency | 15 transactions | identical |
| Fund allocations | none in the seed | none; see G3 for your real funds |
| Liquid by currency | EGP 14,000 · SAR 20,000 · USD 0 | identical |
| Gold holdings (weights, karats, costs) | 50 g (30 g 21k, 20 g 24k), cost 305,900 EGP | identical (cost kept in EGP: no linked purchase transactions in the seed) |
| Seed transactions' rate | `rateToEGP` 12.57, no `ratesSnapshot` | snapshot `estimated`, SAR→EGP 12.57 exactly |

### G2. Derived numbers
| Derived number | v7 today (seed) | v8 design | Why it differs (or not) |
|---|---|---|---|
| Net worth (EGP) | 566,025 | 566,025 | Same current-rate valuation; rebase to USD is lossless (rel. error 1.8×10⁻¹⁶, equal after rounding to cents) |
| Liquid EGP / holdings EGP | 265,400 / 300,625 | 265,400 / 300,625 | Per-item rounding changes nothing (all results are whole) |
| By location (EG / SA) | 465,465 / 100,560 | 465,465 / 100,560 | Liabilities keep `country: 'EG'` |
| Unassigned (EGP/SAR/USD) | 14,000 / 20,000 / 0 | 14,000 / 20,000 / 0 | No reservations ⇒ available = balance |
| Income Aug / Sep (EGP) | 33,939 / 47,766 | same | Per-transaction rounding changes nothing here |
| Expense Aug / Sep (EGP) | 20,049.15 / 13,889.85 | same | — |
| Net cash flow Aug / Sep (EGP) | `13889.849999999999` / 33,876.15 | 13,889.85 / 33,876.15 | Float noise removed by rounding at the aggregation boundary (the screen already displays 13,889.85) |
| Seed transactions in **USD** (not offered by Analytics today) | follow today's rate | frozen at migration-time rate | Intended: principle 3 (they stop drifting). Same in EGP and SAR |

### G3. Rules for your real data (everything that can change)
| Derived number | Changes when | Reason |
|---|---|---|
| Unassigned per currency | Any fund movement without `currency`, or an allocation covered by another currency | v7 covered it with other currencies' money at today's rate; v8 does not do implicit FX ⇒ those groups are *unresolved* or placed on an account, and available per account differs from the old netted figure |
| Unassigned negative ("deficit") | v7 allowed more set aside than held | INV-5: such reservations cannot be created ⇒ `insufficient` ⇒ unresolved list; account available is never negative |
| Fund totals | Never when a movement resolves to an account | `Σ reservations` valued at current rates equals v7's per-currency cash valuation; unresolved movements keep counting |
| Fund status / "behind" / required-this-month | Month pace of funds funded in a currency other than the fund's | `movementValueInFund` used **today's** rate for a past movement; v8 uses the movement's snapshot (T fixed) ⇒ values near a threshold (110%, 7 days) can flip |
| Net worth history in SAR | Estimated snapshots | Unchanged figures (they carry their own rates); any snapshot with no rates becomes `estimated` |
| Rounded amounts | Stored values with more decimals than the currency (e.g. a typed 3-decimal `toAmount`, a `34333.333` cost) | Rounded to currency decimals; each delta ≤ half a minor unit, listed in the dry-run |
| Gold P&L in non-EGP view | Holdings with a linked purchase | Cost now native + purchase snapshot (v7 re-converted EGP cost at today's rate in Analytics) ⇒ P&L in SAR may shift by the rate drift since purchase (more correct) |
| Net worth with a different `reportingCurrency` | Always | Not a change in data: it is a different projection; native values are untouched (INV-1) |

---

## H. Acceptance tests

Test infrastructure first (Phase B): a seeded RNG helper, `assertInvariants(state)`, and the **frozen v7 selectors
as a test-only oracle** (`tests/legacy/oracle.v7.ts`) to compare old vs new numbers on fixtures. A **fuzz test**
(2,000 random operations over a small state, seeded) asserts INV-1…INV-8 after every step and that a failed
operation leaves the state deep-equal (INV-6). A static test asserts INV-2 (no conversion import in
`operations.ts`).

### Phase B — currency engine and precision
| ID | Given / When / Then |
|---|---|
| B1 | Display currency change changes nothing: change `reportingCurrency` EGP→SAR→USD→JPY; deep-equal all collections |
| B2 | 1,000 SAR − 100 SAR = 900 SAR in every reporting currency; the native balance is 900 and only the projection differs |
| B3 | A rate update (including 10× jumps in tests) changes no native amount and no historical projection; only current valuations move |
| B4 | A→USD→B equals the v7 EGP-pivot result for 10,000 seeded random amounts after rounding to the target decimals (oracle comparison) |
| B5 | JPY (0 dec) and KWD (3 dec) round, format and split correctly: `roundMoney(100.5,'JPY') = 101`, `-0.0005 KWD → -0.001`, 1.000 KWD ÷ 3 = 0.333 / 0.333 / 0.334, formatter prints no decimals for JPY and up to 3 for KWD |
| B6 | Precision: 1,000 × +0.01 equals exactly 10.00; 1,000 × −0.01 returns to 0; 1,000 expenses of 10.01 sum exactly; balance equals opening minus the minor-unit sum |
| B7 | Adding a currency is data-only: add KWD to the registry in the test, enable it, create an account, project to it; no source change |
| B8 | Countries: a third country is data-only (a `COUNTRY_REGISTRY` entry); net worth by country includes it |
| B9 | v1–v7 backup fixtures restore into v8 (balances, counts, net worth at the backup's rates identical to the oracle) |
| B10 | Migration: lossless rebase for records with custom `rateToEGP`; estimated snapshots flagged; dedup (same table ⇒ same id); idempotent (migrate twice ⇒ equal) |
| B11 | Aggregation rule: listed rows sum to the shown total in the reporting currency for 1,000 random sets |
| B12 | Migration failure leaves storage untouched and the app in `migrationError` (no seed overwrite) |
| B13 | Rate source parsing returns all enabled currencies; a currency whose new rate is 10× the previous is rejected individually and keeps the last value |

### Phase C — ledger
| ID | Given / When / Then |
|---|---|
| C1 | A real exchange moves only sent and received (and fees): from −sent, to +received, nothing else |
| C2 | A same-currency transfer has no FX gain/loss: total value of both accounts unchanged at any two different rate tables |
| C3 | Cross-currency transfer is rejected (`TRANSFER_CURRENCY_MISMATCH`); same-currency exchange rejected (`EXCHANGE_SAME_CURRENCY`); no operation supplies a default received amount |
| C4 | Fees hit the named account: source-side and destination-side; transfer fees and exchange fees reduce the correct balances and count as expenses |
| C5 | Fees with 1,000 repeated transfers of 10.01 + fee 0.01 stay exact (KWD and JPY variants) |
| C6 | Edit an exchange: both legs and fees reversed, new values applied; delete: balances return to the pre-exchange state, fees removed; both all-or-nothing |
| C7 | Recurring exchange: `confirm` only; the occurrence uses the rule's received amount, never today's rate; an overridden amount requires an explicit received amount |
| C8 | Failed operations are all-or-nothing (invalid fee account, zero amount, wrong currency) — state deep-equal |
| C9 | Migration of cross-currency transfers to exchanges leaves every account balance identical |

### Phase D — account-backed funds
| ID | Given / When / Then |
|---|---|
| D1 | 1,000 SAR reserved for an EGP fund stays 1,000 SAR whatever the rates do; the fund's EGP value moves, the reservation does not |
| D2 | Expense within available saves with no prompt; touching reserved money returns `needsCover` and writes nothing until confirmed |
| D3 | Cover is atomic: expense + `cover` movements in one patch; after it available is exactly 0 (never negative); cancel leaves the state equal |
| D4 | Reservations never exceed balance without a confirmed cover: every write path (expense, transfer, exchange, income delete, opening balance edit, asset purchase, recurring) is covered by a fuzz case |
| D5 | Same-currency transfer moves reservations (C3 numbers); delete of the transfer restores them; nothing changes in net worth |
| D6 | Exchange with reservations converts them at the recorded rate (C4 numbers); fund value drop equals the spread |
| D7 | Delete/edit of an income that funded reservations: `needsCover`, never an invalid state |
| D8 | `processDue` does not record an auto expense that would breach INV-5; it stays due, flagged |
| D9 | Migration: unambiguous movements assigned; ambiguous / insufficient / negative land in `unresolvedMovements`; fund totals equal v7 per oracle; resolver enforces INV-5 |
| D10 | Net worth identical before and after any sequence of reserve / release / reallocate (INV-8) |
| D11 | Account `currency` stays locked while reservations exist; archive blocked with reservations |
| D12 | Sinking payment spends the fund's reservation on the paying account first, then available, then needs a cover |

---

## I. Build and release, per phase

**Facts checked.** `app.json`: version **1.2.0**, `runtimeVersion: { policy: "appVersion" }`, `updates.checkAutomatically:
"ON_LOAD"`; `eas.json` `appVersionSource: remote`; 1.2.0 is **not built yet**; storage is AsyncStorage (one JSON key).
None of the phases adds a native module: the engine is pure TypeScript (the only crypto already present is
`@noble/hashes`, JS), formatting uses `toLocaleString` already used today, and the data lives in AsyncStorage.
Per `docs/TECHNICAL.md` §13, a new build is needed only for native modules, native config or SDK upgrades.

| Phase | Scope | New native build? | Ships via | Size (rough) |
|---|---|---|---|---|
| A | This document | — | — | done |
| B | Registry, rate table, snapshots, `money.ts`, preferences, countries, projections, frozen v1–v7 chain, fail-closed hydration, migration steps F2–F6 | No | `eas update` (or the 1.2.0 build) | L — 6–8 dev days; ~60 files touched (every EGP literal in §A1–A3, A5) and ~110 of the 274 tests rewritten |
| C | `exchange`, same-currency `transfer`, fees, recurring exchange, exchange sheet, F3/F8 | No | `eas update` | M — 4–6 dev days |
| D | Reservations, invariants, cover flow, sheets (reserve / release / reallocate / cover / resolver), account `reserved/available`, `processDue` guard, migration F7, Next Best Action rewiring | No | `eas update` | XL — 9–12 dev days |

**How the data version rolls out (recommendation).** One `v7 → v8` migration on a long-lived branch; `main` stays v7
until D is done, so you never run a half-migrated shape on real data. Each phase's end state must pass the full suite
and the dry-run on your backup. Release steps: (1) build 1.2.0 from `main` now (nothing here blocks it) so you have a
runtime to update; (2) after D, publish to the `preview` channel and install it with a *restored copy* of your data;
(3) run the app against that, compare with the dry-run report; (4) `eas update` to `production`.

**Cautions that apply to an OTA data migration.**
- The migration is one-way. An OTA rollback after migration puts v7 JS on a v8 payload: zustand calls `migrate` for any
  version mismatch, `migratePersistedState` applies no step to a *newer* version, and v7 selectors then read v8-shaped
  data. Keep `@wealth_finance_state_backup_v7` and your own exported backup before updating; a v8 build should also
  refuse (clear screen, no overwrite) when it finds a payload newer than its own version.
- Time of the update: migration runs at the first launch after the update download, before any screen mounts.
- AsyncStorage writes the whole state under one key per change; a patch is therefore all-or-nothing at the storage level
  (a crash between `set` and `setItem` loses the operation, never half of it).

---

## J. Open questions and the five riskiest points

### Open questions (each with a recommendation)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Negative balances: allow an expense larger than an account's balance? | Allow only with an explicit confirmation (D2 #4) and an `allowNegative` flag for genuine overdraft/credit accounts. Such an account holds no reservations. Reservations are always `≤ max(0, balance)` |
| Q2 | Are fees spending? | Yes: default category "رسوم" (essentials), counted in Analytics and plan progress; the transfer itself is not |
| Q3 | When reserved money must travel with a transfer/exchange, who gives up how much? | Proportional to each fund's reservation on the source account, editable in the sheet; last fund takes the rounding remainder |
| Q4 | After deleting/editing a covered expense, re-reserve automatically? | No. Offer an optional one-tap "رجّع للصناديق"; automatic re-reserving would hide what happened |
| Q5 | Is `reportingCurrency` global or per screen? | Global preference + per-screen override that is never persisted (Analytics keeps its own switch) |
| Q6 | Rate snapshots: table or embedded in each record? | Table with content-hash ids (dedupe, idempotent migration, future sync); records carry only the id |
| Q7 | Resolve unresolved legacy reservations in-app or only by editing the backup? | Both: the dry-run tells you what to fix in the backup; keep a small in-app resolver as the safety net (it is also the guard for anything the dry-run missed) |
| Q8 | One v8 or staged v8 (B) / v9 (C+D)? | One v8, branch strategy of §I. Staged versions only if you want to run intermediate shapes on real data |
| Q9 | Track realized FX gain/loss or cost basis for FX/gold? | Not now. The recorded exchange keeps sent/received so it can be added later without a data change |
| Q10 | Gold price: one currency or per country? | One `goldPrice` with its currency (default EGP, the market you price in) + the existing local-premium %. Revisit if you price gold in two markets |
| Q11 | Rate sanity checks without hard-coded ranges | Relative guard: reject a currency's new rate if it is outside ×0.5…×2 of the previous one; per-currency error, keep the last value |
| Q12 | Rounding mode | Half away from zero (symmetrical for negatives, matches how people expect cents to round) |
| Q13 | Reserve beyond available: block or offer to take from another fund? | Block with a clear message; use reallocate or release first (keeps "reserve" a simple, safe verb) |
| Q14 | Do `follow_transfer` reservations really need no confirmation? | Yes — no fund loses money; a mandatory visible notice with an edit link is enough. Change to a confirmation if you prefer stricter |

### The five riskiest points

1. **The legacy migration chain is coupled to current code.** `migrations.ts` imports today's selectors
   (`holdingValueEGP`, `liquidTotalEGP`, `missingPastSnapshots` → `netWorthAsOf`). Changing those silently breaks
   restoring any v1–v6 backup. *Mitigation:* freeze types and helpers first (F12), run every historical fixture through
   the whole chain, keep the frozen v7 selectors as a test oracle.
2. **Migration failure and rollback can destroy real data.** Verified in `node_modules/zustand/middleware.js`: a
   throwing `migrate` goes to `.catch`; the app's `onRehydrateStorage` callback ignores the error and marks the store
   hydrated with the **seed** — and that callback calls `setState`, which persists at once. So a failed migration
   overwrites the stored data with the seed during launch, before you touch anything (only the pre-migration copy
   under `@wealth_finance_state_backup_v7` survives). An OTA rollback after a v8 migration is also unsafe. *Mitigation:* fail-closed hydration, refuse newer payloads, reconciliation inside the
   migration (F9, F10), always keep the pre-migration key and your own exported backup.
3. **INV-5 must hold on every write path.** Expenses, asset purchases, fees, transfers, exchanges, deletes, edits,
   opening-balance edits, recurring auto-recording, fund deletion, restore/import. One unguarded path (the obvious
   suspect: `processDue`, which has no user to ask, and `updateAccount`'s "set current balance") reintroduces silent
   overspending. *Mitigation:* a single `commit(state, patch)` gate that runs `assertInvariants`, the fuzz test over all
   operations, and the `needsCover` result type that every balance-reducing operation must return.
4. **Migrating funds to accounts can be ambiguous or wrong.** v7 movements have no account and sometimes relied on
   implicit FX at today's rate; two accounts in one currency (you have two SAR accounts) make most assignments
   ambiguous. A wrong automatic choice silently misattributes money. *Mitigation:* the conservative "exactly one
   candidate" rule, unresolved quarantine, the dry-run on your real backup before anything is applied, and the
   reconciliation in F9.
5. **Rounding discipline is cross-cutting.** Missing one boundary reintroduces drift; adding it changes derived numbers by
   up to half a minor unit per row, and formatting differs between Hermes and V8 on exact halves. *Mitigation:* the
   `utils/money.ts` helpers as the only way to produce stored or aggregated money, the precision suite (B5, B6, B11,
   C5), and the oracle comparison on real-shaped data.

Runner-ups, not in the five: UX complexity of the cover and exchange sheets (Arabic copy and small screens); behavior of
historical projections when a currency is enabled after records exist (the "earliest snapshot containing it, marked ≈"
rule); the size of the test rewrite (~110 tests).

---

## What happens next

Nothing is built. Reply with approval (or edits) and your answers to the questions in §J — especially Q1, Q7, Q8, and
whether you can give me a decrypted copy of your backup so I can run the dry-run (§F1) against your real funds. Phase B
starts with the frozen v1–v7 chain and the test oracle, before any behavior change.
