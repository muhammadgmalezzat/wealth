# Professional analytics & financial comparison — design (Phase 0 audit)

Status: **approved (2026-11-26). Phase 1a (daily snapshot history, data v10) is built** on branch `analytics`, with
two changes from the proposal, both requested at approval: the history lives under its **own AsyncStorage key**, not
inside the ledger value (§16), and its records are compact (interned ids, tuples, "same as the previous record"
sections). Decisions D1–D13 are approved as recommended, D1 with a manual cycle-start override (a preference only), and
D14 was added (§B). Phases 1b onward are not built. All numbers in this document are made up.

Branch: `analytics` (created by the owner from `main` at `4525885`, the goals-upgrade merge; working tree clean). No
other work in progress was found: the goals upgrade (`FUND_SPEND_AND_GOALS_DESIGN.md`) and receivables
(`RECEIVABLES_DESIGN.md`, data v9) are both merged. Phase 1 can be built on this branch.

Builds on `CURRENCY_AND_FUNDS_DESIGN.md` (native amounts, INV-1…8, the rate engine), `FUND_SPEND_AND_GOALS_DESIGN.md`
(`fundSpent`, `fundContributed`, `fundProgressAmount`, `achievedAt`, spend vs cover, INV-12/13) and
`RECEIVABLES_DESIGN.md` (receivables are never money, INV-9…11). None of their definitions is redefined here.

---

## A. MVP scope (what gets built first)

| # | MVP item | Phase | Depends on |
|---|---|---|---|
| M1 | **Daily snapshot recording** (data **v10**): native balances, reservations, gold by weight/karat, a reference to the rate snapshot, the gold prices with their source and time, and a schema version. Read-only, at most one record per date, stored under its **own key**, included in backups. **Ships first, on its own**: every day it isn't recording is history lost for good. **Built (Phase 1a).** | 1a | — |
| M2 | **Period selector**: all section 4 presets, custom range, and a **pay cycle (دورة الراتب)** preset (see D1). Calendar month stays the default. | 1b | — |
| M3 | **Comparison engine, Mode A** (period vs period): correct zero / negative / sign-flip baselines, savings rate in percentage points, elapsed-days alignment for periods still in progress, quality and completeness labels. | 1b | M2 |
| M4 | **Overview tab**: net worth hero card (live value, freshness, comparison only where recorded history exists) plus six metric cards (income, spending, net cash flow, savings rate, free money, reserved money), each with a «عن الفترة اللي فاتت» line. Receivables appear as a separate informational line, never inside net worth. | 2 | M3 (+ M1 for point-in-time comparisons) |
| M5 | **Spending tab**: total, a "spending footprint" stacked bar, ranked category bars, **«من صندوق» vs free-money split**, one-time vs regular (the existing «مصروف لمرة واحدة» flag), fees shown as «رسوم», category-vs-category comparison across periods, and drill-down to the transactions behind each figure. | 3 | M3 |
| M6 | Mode B (date vs date) and the net worth history chart, **only for dates covered by recorded snapshots** (daily from M1, plus the existing non-estimated monthly ones). Every earlier date shows as unavailable. | 2 (limited) | M1 |

The existing sections (Sankey, monthly trend, net worth over time, money map, runway, funds, insights) are **kept
as they are** and moved under the new section chips (§11). Nothing the owner uses today disappears in the MVP.

**Out of scope for now** (listed in §20 as later phases, not designed in detail): composite financial health score,
investment analytics (investments are not tracked), the wealth growth attribution waterfall, the calendar heatmap,
pinch-to-zoom, PDF/CSV export.

## B. Decisions (approved 2026-11-26)

All approved as recommended below, with these additions from the owner:

- **D1:** approved, **plus a manual override for the cycle start date**: a setting stored as a preference (e.g. an
  optional `settings.payCycleStartOverride`), never a ledger change. When set, the current cycle starts there instead of
  at the detected receipt. Built in Phase 1b.
- **D7:** approved (Egyptian colloquial). The **app-wide MSA copy pass** is a separate post-MVP phase (§20, P7).
- **D14 (new, documented only, not built):** see the row at the end of the table.
- Phase 1a requirement: the daily history is stored under a **separate AsyncStorage key**, compact, included in backup
  and restore and in the v10 safety checks; a corrupted or oversized history must never block loading the ledger (§16).

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | **Pay cycle definition.** Salary can be months late, so a fixed day is unreliable. | **A** calendar month only (today) · **B** cycles derived from actual salary receipts: incomes in «راتب» (`cat-income-salary`) **plus** collections of a `salary` receivable; a new cycle starts at a receipt at least `MIN_CYCLE_DAYS` after the current cycle's start; no stored schema · **C** "salary month" via `forMonth` (report income by the month it was *for*): accrual, mismatches expenses (which are by date) · **D** a fixed configurable salary day (the original brief) | **B**, with the calendar month as the default period. `MIN_CYCLE_DAYS = 20` (two receipts closer than that, e.g. two late salaries collected in one week, belong to the same cycle, and the cycle says «الدورة دي فيها راتبين»). Before the first receipt, the preset falls back to the calendar month with a note. A manual "start a cycle here" marker would need schema: later. |
| **D2** | **Daily snapshot timing.** | **a** one record per date, **updated in place while that date is today** (on hydrate, foreground and after changes, debounced like `SnapshotRunner`), frozen once the date has passed · **b** one immutable record per date, written on the first open of the day · **c** change-only records (write only when positions differ, extend `seenThrough`) | **a**: the stored value is the last observation of the day, the closest thing to "end of day" an offline app can get. Still at most one record per date. **c** is the fallback if the size budget (§16.7) is exceeded. |
| **D3** | **Snapshot balances vs ledger reconstruction disagree** (e.g. a backdated expense edited after the day was recorded, or «عدّل الرصيد الحالي» changing an opening balance). | **a** trust the ledger for balances, the snapshot for prices, reservations and holdings, and flag the divergence · **b** trust the snapshot for everything · **c** show both | **a**. Account balances come from the current ledger, so period flows and positions always reconcile. Reservations, holdings and prices come from the snapshot (the ledger can't reconstruct them reliably, §5). When the snapshot's balance differs from the reconstruction, the point is labelled «اتعدّل بعد التسجيل». |
| **D4** | **Savings rate when spending comes from a fund.** | **a** standard: (income − all spending) ÷ income · **b** exclude «من صندوق» spending · **c** show **a** as the headline, plus a second line for the rate without planned fund spending | **c**. The headline reconciles with balances and with the existing `savingsRate`. The second line («من غير المصاريف اللي من صناديق: 31%») explains a month where a planned purchase was made. This is a cash-flow figure: the fund *saving pace* already excludes `spend` (Q6) and is not touched. |
| **D5** | **Week start** for «الأسبوع ده / اللي فات». | Saturday · Sunday · Monday | **Saturday** (the usual week in Egypt and Saudi Arabia). |
| **D6** | **Persist the chosen period?** | no (today: screen state) · persist the preset kind only, as an optional `settings.analyticsPeriod` · persist custom ranges too | **Persist the preset kind only** (not custom dates, not the comparison). An optional settings field round-trips through `dataOf`, so it needs no migration step of its own. |
| **D7** | **Arabic copy style.** The whole app is Egyptian colloquial. | write analytics copy in the same colloquial style · MSA for analytics only | **Same colloquial style as the app** (per the 2026-11-26 correction). A future app-wide MSA pass is a separate phase (§20, P7). |
| **D8** | **Digits.** Today: amounts, percentages and chip labels use **Western digits** (`en-US`, e.g. «3 شهور», «ر.س 1,250»); dates and month names come from `toLocaleDateString('ar-EG')` and use **Arabic-Indic** digits («٥ أكتوبر ٢٠٢٦»). | keep the existing convention · unify on Western · unify on Arabic-Indic | **Keep the existing convention** in analytics (consistency with the rest of the app). Unifying is part of the later app-wide copy pass. |
| **D9** | **Fixed vs variable spending.** There is no per-expense flag. | **a** a category is fixed in a month if that month's plan has it as a `fixed` line, falling back to `FIXED_CATEGORY_IDS` (rent, telecom, bills) when the month has no plan · **b** recurring rule = fixed · **c** defer | **Defer to Phase 3+** (not in the MVP list). When built: **a**, labelled «ثابت حسب الخطة». |
| **D10** | **In-progress comparisons default.** | compare "this month so far" with **the same number of days** of last month · with all of last month | **Same elapsed days** by default for flows («لحد نفس اليوم من الشهر اللي فات»), with a toggle «الشهر اللي فات كله». Completed periods are compared whole. |
| **D11** | **Data v10 and its release** (§16). A new collection means a version bump, a step-tracked fail-closed migration, an AC-9-style compatibility gate, and the same "OTA rollback is not a data rollback" rule as v9. | bump to v10 · try to avoid a bump | **Bump to v10.** v9 code persists only the collections it knows (`dataOf`), so after an OTA rollback it would silently drop `dailySnapshots` on its next save. With v10 it fails closed instead (the same reasoning as RECEIVABLES §0). *As built: the history has its own key, so v9 code would not drop it; the bump now keeps older builds from opening v10 data and v10 backup files without the history (§16.4).* |
| **D12** | **Expo docs version.** `AGENTS.md` points at the SDK 54 docs, but `package.json` is on **SDK 57** (`expo ~57.0.32`, RN 0.86). | follow SDK 57 docs · follow the SDK 54 link literally | **SDK 57 docs** for any API used in implementation. (Already listed in TECHNICAL §15. Fixing `AGENTS.md` is the owner's call.) |
| **D13** | **Changelog state.** `docs/CHANGELOG.md` still heads with "Unreleased (ready to ship) — branch goals-upgrade", but the goals upgrade is released. | fix it in the first analytics change · leave it | **Fix it** in the Phase 1a change (one heading line). Done. |
| **D14** | **«عدّل الرصيد الحالي» rewrites the opening balance retroactively** (L5): every reconstructed past balance of that account shifts, and the adjustment has no date, so it can't be attributed. | keep as is · from a future release on, record each adjustment as a **dated balance-adjustment entry** (not income, not spending; its own type or kind), leaving `openingBalance` alone · also convert past edits | **Post-MVP phase P8 (§20):** future adjustments become dated balance-adjustment entries; **no backfill** of past data (past edits are unknowable and stay as they are). Needs a schema change and its own design (cash-flow exclusion, the cover gate, backups, the v-next migration). **Not implemented now.** |

---

## 1. Current analytics capability inventory

Everything below lives in `store/analytics.ts` (pure, tested in `tests/logic.test.ts` → `describe('analytics')`),
`store/selectors.ts`, `store/snapshots.ts` and `store/review.ts`. It is rendered by `app/(tabs)/analytics.tsx` and
`components/analytics/*`.

| Capability | Where | What it does today |
|---|---|---|
| Periods | `resolvePeriod`, `previousPeriod`, `monthsInPeriod` | `month` · `3m` · `6m` · `year` (= the **last 12 months**, labelled «السنة») · `sinceStart` · `custom`. Presets are clamped to `trackingStartDate`. Previous period = the same length right before; `null` if it would start before tracking. |
| Query | `AnalyticsQuery { period, currency, includeOneTime }` | One query feeds every section. Screen-local state, never saved. |
| Period totals | `periodTotals` / `totalsOf` | Income, spending (fees of transfers and exchanges included as virtual «رسوم» rows), net, savings rate (`null` without income), by bucket, by category, income by category, gold purchases, net fund movements. Amounts are **as recorded** (each transaction's own rate snapshot). |
| Sankey | `spendingFlow` + `SankeyChart` (`d3-sankey` + `react-native-svg`) | Income sources → buckets / funds / gold / surplus → top 5 categories. Balanced (`totalIn === totalOut`). |
| Monthly trend | `monthlyTrend` + `TrendSection` (gifted-charts `BarChart` + line) | Income vs spending per month, net, savings rate, overspent months. |
| Category breakdown | `spendingBreakdown` + `BreakdownSection` | Bucket shares, every category ranked, previous-period amount, `changePct` (null from 0), `direction`, `isNew`. |
| Net worth over time | `netWorthSeries` + `NetWorthSection` | One point per monthly snapshot + today, stacked cash / gold / currencies, by location, estimated points marked or hidden. |
| Money map | `moneyMap` | Liquid by currency (native + converted), by country, gold by karat (grams, value, cost, P&L), gold share. Current valuations. |
| Runway | `runway` | Average essentials of the last 3 completed months → months that free money and all liquid money last, per currency too. |
| Funds | `fundsProjection` | Progress (`fundProgressAmount` basis), pace (3 completed months, `countsAsSaving`), projected date, behind. Active funds only. |
| Insights | `insights` | 6 rules (category increase, savings rate vs own average, one-time share, fund behind, overspent months, gold share), at most 5, each with a target. |
| Drill-down | `drillTransactions`, `drillParams` / `parseDrillParams`, `app/period-transactions.tsx` | Filter by type / bucket / categories / excluded categories / one-time; total equals the tapped figure (tested). |
| Monthly review | `store/review.ts`, `app/review.tsx` | Month income / spending / net / savings rate, net worth change (`monthNetWorthChange`), plan vs actual, top categories, one-time list, fund allocations. |
| Home | `NetWorthCard`, `MonthlySnapshot`, `homeInsights.ts` | Net worth + change vs last month's snapshot (`netWorthChange`), month flows (`monthFlows`). |
| Next Best Actions | `store/nextActions.ts` | due, needsCover, resolve, overspent, emergency, assign, prices, backup, review. |
| Monthly net worth snapshots | `store/snapshots.ts`, `SnapshotRunner` | One per month, EGP, with breakdown by country and a `rateSnapshotId`. The current month is upserted live; past months the app never saw are backfilled **estimated** (today's prices at backfill time). |
| Fund metrics | `fundSpent`, `fundContributed`, `fundProgressAmount`, `achievedFunds` | Q6 three-way split: contributions / spending / still reserved. Optional month filter (by movement date). |
| Receivables | `openReceivablesValue`, `receivableStatus`, … | Informational only, never in any money total. |

## 2. Existing features to reuse

| Reuse | For |
|---|---|
| `transactionAmountIn`, `movementAmountIn`, `projectAmount`, `requireSnapshot` | every flow in the reporting currency, as recorded |
| `incomeExpenseRows` / `feeExpenses` | spending including fees (fees stay visible as «رسوم») |
| `spendOf(state, txId)` and the `spend` movement's `sourceTransactionId` | the «من صندوق» split, per expense, dated by the **expense's** date |
| `periodTotals`, `spendingBreakdown`, `drillTransactions`, `drillParams` | Spending tab totals, ranking and drill-down (extended, not rewritten) |
| `accountBalance`, `liquidByCurrency`, `unassignedByCurrency`, `unresolvedByCurrency`, `accountReserved`, `reservation` | the native positions a daily snapshot stores |
| `netWorthFigures`, `netWorthBreakdown`, `holdingValue`, `goldPricePerGram` | valuing a position at a given price set (generalised to take the price set as a parameter) |
| `snapshotForNow` (`store/rateSnapshots.ts`) | the daily snapshot references a rate snapshot instead of copying rates |
| `syncSnapshots` + `SnapshotRunner` | the daily snapshot write is added beside the monthly one, with the same triggers and debounce |
| `applyV9Steps` pattern, `hasStateShape`, `dataOf`, the persist backup keys | the v10 migration |
| `fundSpent`, `fundContributed`, `fundProgressAmount`, `countsAsSaving`, `fundsByPriority`, `achievedFunds` | Goals analytics (later phases), never redefined |
| `openReceivablesValue` | the «فلوس ليّا غير محصّلة» line |
| UI: `Card`, `GlassSurface`, `MetricGroup`, `Money`, `Chip`/`ChipRow`, `Segment`, `FormSheet`, `PastDateField`, `ProgressBar`, `InsightCard`, `EmptyState`, `StatusChip`, `formatMoney`, `formatPercent`, `formatDateAr`, `chartAxis`, `compactNumber`, `changeText` | every new card and chart |
| Theme `constants/theme.ts` (Dark Glassy Wealth, already the only appearance) | all colours: `primary` (emerald), `gold`, `chartSky` / `chartViolet` / `chartRose`, `warning`, `danger`, glass tokens. **No theme change is needed.** |
| `react-native-gifted-charts` (bar, stacked bar, line, area, pie/donut, `pointerConfig` for drag-inspect) and `d3-sankey` + `react-native-svg` | every MVP chart. **No new dependency.** |

## 3. Current calculation and visualisation limitations

| # | Limitation | Effect | Fix (phase) |
|---|---|---|---|
| L1 | **No gold price history.** Only `settings.goldPrice24kEGP / 21kEGP` (current). Rate snapshots hold FX only. | Gold value at a past date is unknown, except as the per-country `goldEGP` total inside monthly snapshots recorded live. | M1 stores the day's gold prices (1a) |
| L2 | **No FX history by date.** Rate snapshots are created only when something is written, are content-hashed (`takenAt` = first time that table was seen) and say nothing about the days in between. | "The rate on 3 March" can only be approximated. | M1 references the day's rate snapshot (1a) |
| L3 | **No daily positions.** Monthly snapshots only, and they hold the *last value the app saw that month*, not the month-end value. | No reliable date-vs-date comparison inside a month. | M1 (1a) |
| L4 | **Reservation movements are dated by the day of the operation** (`newReservation` uses `ctx.now()`), not by the transaction's date. A spend on a backdated expense is dated today. Spend movements are **deleted** (tombstoned) when their expense is edited or deleted. | Reserved / free money at a past date can't be rebuilt reliably from movements. | M1 records them daily (1a); before M1: unavailable |
| L5 | **«عدّل الرصيد الحالي» rewrites `openingBalance` retroactively** (`openingBalanceForCurrentBalance`). Balance adjustments are not transactions and are not dated. | Every reconstructed past balance of that account shifts. Adjustments can't be attributed. | labelled (D3); dated balance-adjustment entries from P8 on (D14, no backfill) |
| L6 | **A transaction's rate snapshot is taken when it is recorded**, not on its date. A transaction backdated by a month is converted at the rates of the day it was typed. | Cross-currency flows of backdated rows are approximate. | documented; acceptable (as-recorded rule) |
| L7 | **Holding edits are undated**, `purchaseDate` is optional ("missing = always there"), deleted holdings vanish, **there is no sale transaction**. | Gold weight at a past date is approximate; realised gain/loss is impossible. | later schema (sale) |
| L8 | `netWorthAsOf` values the past at **today's** rates and prices, unlabelled at the call site; the v7 backfill wrote snapshots with it (`estimated: true`). | Fine for the existing "estimated" points; must never feed a comparison without the estimated label. | the valuation layer requires a price set + quality (1b) |
| L9 | `achievedAt` is the **current** state only (reopening clears it); `archived` has no date; fund `createdAt` exists. | No historical goal lifecycle (achieved count per period). | later; only "achieved in period" from current `achievedAt`, labelled |
| L10 | Liabilities have **no UI** (operations exist). | "Liabilities 0" would be a lie for most data. | show «مش متسجّلة» when there are none |
| L11 | `year` preset = last 12 months but labelled «السنة»; no week, last month, this year, last year or pay cycle. | Missing presets in section 4. | M2 |
| L12 | Previous-period comparison treats a **partly tracked first month as full** and compares an in-progress month with a whole one. | Misleading "spending fell 40 %" on the 10th of the month. | M3 (coverage + elapsed-days alignment) |
| L13 | `changePct` is relative even for ratios; there is no percentage-point change; no sign-flip handling (net cash flow −500 → +300). | Wrong or infinite-looking changes. | M3 |
| L14 | Funds analytics by month uses the **movement** date; «من صندوق» spending isn't split out of period spending at all. | Spending tab can't tell planned purchases from free-money spending. | M5 (link via `sourceTransactionId`, date of the expense) |
| L15 | **Performance**: the screen subscribes to the whole store (`useFinanceStore()`), and each of 8 selectors rescans all transactions (and rebuilds `feeExpenses`) on every render; `insights` re-runs `monthlyTrend` over all history and `moneyMap`. | Slow with years of data. | ledger index + memoisation (1b, §18) |
| L16 | Charts: no tooltips / drag-inspect, LTR time axis, numbers in lists under the charts. | Fine for MVP; interaction is Phase 2+. | P2/P6 |
| L17 | `trackingStartDate` defaults to a fixed date for every install (`DEFAULT_TRACKING_START_DATE`). | Coverage notes must read the setting, never assume. | — |
| L18 | Unassigned totals (`unassignedSummary.totalEGP`) are EGP only; `runway` already converts per currency to the display currency. | Overview needs the reporting-currency version. | reuse `runway`'s conversion (2) |

## 4. Historical data availability matrix

Classes: **R** recorded · **C** reconstructed (from the current ledger) · **E** estimated · **U** unavailable.
"From v10" = once daily snapshots are being recorded; never retroactively.

| Data | Stored today | Dated by | At a past date D, today | From v10 (for dates after recording started) |
|---|---|---|---|---|
| Income / expense / transfer / exchange / gold purchase | yes | economic `date` | **R** (as currently recorded; edits and deletes overwrite, tombstones keep only the id) | R |
| Fees of transfers / exchanges | inside the record | its `date` | R | R |
| Flow value in another currency | `rateSnapshotId` | **moment of recording** (L6) | R as recorded (approximate for backdated rows) | R |
| Opening balance | `openingBalance`, `openingDate?` | undated edits (L5) | C (shifted by any later «عدّل الرصيد») | C, divergence flagged (D3) |
| Account balance | derived | — | **C** = opening + Σ effects with `date ≤ D`, for accounts whose `openingDate ≤ D` | R observation + C |
| Reservations per fund / account | movements | operation day (L4) | **U** (C would be misleading) | **R** |
| Unresolved legacy reservations | yes | migration date | E (their date is the migration's) | R as observed, still unresolved |
| Free money (unassigned) | derived | — | U (needs reservations) | **R** |
| Gold holdings (grams, karat) | yes | `purchaseDate?`, undated edits | C (E when `purchaseDate` is missing) | **R** |
| Gold price per gram | current only | `goldPriceUpdatedAt` | **U** | **R** (with source: auto/manual, premium, fetch time) |
| Gold value | derived | — | U per date; R only as `goldEGP` in live monthly snapshots | R |
| Currency holdings | yes | `purchaseDate?` | C | R |
| FX rates | rate snapshots | first-seen `takenAt` | **E** (latest snapshot seen on or before D) | **R** (the day's snapshot id + `fxUpdatedAt`) |
| Liabilities remaining | derived (principal − payments) | `startDate`, payment dates | C (if any are tracked; no UI) | R |
| Net worth, month level | `netWorthSnapshots` | `month`, `takenAt` | **R** for months recorded live (last value seen), **E** for backfilled | R |
| Net worth, any date | — | — | U (C only at constant rates, see §9) | **R** |
| Receivables open | yes | `createdAt`, collection dates, `writtenOffAt` | C (later phase) | R (informational field) |
| Fund lifecycle | `createdAt`, `achievedAt?` (current) | — | achieved **now** only (L9) | R per day (`achieved` flag per fund in the snapshot) |
| Monthly plans | yes | `month` | R | R |
| Tracking start | `settings.trackingStartDate` | editable | R (the current setting) | R |

## 5. Historical reconstruction feasibility

| Metric at date D | Feasible today? | How / why not |
|---|---|---|
| Account balance (native) | **Yes, C** | `openingBalance + Σ effects(tx.date ≤ D)` (same as `accountNetFlow`, date-filtered). Exact in native currency, subject to L5. Excluded before `openingDate`. |
| Total liquid in one currency, native | Yes, C | sum of the above |
| Liquid in the reporting currency | **Only at constant rates** (E, labelled «بأسعار النهارده») or exact when every account is in the reporting currency | no FX history (L2) |
| Reserved / free money | **No** | L4. Shown as unavailable before v10. |
| Gold weight | Mostly, C/E | `purchaseDate ≤ D`; edits and deletions undated (L7) |
| Gold value | **No** (except the monthly `goldEGP` aggregate) | L1 |
| Net worth | Monthly: R/E from snapshots. Daily: **no**, except C at constant rates | L1, L2 |
| Period flows (income, spending, net, savings rate, categories, accounts, currencies, «من صندوق») | **Yes, R** | as recorded, for any period after `trackingStartDate` |
| Fund contributions / releases / covers in a period | Yes, R by **movement** date | by operation day; contributions are not backdated in practice, so this is accurate for "what you put aside that month" |
| Goal spending in a period | Yes, R | via the expense's `date` (`sourceTransactionId`); dangling legacy sinking spends by movement date |
| Achieved goals in a period | Partly, from current `achievedAt` only | labelled «حسب الحالة الحالية» (L9) |

**Rule:** a historical value is never shown without its class. "Reconstructed" and "estimated" values carry a visible
label; "unavailable" shows the reason and the earliest date that *is* available.

## 6. Metric definitions and formulas

Notation: period P = [from, to] (inclusive local date keys, clamped to `trackingStartDate`); `c` = reporting
currency; `as recorded` = `transactionAmountIn` / `movementAmountIn`; ε = 0.005. Every amount is rounded to `c`'s
decimals before summing (INV-7, `sumIn`).

Status codes: **AI** already implemented · **RI** requires improvement · **NS** new, supported by existing data ·
**HD** requires additional historical data (the v10 snapshots) · **SC** requires a schema change · **NF** not
currently feasible.

### 6.1 Period (flow) metrics

| Metric | Formula | Status | Accurate today? |
|---|---|---|---|
| Income I | Σ income tx in P, as recorded (receivable collections included, cash basis by receipt `date`) | AI | yes |
| Spending E | Σ expense tx + fee rows in P, as recorded; `includeOneTime` toggle | AI | yes |
| Spending «من صندوق» E_f | Σ over expenses in P of Σ \|spend movements with `sourceTransactionId = tx.id`\|, in the tx's currency, projected with the tx's snapshot (the spend uses `tx.rateSnapshotId`) | NS | yes |
| Spending from free money | E − E_f | NS | yes |
| Net cash flow N | I − E | AI | yes |
| Savings rate S | N ÷ I; `null` if I ≤ ε | AI | yes |
| Savings rate excl. fund spending | (I − (E − E_f)) ÷ I (D4) | NS | yes |
| Average daily spending | E ÷ `elapsedDays(P)`, where elapsed = days of P on or before today and on or after tracking start | NS | yes |
| Average monthly income / spending | Σ over *completed* months in P ÷ their count (in-progress month excluded, labelled) | NS | yes |
| Positive / negative cash-flow months | count of months in P with N > ε / < −ε | RI (`overspent` exists) | yes |
| Spending by category / bucket | as today | AI | yes |
| Spending by account | group expense + fee rows by `accountId` | NS | yes |
| Spending by currency (native) | Σ `tx.amount` per `tx.currency`, **no conversion** | NS | yes |
| Essential vs discretionary | bucket `essentials` vs `lifestyle` + `giving` (category-based, labelled «حسب الفئة») | RI | yes |
| One-time vs regular | `oneTime` flag | AI (toggle) / RI (split card) | yes |
| Recurring vs not | `recurringRuleId` present | NS | yes |
| Fixed vs variable | D9 | NS (later) | partly |
| Fees | category «رسوم» (`cat-essentials-fees`), shown, never hidden | AI | yes |
| Gold bought | Σ `asset_purchase` in P | AI | yes |
| Fund contributions | Σ `reserve` + positive `adjust` movements dated in P (period version of `fundContributed`) | RI | yes |
| Fund releases / covers | Σ `release` / `cover` in P (negative movements, shown as positive) | NS | yes |
| Goal spending | E_f restricted to goal funds | NS | yes |
| Transfers / exchanges | excluded from income and spending; optional informational count/volume | AI | yes |
| Opening balances / adjustments | not flows; not in any period metric | — | — |

### 6.2 Point-in-time (position) metrics

| Metric | Formula (at date D, native first) | Status now (live) | At a past date |
|---|---|---|---|
| Liquid L | Σ account balances (archived included), valued at the price set of D | AI | C native; value E (constant rates) before v10; R from v10 |
| Reserved R | Σ account-backed reservations + unresolved legacy (per currency, native) | AI | U before v10; R from v10 |
| Free money U ("متاح") | per currency: L_c − reserved_c − unresolved_c (signed; negative shown, never hidden) | AI (`unassignedByCurrency`) | U before v10; R from v10 |
| Gold value G | Σ grams × price/gram(karat) of D (18k = 24k × 0.75) | AI | U before v10 (except the monthly aggregate); R from v10 |
| Currency holdings H_c | quantity valued at D's rates | AI | C/R |
| Liabilities Lb | Σ (principal − payments dated ≤ D), only if any are recorded; otherwise «مش متسجّلة» | AI (no UI) | C/R |
| Total assets A | L + G + H_c (**reservations are not added**: they are part of L) | AI | as its parts |
| Net worth NW | A − Lb. **Receivables excluded** (approved decision). A future receivables-in-net-worth view would be a separate, labelled line, so the formula never needs redesign. | AI | monthly R/E; daily R from v10 |
| Liquid vs non-liquid | L vs G + H_c | NS | as parts |
| Currency exposure | native totals per currency, converted shares | NS | as parts |
| Open receivables | `openReceivablesValue` at today's rates, informational («فلوس ليّا غير محصّلة»), **never added** | AI | later (C) |

### 6.3 Funds and goals (later phases; definitions fixed now)

| Metric | Formula | Status |
|---|---|---|
| Total reserved | R above | AI |
| Contributions in P | §6.1 | RI |
| Goal spending in P | §6.1 | NS |
| Released / covered in P | §6.1 | NS |
| Goal progress | `fundProgressAmount` ÷ target (goals: reserved + spent) | AI |
| Required monthly | `fundRequiredMonthly` | AI |
| Estimated completion | `fundsProjection.projectedDate` | AI |
| Progress of one goal over time | needs reservations per date | HD |
| Achieved goals in P | current `achievedAt` in P, labelled | RI (L9) |

## 7. Period comparison architecture (Mode A)

### 7.1 Period model

```ts
type PeriodKind =
  | 'thisWeek' | 'lastWeek' | 'month' /* this month */ | 'lastMonth'
  | '3m' | '6m' | 'year' /* = last 12 months, id kept for compatibility */
  | 'thisYear' | 'lastYear' | 'sinceStart' | 'payCycle' | 'custom';

interface Period {
  kind: PeriodKind;
  from: string; to: string;          // inclusive, clamped to trackingStartDate
  nominalFrom: string;               // before clamping (for the coverage note)
  inProgress: boolean;               // to > today
  months?: number;                   // whole-calendar-month presets
  cycle?: { salaries: number };      // payCycle: receipts that opened it (D1)
}

interface Coverage { trackedFrom: string; elapsedDays: number; totalDays: number; complete: boolean }
```

| Preset | Range | Previous |
|---|---|---|
| الأسبوع ده / الأسبوع اللي فات | Saturday-based weeks (D5) | the week before |
| الشهر ده / الشهر اللي فات | calendar months | the month before |
| آخر 3 / 6 / 12 شهر | that many calendar months incl. this one (existing semantics) | the same number of months before |
| السنة دي / السنة اللي فاتت | 1 Jan – 31 Dec | the year before |
| من بداية التتبع | `trackingStartDate` → today | none |
| دورة الراتب | D1: last receipt cluster → today (in progress), or a past cycle | the cycle before (lengths differ: shown in days) |
| فترة مخصصة | as given (swapped if reversed) | same number of days right before, or a second custom range on the compare screen |

### 7.2 Change rules (`compareValues`)

```ts
type Quality = 'recorded' | 'reconstructed' | 'estimated' | 'unavailable';
interface MetricValue { value: number | null; quality: Quality; asOf?: string; coverage?: Coverage; notes: NoteCode[] }
interface Change {
  previous: MetricValue; current: MetricValue;
  delta: number | null;              // current − previous, rounded in c
  pct: number | null;                // amounts only
  pp: number | null;                 // ratios only (savings rate): percentage points
  direction: 'up' | 'down' | 'flat' | null;
  reason?: 'zero_base' | 'sign_flip' | 'unavailable' | 'incomplete' | 'not_comparable';
  tone: 'good' | 'attention' | 'neutral';
  quality: Quality;                  // the weaker of the two sides
  aligned?: { previousTo: string };  // elapsed-days alignment applied (D10)
}
```

| Case | delta | pct / pp | Shown as |
|---|---|---|---|
| either side `null` / unavailable | null | null | «مفيش بيانات كفاية للمقارنة» + earliest available date |
| \|delta\| < max(ε, 1 % of \|previous\|) | value | value | «زي الفترة اللي فاتت» (flat) |
| previous ≈ 0, current ≠ 0 | value | **null** (`zero_base`) | «جديد: مكانش فيه حاجة الفترة اللي فاتت» (never ∞ %) |
| previous and current of opposite signs | value | **null** (`sign_flip`) | «اتحوّل من سالب لموجب» / «… من موجب لسالب» + the delta |
| previous < 0, same sign | value | delta ÷ \|previous\| | direction from delta (−1,000 → −500 is "up" 50 %) |
| ratio metric (savings rate) | — | **pp** = current − previous | «+4.2 نقطة» (never a % of a %) |
| current period in progress | aligned to the same elapsed days (D10) | as above | «لحد نفس اليوم من الفترة اللي فاتت» |
| previous starts before tracking | partial coverage | computed but `incomplete` | «البيانات المتاحة بتبدأ من ٥ أغسطس…» and an offer to compare from the earliest reliable date |
| different reporting currencies | — | — | impossible by construction: both sides are computed with the same `c` |

**Tone** comes from the metric's `goodWhen` (`'up' | 'down' | 'none'`): income, net, savings rate, free money and net
worth are `up`; **spending is `none`** (shown in neutral/amber, never red by default, because more spending isn't bad
by itself: section 8); reserved is `none`.

**Never shown:** NaN, Infinity, a percentage on a zero or sign-flipped base, a full-period change for an in-progress
period without the aligned label, or zero for a value that is unknown.

### 7.3 Category comparison

`compareCategories(state, query, periodA, periodB)` → rows `{ categoryId, a, b, change }` over the union of
categories, sorted by \|delta\|. A category present in only one side uses 0 on the other (that **is** recorded:
no spending in a tracked period is a real 0) unless that side's coverage is incomplete, in which case it is labelled.
Tapping a row opens the drill-down for that category in **either** period.

## 8. Point-in-time comparison architecture (Mode B)

`positionAt(state, date)` → `{ position: NativePosition, quality, source: 'daily' | 'monthly' | 'ledger' }`:

1. A **daily snapshot** for that date → recorded positions; balances re-derived from the ledger and compared (D3).
2. Else, for a month-end date, a **non-estimated monthly snapshot** → recorded net worth and breakdown only (no
   reservations), `asOf` = its `takenAt`.
3. Else the **ledger** → reconstructed native balances and holdings; reservations / free money `unavailable`.

`valueAt(position, priceSet)` values a native position with a price set `{ rates, gold, quality, asOf }`.
`compareDates(state, dateA, dateB, method)` returns per-metric `Change`s (same rules as §7.2) for net worth, liquid,
reserved, free money, gold value, total assets, liabilities.

**MVP rule (M6):** Mode B is offered only when both dates have quality ≥ `recorded` for the chosen metric. The date
picker greys out other dates and says why («أول يوم متسجّل: ١٢ ديسمبر»).

## 9. Historical currency and gold valuation methodology

| Method | Each side valued at | Needs | Label |
|---|---|---|---|
| **Historical market value** (default when available) | its own date's price set: the daily snapshot's `rateSnapshotId` + gold prices; a monthly snapshot's own `rateSnapshotId` and stored EGP figures | recorded prices for both dates | «بأسعار كل يوم» |
| **Constant rates** | **both** sides at the later date's (B's) price set | native positions at both dates (recorded **or** reconstructed) | «بأسعار ثابتة (أسعار ٢٦ نوفمبر)»: isolates real changes from exchange-rate and gold-price moves |
| Past at today's prices (what `netWorthAsOf` does) | today | nothing | only ever as **estimated**, «تقديري بأسعار النهارده» |

- A side in the reporting currency needs no rate at all, so an all-EGP position in an EGP report is exact whatever the
  method.
- The two methods are never mixed in one comparison. The method is part of the comparison's header.
- FX at an arbitrary past date without a daily snapshot is **estimated** (latest rate snapshot with `takenAt` ≤ that
  date), never presented as recorded.
- Gold: the snapshot stores `goldPrice24kEGP`, `goldPrice21kEGP`, `localPremiumPct`, `priceSource` (auto/manual),
  `goldPriceUpdatedAt`. The value is spot + premium (what the app shows today), **not resale value**: workmanship and
  dealer spreads aren't recorded. "Estimated liquidation value" stays NF until a resale-spread input exists.
- Flows are always as recorded (L6 noted), never revalued.

## 10. Wealth growth attribution (later phase, not designed in detail)

The direction only, so v10 records what it will need. Between two dates that both have daily snapshots, the ledger
gives ΔNW = (I − E) + gold price effect (Δprice × grams held) + FX effect (Δrate × native amount, per currency) +
liability change + opening-balance edits/adjustments (L5) + **unexplained**. Transfers, fund reservations and asset
purchases net to zero. The unexplained part is shown as such, never forced to zero. It needs: daily snapshots at both
ends (v10), and ideally an adjustment transaction type (schema, later). Status: **HD + SC**.

## 11. Proposed screen hierarchy

```
التحليلات (tab, unchanged position; no new bottom tab)
├─ Sticky header: [ الشهر ده ▾ ] pill · [ ر.س ▾ ] currency · [ قارن ] → /compare
├─ Section chips (scrollable): نظرة عامة · الإنفاق · التدفقات · الثروة · الأهداف
│   ├─ نظرة عامة   NEW (M4)
│   ├─ الإنفاق      NEW (M5) + the existing category breakdown, upgraded
│   ├─ التدفقات     existing: Sankey «فلوسك راحت فين» + «الاتجاه الشهري» (moved as-is)
│   ├─ الثروة       existing: «صافي الثروة عبر الوقت» + «خريطة فلوسك» + «فلوسك تكفي لحد إمتى» (moved as-is)
│   └─ الأهداف      existing: «الصناديق» projection (moved as-is); «ملاحظات» stays on نظرة عامة
├─ Sheet: Period picker (all presets + custom + pay cycle)
├─ /period-transactions (existing drill-down; new filters: fromFund, accountId, currency)
├─ Sheet: Category comparison (A vs B, mini trend, «شوف المعاملات»)
└─ /compare «قارن وضعك المالي» (Mode A in Phase 2; Mode B limited to recorded dates)
```

The chip choice is screen state (opens on نظرة عامة). Only the period preset is persisted (D6).

## 12. Wireframes (MVP screens)

RTL, drawn right-to-left. Western digits for amounts (D8). Synthetic numbers.

### 12.1 Header + Overview (نظرة عامة)

```
┌──────────────────────────────────────────────┐
│ [ قارن ⇄ ]        [ ر.س ▾ ]   [ الشهر ده ▾ ] │  sticky glass header
│                     ١ – ٢٦ نوفمبر ٢٠٢٦ (لسه شغال) │
│ ( الأهداف )( الثروة )( التدفقات )( الإنفاق )(●نظرة عامة) │
├──────────────────────────────────────────────┤
│                                 صافي الثروة │
│                              ر.س 84,250     │  moneyHero
│   ↑ ر.س 2,140 (+2.6%) عن آخر تسجيل في أكتوبر │  only if a recorded point exists
│   ╭──────── monthly line ─────────╮          │  recorded = solid dots,
│   │  ·    ·    ○    ·    ●        │          │  estimated = hollow + «تقديري»
│   ╰───────────────────────────────╯          │
│   الأسعار: منذ 3 ساعات · تلقائي               │  freshness (rates + gold)
│   فلوس ليّا غير محصّلة: ر.س 6,000            │  informational, outside net worth
│   (مش داخلة في صافي الثروة)                   │
├──────────────────────────────────────────────┤
│ ┌───────────── المصروف ┐ ┌────────────── الدخل ┐ │
│ │ ر.س 7,420          │ │ ر.س 12,000         │ │
│ │ ↑ 8% لحد نفس اليوم │ │ زي الشهر اللي فات  │ │
│ └────────────────────┘ └────────────────────┘ │
│ ┌──────── معدل التحويش ┐ ┌──────────── الصافي ┐ │
│ │ 38%                │ │ ر.س 4,580          │ │
│ │ +4.2 نقطة          │ │ ↑ ر.س 610          │ │
│ └────────────────────┘ └────────────────────┘ │
│ ┌───── محجوز للصناديق ┐ ┌───── الفلوس الحرة ┐ │
│ │ ر.س 21,300         │ │ ر.س 9,950          │ │
│ │ المقارنة هتظهر لما │ │ المقارنة هتظهر لما │ │  point-in-time: needs v10
│ │ يتسجّل كفاية       │ │ يتسجّل كفاية       │ │
│ └────────────────────┘ └────────────────────┘ │
├──────────────────────────────────────────────┤
│ ملاحظات (existing insights, max 5)          │
└──────────────────────────────────────────────┘
```

Every card opens its detail: income/spending → the matching drill-down; net/savings rate → التدفقات; reserved/free
money → الأهداف. Each card's comparison line uses §7.2 and shows the quality label when not recorded.

### 12.2 Period picker sheet

```
┌────────────── الفترة ──────────────┐
│ ● الشهر ده          ○ الشهر اللي فات │
│ ○ الأسبوع ده        ○ الأسبوع اللي فات│
│ ○ آخر 3 شهور  ○ آخر 6 شهور  ○ آخر 12 شهر │
│ ○ السنة دي          ○ السنة اللي فاتت │
│ ○ دورة الراتب  (من ٢ نوفمبر · 25 يوم) │
│ ○ من بداية التتبع                     │
│ ○ فترة مخصصة   [من ▾]   [إلى ▾]        │
│                                [ تمام ] │
└────────────────────────────────────┘
```

### 12.3 Spending (الإنفاق)

```
┌──────────────────────────────────────────────┐
│                         مصروف الشهر ده      │
│                           ر.س 7,420         │
│        ↑ 8% (+ر.س 550) لحد نفس اليوم من     │
│                       الشهر اللي فات        │
│ ████████████▓▓▓▓▓▓▒▒▒▒░░░░  spending footprint│  top 5 + «تاني», tap a segment
│ أكل 28% · إيجار 22% · مواصلات 11% · …        │
├──────────────────────────────────────────────┤
│ ┌── من فلوسك الحرة ──┐ ┌──── من صندوق ────┐ │
│ │ ر.س 5,920         │ │ ر.س 1,500        │ │  planned goal spending
│ └───────────────────┘ └──────────────────┘ │
│  لمرة واحدة: ر.س 900  ·  رسوم: ر.س 35      │  fees visible
├──────────────────────────────────────────────┤
│ [ الفئة ●][ البند ][ الحساب ][ العملة ]  group │
│ أكل وبقالة     ███████████   ر.س 2,080  ↑ 12% │
│ إيجار          ████████      ر.س 1,630  –      │
│ مواصلات        ████          ر.س 815    ↓ 9%   │
│ تجهيز البيت ⓢ  ███           ر.س 1,500  جديد   │  ⓢ = paid «من صندوق»
│ رسوم           ▏             ر.س 35     جديد   │
│ …                                             │
│ ☐ اشمل المصاريف اللي لمرة واحدة               │
└──────────────────────────────────────────────┘
```

"By currency" shows native totals side by side («ر.س 4,100 · ج.م 12,300») with the converted share; nothing is
converted into a single native figure.

### 12.4 Category comparison sheet

```
┌──────────── أكل وبقالة ────────────┐
│ الشهر اللي فات    ر.س 1,200          │
│ الشهر ده          ر.س 1,650          │
│ الفرق             +ر.س 450 (+37.5%)  │
│ لحد نفس اليوم: ٢٦ أكتوبر vs ٢٦ نوفمبر │
│ ▁▃▅▂▆▇  آخر 6 شهور                   │  mini bars, months without tracking blank
│ [ شوف معاملات الشهر ده ] [ الشهر اللي فات ] │
└────────────────────────────────────┘
```

### 12.5 Compare screen «قارن وضعك المالي» (Phase 2, Mode A)

```
┌──────────────── قارن وضعك المالي ─────────────┐
│ ( تاريخ بتاريخ )( ● فترة بفترة )                 │  Mode B greyed until recorded
│ الفترة ب: [ الشهر ده ▾ ]    ⇄    الفترة أ: [ الشهر اللي فات ▾ ] │
│ لحد نفس اليوم ✓                                 │
├────────────────────────────────────────────────┤
│              أ            ب           الفرق      │
│ الدخل        12,000      12,000      –          │
│ المصروف       6,870       7,420      +550 (+8%) │
│ الصافي        5,130       4,580      −550       │
│ معدل التحويش  42.8%       38.6%      −4.2 نقطة   │
│ متوسط اليوم     264         285      +21 (+8%)  │
├────────────────────────────────────────────────┤
│ أكتر فئات اتغيرت (category comparison rows)     │
│ اكتمال البيانات: الفترتين متسجّلين بالكامل        │
└────────────────────────────────────────────────┘
```

The direction stays "from A to B" everywhere on the screen. ⇄ swaps them.

## 13. Arabic UI copy (colloquial, matching the app; D7)

| Key | Copy |
|---|---|
| presets | الأسبوع ده · الأسبوع اللي فات · الشهر ده · الشهر اللي فات · آخر 3 شهور · آخر 6 شهور · آخر 12 شهر · السنة دي · السنة اللي فاتت · من بداية التتبع · فترة مخصصة · دورة الراتب |
| sections | نظرة عامة · الإنفاق · التدفقات · الثروة · الأهداف |
| cards | الدخل · المصروف · الصافي · معدل التحويش · الفلوس الحرة · محجوز للصناديق · صافي الثروة |
| comparison line | «عن الفترة اللي فاتت» · «عن الشهر اللي فات» · «لحد نفس اليوم من الشهر اللي فات» · «زي الفترة اللي فاتت» |
| zero base | «جديد: مكانش فيه حاجة الفترة اللي فاتت» |
| sign flip | «اتحوّل من سالب لموجب» · «اتحوّل من موجب لسالب» |
| ratio | «+4.2 نقطة» · «−1.5 نقطة» |
| missing history | «البيانات المتاحة بتبدأ من ٥ أغسطس. مفيش بيانات كفاية لمقارنة دقيقة بالفترة اللي قبلها.» · «قارن من ٥ أغسطس» |
| point-in-time pending | «المقارنة هتظهر لما يتسجّل كفاية: التطبيق بيسجّل وضعك كل يوم من دلوقتي.» |
| quality | «متسجّل» · «محسوب من المعاملات» · «تقديري» · «مش متاح» · «اتعدّل بعد التسجيل» |
| valuation | «بأسعار كل يوم» · «بأسعار ثابتة (أسعار ٢٦ نوفمبر)» · «تقديري بأسعار النهارده» |
| freshness | «الأسعار: منذ 3 ساعات · تلقائي» · «الأسعار يدوي، آخر تعديل منذ 12 يوم» |
| receivables | «فلوس ليّا غير محصّلة: ر.س 6,000 (مش داخلة في صافي الثروة)» |
| fund split | «من صندوق» · «من فلوسك الحرة» · «من غير المصاريف اللي من صناديق: 31%» |
| liabilities | «الالتزامات: مش متسجّلة» (never «0») |
| pay cycle | «من ٢ نوفمبر · 25 يوم» · «الدورة دي فيها راتبين» · «لسه مفيش راتب متسجّل، بنعرض الشهر ده» |
| in progress | «لسه شغال» |
| compare screen | «قارن وضعك المالي» · «فترة بفترة» · «تاريخ بتاريخ» · «بدّل» |
| empty | «مفيش مصروف في الفترة دي.» · «مفيش دخل في الفترة دي، فمعدل التحويش مش محسوب.» |
| example statement (only when supported) | «صافي ثروتك زاد ر.س 24,250 في آخر 6 شهور (+40.4%).» Shown only if both ends are recorded with the same valuation method. |

## 14. Reusable chart and card components

| Component (new unless noted) | Built on | Used by |
|---|---|---|
| `PeriodPill` + `PeriodSheet` | `Chip`, `FormSheet`, `PastDateField` | header |
| `SectionChips` | `ChipRow` (scrollable) | header |
| `ComparisonLine` | `formatMoney`, `formatPercent`, `Change` | every card |
| `MetricCard` | `GlassSurface`/`Card`, `Money`, `ComparisonLine`, `QualityBadge` | overview |
| `QualityBadge` / `CompletenessNote` | `StatusChip`, `AppText` | everywhere a value isn't recorded |
| `NetWorthHero` | `Money` (`moneyHero`), gifted-charts `LineChart` (recorded solid, estimated hollow, no smoothing: `curved={false}`) | overview |
| `FootprintBar` | plain `View`s (like `stackedFlowSegments`) | spending |
| `RankedBars` | existing `BreakdownSection` rows, upgraded | spending |
| `SplitCard` (من صندوق / حرة) | `MetricGroup` | spending |
| `CategoryCompareSheet` | `FormSheet`, gifted-charts mini `BarChart` | spending |
| `CompareTable` | `ListGroup` rows | /compare |
| existing `SankeyChart`, `TrendSection`, `NetWorthSection`, `MoneySections` | unchanged | التدفقات / الثروة / الأهداف |

Colour semantics: income `primary` (emerald), spending `chartSky`, gold `gold` only for gold, warnings `warning`,
`danger` reserved for real problems (negative free money, overdraft), never for "spent more". Estimated data: hollow
markers and the `textMuted` colour. Missing data: no bar and no point (never a 0 bar), with a gap note.

## 15. Proposed selector and module architecture

| Layer | Module | Contents |
|---|---|---|
| Financial domain | `store/types.ts`, `operations.ts`, `selectors.ts` | unchanged, except the new `DailySnapshot` type and its write |
| Snapshot recording | **`store/dailySnapshots.ts`** | `buildDailySnapshot(state, now)`, `syncDailySnapshot(state, now) → Patch \| null` (pure), wired into `recordNetWorthSnapshots` / `SnapshotRunner` |
| Periods | **`store/analytics/periods.ts`** | presets, `payCycles(state)`, `previousOf`, `alignElapsed`, `coverage` (moved out of `analytics.ts`; `store/analytics.ts` re-exports for compatibility) |
| Ledger index | **`store/analytics/ledgerIndex.ts`** | memoised per `state.transactions` / `reservationMovements` array identity (WeakMap, like `snapshotById`): rows sorted by date with fee rows and spend amounts per expense; per-currency cache of as-recorded amounts; binary-search ranges |
| Historical reconstruction | **`store/history.ts`** | `positionAt(state, date)` (daily → monthly → ledger), `balanceAt`, divergence check (D3) |
| Valuation | **`store/valuation.ts`** | `priceSetAt(state, date)`, `priceSetNow(state)`, `valuePosition(position, priceSet, c)` (shares code with `netWorthFigures`) |
| Analytics engine | `store/analytics.ts` (existing) + **`store/analytics/metrics.ts`** | the metric registry `{ id, kind: 'flow' \| 'point' \| 'ratio', goodWhen, compute }`; `periodTotals` extended with `fromFund`, `byAccount`, `byCurrencyNative` |
| Comparison | **`store/comparison.ts`** | `compareValues`, `comparePeriods`, `compareCategories`, `compareDates` |
| Insights | `store/analytics.ts` `insights` (existing), later `store/insights.ts` | unchanged in the MVP except reading the new coverage (no "spending fell" on an in-progress month) |
| Presentation | `app/(tabs)/analytics.tsx`, `app/compare.tsx`, `components/analytics/*` | layout only, no business logic |

Rules: every module above is pure (no React Native), unit-tested in Node, and read-only with respect to the ledger.
The screen subscribes with selectors (not the whole store) and memoises on `[transactions, reservationMovements,
dailySnapshots, settings.rates, query]`.

## 16. Data schema and migration (data v10) — as built in Phase 1a

The proposal kept the history inside the ledger value. At approval it was moved to its **own AsyncStorage key**, and
that is what was built. Code: `store/dailySnapshots.ts` (pure), `store/useDailySnapshots.ts` (storage),
`store/migrateV10.ts`. Tests: `tests/dailySnapshots.test.ts`.

### 16.1 Record and store format

On disk (`@wealth_daily_snapshots`):

```ts
interface DailySnapshotStore { format: 1; ids: string[]; days: DailyRecord[] }   // days: strictly increasing dates

interface DailyRecord {
  v: 1;                 // record schema version
  d: string;            // local date key; one record per date
  t: string;            // ISO time of the observation kept (the last one of that day, D2 a)
  r: string;            // rateSnapshotId of the CURRENT rates (a reference into state.rateSnapshots, never a copy)
  fx: string;           // settings.rates.updatedAt (how fresh those rates were)
  g: [p24kEGP, p21kEGP, localPremiumPct, 'a' | 'm', goldPriceUpdatedAt, usdPerOunce | null] | 0;
  a:  [accountIdx, currency, balance][] | 0;          // every account, archived included, native
  rv: [fundIdx, accountIdx, amount][] | 0;            // non-zero reservations, account currency (= reservation())
  u:  [fundIdx, currency, amount][] | 0;              // non-zero legacy unresolved, never assigned to an account
  h:  ([idx, 'g', karat, grams] | [idx, 'c', currency, quantity])[] | 0;
  l:  [liabilityIdx, currency, remaining][] | 0;
  f:  fundIdx[] | 0;                                  // achieved funds that day
  n:  [transactionCount, lastUpdatedAt];              // ledger fingerprint (D3: detects later edits of the past)
}
```

- `ids` interns every entity id once (only appended); records refer to them by index.
- A section stored as `0` (`SAME`) means "identical to the previous record's section". The record still exists for its
  own date and its values were observed that day; `resolveDailyRecord` / `dailySnapshotOn` give the full record. The
  first record is always complete (validation refuses `SAME` there). This is compression, not carrying forward: a
  day without a record stays without one.
- Readable shape for analytics: `DailySnapshot` (`dailySnapshotOn(store, date)`; `undefined` for a date without a
  record, never a neighbour's).
- Receivables are not in the record (informational, never money, reconstructable from dated collections). Adding a
  section later is a record `v: 2`, not a ledger migration.

### 16.2 Writing (read-only with respect to the ledger)

- `syncDailyStore(store, state, now, rateSnapshotId)` (pure): upsert **today's** record; a new date appends; a past
  date is never touched; a clock behind the last recorded date does nothing; `null` when nothing changed.
- `recordDailySnapshot()` (storage side): only when the history is loaded and usable **and** the ledger hydrated
  successfully; calls the finance action `ensureCurrentRateSnapshot()` (op `currentRateSnapshot`: appends the current
  rate table to `rateSnapshots` only when it is new, nothing else), then `planDailyWrite` → `none` / `write` / `full`.
  Writes are serialized. INV-A7: building and syncing never change the ledger (deep-freeze test).
- Triggers (`SnapshotRunner`): after the ledger hydrated, on foreground, and 1.5 s after a change to accounts,
  transactions, holdings, liabilities, reservations, unresolved movements, funds or settings.
- Nothing is backfilled: the history starts the first day data v10 runs.

### 16.3 Isolation from the ledger (a damaged history never blocks anything)

| Situation | What happens |
|---|---|
| Nothing stored | empty history, recording starts |
| Read throws (e.g. a value too large for Android's CursorWindow) | `unreadable`: recording pauses, the stored value is left untouched |
| Stored value > 3 MB (`MAX_DAILY_READ_BYTES`) | `oversized`: not parsed, paused, untouched |
| Not JSON / wrong format / bad indices / dates not increasing / `SAME` in the first record | `invalid` (with the reason): paused, untouched |
| A write would pass 1.5 MB (`MAX_DAILY_STORE_BYTES`) | `full`: the write is refused, nothing lost, paused |
| A write fails | `write_failed`: retried on the next change |
| The ledger fails to hydrate | the history is not even loaded; nothing is written anywhere (existing fail-closed rule) |

The ledger (`@wealth_finance_state`) never reads the history key, so none of these can affect it (tested with a
corrupted, a 4 MB and a wrong-format value next to the ledger: the ledger hydrates and the history key is never
written). Settings → البيانات → «السجل اليومي» shows the state; only while it is unusable it offers «ابدأ سجل جديد»
(confirmation): the old value is copied to `@wealth_daily_snapshots_quarantine_<ISO>` and an empty history starts (a
value that can't even be read back is removed, since it can never be used on this device).

### 16.4 Migration v9 → v10 (`store/migrateV10.ts`)

- `CURRENT_VERSION = 10`; `settings.v10Step`; append-only `V10_STEPS`; `LATEST_V10_STEP = 1`.
- Step 1 `separateDailyHistory`: marks the data. A ledger value that carries `dailySnapshots` inline **throws** (fail
  closed; the history has its own key and its own validation). No amount, transaction or reservation changes (v9
  oracle report diff 0, tested on the rich fixture and the example seed).
- Every path ends in `applyV10Steps`: `version ≥ 8` → `applyV10Steps(applyV9Steps(applyV8Steps(p)))`; `< 8` → the frozen
  chain → `migrateV7toV8` → v9 → v10. Newer than v10 is refused (hydration guard, `parseBackup`).
- Copies: `@wealth_finance_state_backup_v9` before migrating a v9 payload; `…_backup_v10_before_step_{n}` before
  completing an unmarked v10 payload. Idempotent: twice = once, a current state is the same object.
- **Why still a version bump although the history is outside the ledger:** so that older builds refuse v10 data and v10
  backup files (which carry the history) instead of restoring or saving without it. The cost is the same as for v9:
  **OTA rollback is not a data rollback** (a v9 build fails closed on v10 data; fix forward, or restore
  `@wealth_finance_state_backup_v9` / an exported backup on a v9 build).

### 16.5 Backup and restore

- `createBackup(data, { dailySnapshots })`: the payload (plain, or inside the ciphertext) carries the history next to the
  ledger at `schemaVersion: 10`. Export includes it whenever it is loaded.
- `openBackup`: for v10+ files the history is taken out **before** the ledger is migrated and validated on its own:
  `daily = included | none | invalid`. A damaged history is left out and the ledger still restores (the preview row
  «السجل اليومي» says «مش سليم»). v0–v9 files → `none`. A pre-v10 file carrying `dailySnapshots` → `INVALID_FILE`.
- Restore replaces the history with the file's (empty for a file without one), after copying the current value to
  `@wealth_daily_snapshots_backup_before_restore`. The dev-only opening-data import empties it the same way.

### 16.6 Compatibility gate (passed)

1. Every v9 number unchanged by the migration (oracle diff 0); v1 / v7 / v8 chains end at v10; twice = once.
2. Hydration through the real `persist` with the app's own hooks: `backup_v9` first; unmarked v10 completed after its
   copy; newer refused; a broken history next to the ledger never affects it and is never written.
3. Backup round trip (plain + encrypted) keeps ledger and history deep-equal; older files restore with none; a damaged
   history doesn't block the ledger; a v10 file is newer than a v9 app (refused there).
4. INV-A2: reporting / plan currency change nothing in a record. INV-A7: the ledger is never mutated.
5. No money figure reads the history (it isn't part of `FinanceState`).

### 16.7 Storage size (measured, `tests/dailySnapshots.test.ts` → "storage size")

Synthetic heavy user: 14 accounts in 3 currencies, 25 funds (~38 non-zero reservations a day), 3 legacy unresolved, 12
holdings, 3 liabilities, 6 achieved goals; **every account balance and the gold price change every day**, reservations
every 9 days; 3 years of daily records; plus a 20,000-transaction ledger.

| Figure | Value |
|---|---|
| Full (uncompacted) record | ≈ 1.36 KB |
| Average stored record (with `SAME` sections) | ≈ 553 bytes |
| Per year | ≈ **197 KB** (year ends: 199 KB, 395 KB, 592 KB) |
| Cap (`MAX_DAILY_STORE_BYTES`) | 1.5 MB ⇒ ≈ **7.4 years** before recording pauses |
| One record built from the 20,000-transaction ledger | ≈ 1.4 KB (independent of the ledger size), ~18 ms in Node |
| **The ledger value itself** with 20,000 transactions | ≈ **6.4 MB** (separate key; see risk R-LEDGER, §22) |

A lighter, more typical user (fewer accounts and reservations, balances not all moving daily) stores less. Before the
cap is reached, a later phase can add yearly archiving or the D2 c change-only format.

## 17. Compatibility with the goals upgrade and receivables

| Area | Rule kept |
|---|---|
| Fund metrics | `fundSpent`, `fundContributed`, `fundProgressAmount`, `countsAsSaving` used as-is; analytics never redefines "saved" or "progress" |
| Spend vs cover | «من صندوق» = `spend` movements linked by `sourceTransactionId`; `cover` is "borrowed from a fund to cover spending" and is **never** counted as planned goal spending |
| Saving pace | unchanged (`spend` excluded, Q6). D4 only adds a cash-flow line |
| Achieved goals | achieved funds are out of suggestions and NBAs (`fundsByPriority`); analytics lists them under الأهداف from `achievedFunds`; INV-13 untouched |
| Legacy reservations | unresolved movements stay unresolved in snapshots and in every figure («محجوز ومش محدد حسابه») |
| Dangling legacy sinking spends | counted in `fundSpent` as today; excluded from the per-expense «من صندوق» split (they have no expense) and shown in the fund's spending only |
| Receivables | never in net worth, liquidity or any money total; one informational line; collections are income (cash basis, receipt date); `forMonth` available as a later drill filter (RECEIVABLES §4.5) |
| Fees | stay «رسوم» spending, visible in every breakdown |
| Data versions | v10 sits on top of v9 exactly like v9 sat on v8 |

## 18. Performance strategy

| Measure | Detail |
|---|---|
| Ledger index | built once per `transactions` array identity (Zustand replaces the array on every change, so identity = cache key), WeakMap cached like `snapshotById`; sorted by date; fee rows and per-expense spend totals precomputed |
| As-recorded amounts | cached per (index, reporting currency); a currency switch rebuilds one array, not every card |
| Period sums | binary search on the sorted dates + one pass over the range; month buckets precomputed for trend charts |
| Balances at D | per-account running totals in the index; `balanceAt` is a binary search, not a rescan |
| Screen | selector-based subscription (not `useFinanceStore()`), `useMemo` per tab, only the visible section chip renders its charts |
| Charts | at most ~60 points per series (downsample daily lines to weekly beyond 90 days; monthly beyond 2 years), never smoothed |
| Daily snapshot write | debounced like `SnapshotRunner`; a no-op when nothing changed (returns `null`, no persist) |
| Invalidation | automatic through array identity: any edit, backdated insert or delete creates a new array, so no stale cache |
| Benchmark | synthetic fixture: 5 years, ~18,000 transactions, 3 currencies, 15 funds; budget < 50 ms per tab computation in Node, then measured on a physical Android device in Phase 6 |

## 19. Financial invariants and test plan (synthetic fixtures only)

### 19.1 Invariants

| Id | Rule |
|---|---|
| **INV-A1** | Analytics never mutates state: every analytics / history / comparison function returns the same output for a deep-frozen state, and the state is identical afterwards. |
| **INV-A2** | Changing the reporting currency changes no stored amount, including snapshots (INV-1 extended). |
| **INV-A3** | Transfers and exchanges contribute 0 to income and spending; only their fees are spending. |
| **INV-A4** | Reservations never increase total assets: total assets with and without any set of `reserve` movements are equal. |
| **INV-A5** | No missing value becomes a number: a period or date without data yields `null` + `unavailable`, never 0, NaN or Infinity. |
| **INV-A6** | Reconciliation: Σ categories = spending; free money + from fund = spending; drill-down total = the tapped figure; Σ per-account spending = spending. |
| **INV-A7** | A daily snapshot's write changes only `dailySnapshots` (and may append to `rateSnapshots`). |
| **INV-A8** | Every v9 number is unchanged by the v10 migration. |

### 19.2 Required tests → where they land

| # | Test | Phase |
|---|---|---|
| 1 | historical account balance reconstruction (incl. openingDate, transfers, fees, backdated rows) | 1b |
| 2 | historical net worth: monthly recorded vs estimated, daily from snapshots | 1b |
| 3 | month-to-month comparison | 1b |
| 4 | custom range comparison | 1b |
| 5 | six-month net worth comparison (60,000 → 84,250 = +24,250, +40.42 %) with both ends recorded; refused when one end is estimated unless labelled | 2 |
| 6 | zero, negative and sign-flip baselines (no ∞, pp for ratios) | 1b |
| 7 | missing history (tracking started 3 months ago, 6-month request → coverage note, no zeros, earliest-date offer) | 1b |
| 8 | partial months and elapsed-days alignment (31-day vs 30-day months, 29 Feb) | 1b |
| 9 | historical FX valuation (snapshot rates vs constant rates) | 1b |
| 10 | historical gold valuation (snapshot prices; none before v10 → unavailable) | 1b |
| 11 | reporting currency change (INV-A2) | 1a/1b |
| 12 | internal transfer neutrality (INV-A3) | 1b |
| 13 | explicit FX neutrality apart from valuation and fees | 1b |
| 14 | reservation double-counting (INV-A4) | 1b |
| 15 | goal spending vs contribution (spend vs cover vs release; D4 line) | 3 |
| 16 | achieved fund behaviour (snapshot `achieved`, lists) | 5 |
| 17 | expense edit/delete effects on history (spend tombstones, D3 divergence label) | 1b |
| 18 | backdated transaction handling (new index, positions, as-recorded rates) | 1b |
| 19 | cache invalidation (array identity) | 1b |
| 20 | asset purchase classification (not spending, not income; gold bought metric) | 1b |
| 21 | attribution reconciliation | later (P4+) |
| 22 | date boundaries: Saturday weeks, month ends, leap years, local date keys (no UTC parsing) | 1b |
| 23 | RTL chart rendering | 6 (manual + web QA) |
| 24 | large history benchmark | 1b (Node), 6 (device) |
| 25 | backup and migration compatibility (§16.3 gate) | 1a |
| + | pay-cycle detection: on-time, late, two salaries in a week, receivable collections, no salary yet | 1b |
| + | snapshot: one per date, updated in place on the same date, frozen after; no backfill | 1a |
| + | size budget (§16.7) | 1a |

The full existing suite (`npm run test:logic`), `npx tsc --noEmit` and `npx expo lint` run after every step.

## 20. Implementation phases and dependencies

| Phase | Content | Depends on | Ships as |
|---|---|---|---|
| **1a** ✅ built | Daily snapshots (own storage key): type, `migrateV10`, `syncDailySnapshot`, runner wiring, backup/restore, compatibility gate, size test, docs (TECHNICAL, USER_GUIDE line, CHANGELOG with data v10 and the rollback note), D13 fix | approval of D2, D3, D11 | **its own OTA, as early as possible** (no visible UI except a line in Settings → البيانات «سجل يومي من …») |
| **1b** | Periods (all presets + pay cycle), coverage, ledger index, `history.ts`, `valuation.ts`, `comparison.ts`, metric registry, tests 1–14, 17–20, 22, 24 | 1a merged; D1, D5, D10 | no UI change (engine only) |
| **2** | Section chips, period pill + sheet, Overview (hero, 6 cards, receivables line), existing sections moved under chips, /compare Mode A, Mode B limited to recorded dates, persisted preset (D6) | 1b | OTA |
| **3** | Spending tab: footprint bar, ranked bars, «من صندوق» split, one-time / recurring split, by account / currency, category comparison sheet, drill-down filters | 1b (parallel to 2 after its header work) | OTA |
| 4 | Wealth: historical net worth (daily line once ≥ 14 days are recorded), allocation donut, currency exposure, liquid vs non-liquid, gold analytics (weight by karat, cost, unrealised P&L, share), constant-rate view | 1a history accumulating | later |
| 5 | Goals & intelligence: fund analytics (contributions, spending, releases per period; goal progress over time from snapshots), transparent individual health indicators (savings rate, emergency coverage = free money ÷ average essentials, liquidity), insights rewritten on the comparison engine, monthly report (extending `review.ts`), fixed vs variable (D9) | 1b, 2, 3 | later |
| 6 | Polish: glass refinement, accessibility (labels, contrast tested like `dark theme contrast`), chart tooltips / drag-inspect, performance on a physical Android device, full regression, docs | all | later |
| P7 | **App-wide MSA copy pass** (approved as a separate post-MVP phase, D7) and digit unification (D8) | MVP done | separate |
| P8 | **Dated balance-adjustment entries (D14):** «عدّل الرصيد الحالي» records each future adjustment as a dated entry instead of rewriting `openingBalance`; no backfill of past data. Feeds attribution ("opening balances and adjustments") and makes reconstructed balances stable. | MVP done; schema change + own design and migration | separate |
| Later | Attribution waterfall, calendar heatmap, pinch-to-zoom, PDF/CSV export, composite score (if ever, with documented formula), investments (needs a ledger), gold sale transaction, adjustment transaction, resale value, receivables history | schema items | separate designs |

Each phase stops for review before the next. Commits are local only; the owner pushes.

## 21. Estimated complexity (single developer, ~8–10 h/week)

| Phase | Size | Hours (estimate) | Calendar |
|---|---|---|---|
| 1a daily snapshots + v10 | M | 12–16 | ~1.5–2 weeks |
| 1b engine | L | 24–30 | ~3 weeks |
| 2 overview + compare (Mode A) | M–L | 18–24 | ~2–2.5 weeks |
| 3 spending | M | 16–20 | ~2 weeks |
| **MVP total** | | **70–90** | **~8–10 weeks** |
| 4 wealth | M | 16–22 | ~2 weeks |
| 5 goals + intelligence + report | L | 26–34 | ~3–4 weeks |
| 6 polish + device QA | M | 12–18 | ~1.5–2 weeks |

The biggest risk to these estimates is chart work in gifted-charts on RTL, and device QA time.

## 22. Risks and unresolved product decisions

| Risk | Mitigation |
|---|---|
| History not recorded until 1a ships | ship 1a alone and first |
| Daily history size on Android (§16.7) | measured in 1a (≈ 197 KB/year heavy user, cap ≈ 7 years); own key; change-only fallback |
| v10 rollback drops nothing but blocks old code | fail-closed by design; backup before update; fix forward |
| Pay-cycle heuristics misfire (bonus in «راتب», split salaries) | `MIN_CYCLE_DAYS`, cycle shows its receipts, calendar month stays default |
| Users read "تقديري" figures as exact | quality badge on every non-recorded value; comparisons refuse mixed methods |
| Reconstructed balances shift after «عدّل الرصيد» | D3 divergence label; **D14 / P8**: dated balance-adjustment entries from then on (no backfill), so only adjustments made before P8 keep shifting history |
| **R-LEDGER: the ledger value grows past Android's storage limits** (found in Phase 1a: ≈ 330 bytes per transaction, ≈ 6.4 MB at 20,000; a single value above ≈ 2 MB may not read back, 6 MB default database size; pre-migration copies are full copies) | measure on the device; plan a ledger-storage design (split the value, or raise `AsyncStorage_db_size_in_MB`) before the ledger nears 2 MB; the daily history is already kept apart so it never adds to it |
| Insights on in-progress periods mislead | insights read coverage; no "spending fell" before the period is comparable |
| Chart performance / RTL on Android | downsampling, one visible section, device QA in 6 |
| Scope creep beyond MVP | the MVP table (§A) is the contract; anything else needs a new approval |

Unresolved (not blocking the MVP): whether receivables should ever appear in a "net worth incl. money owed to me"
view; whether achieved goals' leftover reservations should be shown apart from active reservations on the Overview;
the resale-spread input for gold; whether to add a gold sale transaction.

## 23. MVP vs later enhancements

| MVP (Phases 1a–3) | Later |
|---|---|
| daily snapshots (v10) | attribution waterfall |
| all period presets + pay cycle + custom | calendar heatmap |
| Mode A comparison engine with quality labels | pinch-to-zoom |
| Overview: hero + 6 cards + receivables line | PDF / CSV export |
| Spending: footprint, ranked bars, «من صندوق» split, one-time, fees, by account / currency, category comparison, drill-down | composite health score (prefer individual indicators) |
| Mode B and the net worth chart for recorded dates only | investment analytics (not tracked) |
| existing sections kept under the new chips | gold analytics depth (cost basis, P&L history), constant-rate wealth view |
| | goals analytics over time, health indicators, monthly report, fixed vs variable |
| | app-wide MSA and digit pass |

### What can be calculated accurately today vs not

- **Accurate today:** every period flow (income, spending, net, savings rate, categories, buckets, accounts,
  currencies, one-time, fees, «من صندوق», gold bought, fund contributions / releases), current positions (net worth,
  liquid, reserved, free money, gold value at today's prices), net worth at past month ends for months the app
  recorded live (as "last value seen that month").
- **Reconstructable with a label:** past account balances in native currency; past liquid value at constant (today's)
  rates; past gold weight.
- **Not available today, available going forward from 1a:** reserved and free money at a past date; gold and FX prices
  at a past date; daily net worth; goal lifecycle per day.
- **Not feasible without new schema:** realised gold gains (no sale), adjustment attribution, investment returns,
  resale value, a historical goal lifecycle before 1a.
