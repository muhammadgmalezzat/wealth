# Changelog

Each entry: date · app version (`app.json`) · persisted data version (`store/migrations.ts`)
· what changed for users · what changed technically. Newest first. Reconstructed from the git
history up to `ad66d8c`; "Unreleased" covers work not committed yet.

---

## Unreleased (2026-10-05) — 1.1.0 · data v6 (OTA update) · Calm Wealth phase 5

Calm Wealth — phase 5: Funds, Fund detail, Recurring, Due.

> JS-only (ships with `eas update` to 1.1.0 builds). No store, data, schema or native changes;
> saved funds, fund movements and recurring rules keep exactly the same shape.

**For users**
- Funds tab: money to plan, then totals (reserved / needed this month / count), then funds by
  type; a clear empty state with "أنشئ صندوق طوارئ".
- Fund detail puts progress and the next step first (e.g. "محتاج X الشهر ده"), one main action
  (إضافة مبلغ, or اتدفعت for recurring bills), the key numbers, linked gold, and the history last
  — withdrawals are no longer red.
- Fund, add/withdraw, pay, distribute and cover sheets use the big amount field and calmer copy
  ("غطّي الفرق من الصناديق دي").
- Recurring: the next 30 days as a list with totals per currency, rules grouped by income /
  expenses / transfers with clear tags (تلقائي / بتأكيد / متوقف / انتهى). Turning a rule off no
  longer opens it.
- The recurring sheet asks the essentials first; end date and note are under "تفاصيل أكتر".
- Due inbox: missed items marked "فات ميعاده" (amber, not red), "تم" and "تخطّي" on every row,
  and "مفيش حاجة مستنياك." when it's empty.

**Technical**
- New pure helpers `components/funds/fundsUi.ts` and `components/recurring/recurringUi.ts`
  (+5 tests; 160 total).
- Rebuilt `app/(tabs)/goals.tsx`, `app/fund/[id].tsx`, `app/recurring.tsx`, `app/due.tsx`;
  restyled FundSheet, MoveMoneySheet (adds an إضافة/سحب segment), PaySinkingSheet, AssignSheet,
  CoverSheet, RuleSheet, ConfirmOccurrenceSheet with their logic sections unchanged.
- Recurring rows keep the Switch outside the Pressable (web fired both).

---

## Unreleased (2026-10-05) — 1.1.0 · data v6 (OTA update) · Fixes

> JS-only. No schema, data-version or persisted-shape change.

**Fixes**
- A1 — Funds are no longer "محتاج انتباه" from the first day of every month. New status
  **pending** ("الشهر ده"): this month's contribution isn't in yet but there's still time — more
  than 7 days left in the month, or the fund was created this month. Only the last 7 days turn a
  shortfall into **behind**. Home's next step only reacts to behind; Home orders funds behind →
  pending → nearest due.
- A2 — Transfer edits re-snapshot `rateToEGP` when the from-account currency changes. On
  inspection the store already did this (`updateTransaction` compares the from-account currency for
  transfers); new tests now pin both directions, no code change was needed.
- A3 — An invalid recurring mode reports the new `INVALID_MODE` ("طريقة التسجيل غير صالحة")
  instead of `INVALID_FREQUENCY`.
- A4 — A plan line with a 0 limit and spending says "مفيش ميزانية للبند ده: اتصرف X" (still the
  "over" state).
- Two existing tests were updated for the approved A1 behavior change (they asserted the old
  "behind from day 1" rule): the fundStatus test and the "fund behind" next-step test.

**Technical**
- `FundStatus` gains `'pending'`; `BEHIND_DAYS_LEFT = 7`; `fundStatus` uses `daysLeftInMonth`
  from planning.ts (circular import, used only at call time). `FUND_STATUS`, `STATUS_BADGES`,
  `fundStatusSentence`, `homeFunds` updated.
- `INVALID_MODE` error code + Arabic message; `lineSentence` zero-limit wording.
- Tests: 155 (+10 incl. the 7-vs-8-days boundary and "created this month").

---

## Unreleased (2026-10-05) — 1.1.0 · data v6 (OTA update) · Calm Wealth phase 4

Calm Wealth — phase 4: Monthly Plan.

> JS-only (ships with `eas update` to 1.1.0 builds). No store, data, schema or native changes;
> saved plans keep exactly the same shape.

**For users**
- The plan reads like a plan: a summary (expected income / planned / left to plan) with one clear
  status line, the safe-to-spend amount with fixed vs flexible explained once, lines grouped by
  أساسيات / رفاهيات / عطاء, fund contributions, spending outside the plan, and the recurring link.
- Each line: spent of limit, remaining, and a thin bar; "قرب الحد" (amber) for a flexible line at
  85 %+, "عدى الخطة بـ X" (red) only when really over, "اتدفع" for a paid fixed bill.
- Tap a line on the Plan screen to see where it stands and change its limit, kind or bucket, or
  remove it — saved right away. "+ أضف بند" works from the Plan screen too.
- Editing the plan: a live "المتبقي للتخطيط" at the top, a big expected-income field, and per line
  a ثابت/مرن switch, the limit and a remove button.
- "كل البنود" now groups categories under أساسيات / رفاهيات / عطاء (plan and transactions).
- No emoji or "✓" in the plan anymore.

**Technical**
- New `components/plan/PlanLineRow.tsx`, `components/plan/planUi.ts` (pure, tested),
  `components/ui/MetricGroup.tsx` (MonthlySnapshot now uses it).
- `SectionHeader` gains `trailing`; `MonthSwitcher` lost its outer margin (screens space it);
  `CategoryPicker` groups the expanded expense list and gains `forceExpanded` / `label`;
  `LineSheet` gains `progress`; `FormInput` right-aligns via style (web fix).
- PlanEditorSheet / AddLineSheet / LineSheet restyled with their logic unchanged; the Plan screen
  saves single-line edits through the existing `savePlan` (`withLine` / `withoutLine`).
- Tests: 145 (+6 for planUi).

---

## Unreleased (2026-10-05) — 1.1.0 · data v6 (OTA update) · Calm Wealth phase 3

Calm Wealth — phase 3: Transactions screen, TransactionRow, TransactionSheet.

> JS-only (ships with `eas update` to 1.1.0 builds). No store, data, schema or native changes;
> saved transactions keep exactly the same shape.

**For users**
- Transactions: the month summary from Home, filter chips, and each day as one calm grouped
  list; day totals are grey, never red; a clear empty state, and a one-line message when a
  filter has no match.
- Rows: an icon per type, the category (or "من ← إلى" for transfers, the gold name for gold),
  account and note on one line, small tags (لمرة واحدة / متكرر / مؤرشف), expenses in the regular
  text color, income green with "+", and "≈ … ج.م" under SAR/USD amounts.
- Adding a transaction is faster: a big amount field, the last-used category first (max 6 chips,
  "كل البنود" for the rest), the account as one line you tap to change, and the rarely used
  fields (note, one-time, make recurring) under "تفاصيل أكتر".
- The budget hint is calmer: ✓ "هيفضل X في …" or an amber "المبلغ ده هيعدّي ميزانية … بـ X".
- Missing amount / account / category is also shown under the field.

**Technical**
- New `components/transactions/`: `transactionUi.ts` (pure, tested), `CategoryPicker`,
  `AccountPicker`, `GoldFields`, `MoreDetails`. `TransactionSheet` keeps all state and save logic
  (diff of the logic section: only the inline-error additions).
- `TransactionRow` rebuilt on `ListRow` (new `titleColor`, `subtitleLines`, `accessory` props).
- `AmountInput`: hint icon; stretches with a flexing, style-centred input (web fix).
- `MonthlySnapshot`: `month` and `linkToTransactions` props. `DateFields` show Arabic dates.
- Tests: 139 (+5 for the transactions UI helpers).

---

## Unreleased (2026-10-05) — 1.1.0 · data v6 (OTA update) · Calm Wealth phase 2

Calm Wealth — phase 2: Home redesign, tab bar, navigation theme, FundCard.

> JS-only (ships with `eas update` to 1.1.0 builds). No store, data, schema or native changes.

**For users**
- New Home: greeting and date; **تقدر تصرف بأمان** as the main card (or "اعمل خطة الشهر");
  one **next step** card (cover spent fund money → due items → something due within 3 days →
  a fund that's behind → money to distribute); **هذا الشهر** (income / expense / net);
  **جاي قريب** (next 3 recurring items); up to 3 funds; money available to plan; a compact net
  worth card (Egypt / Saudi, cash vs gold); the backup nudge; the last 5 transactions with an
  empty state.
- Expenses are no longer shown in red; red is kept for real problems (spent fund money).
- Fund cards: "X من Y", a status chip (متقدم / على المسار / محتاج انتباه / بدون موعد), one
  sentence with what's needed, linked gold shown in gold on the progress bar.
- Calmer tab bar and headers on the warm background; new tab icons.
- Dates on Home are fully Arabic (no "Sept").

**Technical**
- New pure `components/dashboard/homeInsights.ts` (`nextBestAction`, `homeFunds`,
  `upcomingItems`, Arabic count/day phrases) + 8 tests (134 total).
- New `MonthlySnapshot`; rebuilt `SafeToSpendCard`, `RecurringCard`, `NetWorthCard`
  (now takes `state`), `BackupReminder` (InsightCard; `needsBackupReminder`), `UnassignedPanel`,
  `FundCard`; `labels.ts` gains `FUND_STATUS` / `fundStatusSentence` (`STATUS_BADGES` derived).
- `TransactionRow`: color by meaning, tokens, `formatMoney`, `formatDateAr`.
- `formatMoney` moved to pure `components/ui/formatMoney.ts` (re-exported by `Money`) and now
  puts an LRM before the sign so "−1,250" stays together after the Arabic symbol; new
  `formatDateAr.ts`.
- Navigation theme from tokens in `app/_layout.tsx`; tab bar restyle + icon mapping in
  `app/(tabs)/_layout.tsx` / `icon-symbol.tsx` (web-only taller bar so Arabic labels aren't
  clipped).
- Lint: the old BOM / unused-import warnings are gone (files rewritten).

---

## Unreleased (2026-10-05) — 1.1.0 · data v6 (OTA update) · Calm Wealth phase 1

Calm Wealth — phase 1: design tokens + shared UI primitives (no screen changes).

> JS-only (ships with `eas update` to 1.1.0 builds). No store, data, schema or native changes.

**For users**
- New calmer palette (warm off-white ground, deep green, gold) shows through the existing
  screens via the shared components: cards, chips, segmented controls, progress bars, form
  sheets and inputs, the "+" button and the month switcher. Metric tiles lose their colored top
  strip. Screen layouts are unchanged; they are redesigned one by one in the next phases.

**Technical**
- `constants/theme.ts` rewritten: `palette` / `colors` (`ThemeColors`, `ColorToken`), `space`,
  `radius`, `type` (+ `typography`, `TypeVariant`), `shadow`, `opacity`, `size`. `Colors`,
  `FinanceColors`, `Fonts` kept as deprecated aliases mapped onto the tokens (removal: phase 7).
- New primitives in `components/ui/`: `AppText`, `Button`, `StatusChip`, `Money` (+
  `formatMoney`), `AmountInput`, `FormField`, `ListRow` / `ListGroup`, `SectionHeader`,
  `InsightCard`, `EmptyState`.
- Refactored on tokens (same APIs): `Card` (+ `variant`), `Chip`, `Segment`, `ProgressBar`
  (+ `tone`, `goldPortion`; `color`/`backgroundColor` deprecated), `FormSheet` (+ `FormInput`,
  `FieldLabel`), `Fab`, `Screen`, `StatCard` (`accentColor` ignored), `CurrencyText`,
  `LoadingView`, `MonthSwitcher`. Safe-area logic untouched.
- RTL rule documented: LTR layout engine + explicit `row-reverse` / right-aligned text /
  LTR-isolated money.

---

## Unreleased (2026-10-03) — 1.1.0 · data v6 (OTA update) · safe areas

> JS-only (ships with `eas update` to 1.1.0 builds). No data or native changes.

**For users**
- Nothing is drawn under the status bar any more: screen titles, the settings gear and header
  buttons sit below it on every screen; status-bar icons are dark so they're visible on the light
  background.
- Sheets' last fields and buttons (حفظ / حذف…) are no longer hidden behind the Android navigation
  bar; on Android a sheet's header no longer sits under the status bar.
- The "+" buttons sit just above the tab bar on tab screens and above the navigation bar on
  المعاملات المتكررة / البنود.
- The lock screen content is centred within the visible area.

**Technical**
- New `components/ui/Screen.tsx` (the only outer layout for routes: `scroll`, `edges`,
  `contentStyle`, `refreshControl`, `header`, `overlay`) and `components/ui/Fab.tsx`
  (`placement: 'tab' | 'stack'`, `FAB_CLEARANCE`); five duplicated FAB styles removed.
- All routes migrated: tabs use `edges={['top']}`; stack screens use the native header +
  `edges={['bottom']}`; `fund/[id]` gets a default title in `app/_layout.tsx`.
- `FormSheet`: `useSheetInsets()` (Android top inset, bottom inset everywhere),
  `statusBarTranslucent` / `navigationBarTranslucent`. `AppLockGate` pads by the insets.
- `<StatusBar style="dark" />`. No `SafeAreaView` from `react-native`, no compensating
  hard-coded top paddings; direct `useSafeAreaInsets()` only in Screen, Fab, FormSheet and
  AppLockGate.

---

## Unreleased (2026-10-03) — 1.1.0 · data v6 (OTA update)

> JS-only: ships with `eas update` to 1.1.0 builds. No new native module, `app.json` unchanged,
> data version unchanged (`Category.archived` is optional; missing = not archived).

**For users**
- New **«أضف بند»** sheet in the plan editor with two tabs: **من الموجود** (categories not in the
  plan, by أساسيات / رفاهيات / عطاء, with search; then limit + ثابت / مرن) and **بند جديد** (name,
  required type, ثابت / مرن defaulting to مرن, limit in the plan currency; creates the category and
  the plan line together).
- Plan lines in edit mode are rows (name, ثابت/مرن, limit); tapping one opens a small sheet: limit,
  ثابت / مرن, **«نقل لـ»** (moves the category to another type, with a warning that it affects all
  its past and future transactions) and **«شيل من الخطة»**.
- New **البنود** screen (from Settings and from «أضف بند» → «إدارة البنود»): expenses by type and
  income; add, rename, move between types; **archive** categories that are used (or default) and
  restore them; delete only unused custom categories. Archived categories disappear from pickers
  and plan suggestions but still count in history and reports.

**Technical**
- `Category.archived?`. Operations: `addCategory` / `updateCategory` (trimmed names unique among
  active categories, kind and `isDefault` locked), `archiveCategory(id, archived)`,
  `deleteCategory` (custom + unused only, tombstone), exported `categoryInUse`, atomic
  `addCategoryWithPlanLine`. New error codes `CATEGORY_NAME_TAKEN`, `CATEGORY_KIND_LOCKED`,
  `DEFAULT_CATEGORY_DELETE`, `PLAN_NOT_FOUND`; clearer `CATEGORY_IN_USE` text.
- `selectors.pickerCategories(categories, kind, keepIds)` used by TransactionSheet, RuleSheet,
  PaySinkingSheet and AddLineSheet; `planSuggestion` skips archived categories.
- New `components/plan/AddLineSheet.tsx`, `LineSheet.tsx`, `labels.ts`;
  `components/categories/CategorySheet.tsx`; route `app/categories.tsx`; `Segment` accepts an
  unselected (`undefined`) value.
- Tests: 126 (+7 category management); one existing plan test now deletes a custom category
  (defaults can't be deleted any more).

---

## Unreleased (2026-10-03) — 1.1.0 · data v5 → v6

> **Needs a new native build** (`expo-notifications` added). App version bumped 1.0.0 → 1.1.0, so
> updates published from this code only reach 1.1.0 builds.

**For users**
- **Recurring income, expenses and transfers** (المعاملات المتكررة), reachable from the Plan tab
  and Settings: weekly / monthly / yearly, every N periods, day of month (31 → last day of
  short months), start and optional end date, approximate ("المبلغ بيتغير") amounts, pause/resume,
  edit, delete (past transactions stay). "جاي خلال 30 يوم" with income/expense totals.
- Two modes: **تلقائي** (recorded by the app on its date, including missed ones, when the app is
  opened) and **بتأكيد** (waits in the new **المستحقات** inbox with **تم** — editable amount,
  account, date, note — and **تخطّي**; missed months listed separately, oldest first).
- Dashboard: "عندك X مستحقات" card and a "جاي الأسبوع ده" line with the next 3 items.
- "خليها متكررة" button when editing a transaction: creates a monthly rule from it (that
  transaction counts as the first occurrence).
- Plan suggestions use recurring rules: recurring expenses become fixed lines at their monthly
  amount; recurring income becomes the expected income.
- Optional **تنبيهات المستحقات** in Settings (off by default): a local reminder at 10:00 on the
  due date of each "بتأكيد" item. Not available on the web.
- Existing recurring rules (if any) are kept and switched to "بتأكيد".

**Technical**
- Data v6: new `RecurringRule` shape (`kind` incl. transfer, `interval`, `dayOfMonth`, `startDate`,
  `endDate?`, `mode`, `variableAmount`, `skippedDates`, `note?`, `createdAt`; `nextDate` derived);
  `recurringRuleId?` + `occurrenceDate?` moved to every transaction type;
  `settings.dueNotificationsEnabled?`. `migrateV5toV6` (legacy rules → confirm, interval 1;
  idempotent); raw backup `@wealth_finance_state_backup_v5`.
- New pure engine `store/recurring.ts` (`occurrencesBetween`, `dueOccurrences`, `nextOccurrence`,
  `upcoming`, `monthlyEquivalent`, `reminderSchedule`).
- Operations: `addRecurringRule(input, linkTransactionId?)`, `updateRecurringRule`,
  `setRecurringActive` (resume skips the paused period), `deleteRecurringRule` (unlinks past
  transactions + tombstone), atomic idempotent `processDue` (current-rate snapshot),
  `confirmOccurrence`, `skipOccurrence`, `setDueNotifications`; error `OCCURRENCE_NOT_DUE`.
- `components/RecurringRunner.tsx` runs `processDue` after hydration and on foreground, and keeps
  scheduled reminders in sync. `utils/notifications(.web).ts` wraps `expo-notifications` 57.0.21
  (Android channel `due`); `app.json` plugin added.
- Routes `/recurring` and `/due`; `RuleSheet`, `ConfirmOccurrenceSheet`, `RecurringCard`;
  `planning.recurringMonthly`, `planSuggestion` / `emptyPlan` use recurring rules;
  `TransactionSheet` keeps occurrence links on edit.
- Tests: 119 (+18: schedule clamps/interval/yearly/weekly/endDate, processDue idempotence and
  skipped dates, confirm/skip and missed months, paused/resume, link from transaction, delete keeps
  history, monthly equivalent and SAR/EGP plan conversion, upcoming totals, migration v5 → v6).

---

## Unreleased — 1.0.0 · data v5

**For users**
- New **الخطة** tab: monthly plan by category (أساسيات / رفاهيات / عطاء), fixed vs flexible
  lines, fund contributions, "غير مخطط", and three ways to start (suggest from spending, copy last
  month, from scratch).
- Dashboard **«تقدر تصرف بأمان»** card with a per-day amount and an overspent warning; prompts
  "اعمل خطة الشهر" when there's no plan.
- Live budget hint while adding an expense ("هيفضل X…" / "هتعدّي ميزانية … بـ X").
- Settings shows app version, runtime and update id.
- The app can now receive over-the-air updates (after one new build).
- Project documentation (technical guide, user guide, this changelog).

**Technical**
- Data v5: `MonthlyPlan { id: plan-YYYY-MM, currency, expectedIncome, lines, fundContributions }`;
  `migrateV4toV5` (idempotent, re-keys plan tombstones). New `store/planning.ts`; `savePlan`,
  `copyPlan`, `deletePlan` operations; old lifestyle-only `safeToSpend` removed.
- `expo-updates` installed; `runtimeVersion: appVersion`, `updates.url`, `checkAutomatically: ON_LOAD`;
  EAS channels `preview` / `production`.
- EAS config: `eas.json` (development / preview APK / production), `android.package` and
  `ios.bundleIdentifier` `com.muhammad404.wealth`, `.easignore` keeping `store/seed.local.ts`.
- Shared `MonthSwitcher`; Plan tab registered between المعاملات and الأصول.
- Tests: 101 (`npm run test:logic`).

---

## 2026-10-03 — 1.0.0 · data v3 → v4 · `ad66d8c`

**For users**
- Accounts have a location (مصر / السعودية); net worth split by location.
- Transaction type **شراء ذهب** (cash → gold at cost, not an expense) and **«مصروف لمرة واحدة»**.
- **Settings** screen: exchange rates, gold prices (24k / 21k; 18k derived), tracking start date,
  import opening data.
- Encrypted **backup export / restore** (password-protected by default), weekly backup reminder.
- Optional **app lock** (fingerprint / face / device PIN).
- Arabic tab names: الرئيسية / المعاملات / الأصول / الصناديق.

**Technical**
- Data v3: `location`, `openingDate`, `oneTime`, `asset_purchase` transactions, `goldPrice21kEGP`,
  `trackingStartDate`, new default categories; `buyGold`, `updateGoldPurchase`, `updateSettings`,
  `replaceWithSeed`; month summary ignores transactions before the tracking start.
- Data v4: `updatedAt` on every entity, `tombstones`, `settings.deviceId`; every operation stamps
  `updatedAt` and logs deletions.
- `store/backup.ts`: AES-256-GCM + PBKDF2-SHA256 (200k), AAD-bound header, restore via the
  migration chain, pre-import / pre-restore snapshots.
- New deps: expo-file-system, expo-sharing, expo-document-picker, expo-local-authentication,
  @noble/ciphers, @noble/hashes.

---

## 2026-10-03 — 1.0.0 · data v2 · `5ddbdd7`

**For users**
- **الصناديق** tab: emergency / goal / sinking funds by priority, status badges, linked gold.
- Fund detail screen: add, withdraw, "اتدفعت" for sinking funds, movement history.
- «وزّعها» (distribute unassigned money with a suggested split) and «غطّيها» (cover overspending
  from funds).

**Technical**
- `allocateMany`, `withdrawMany`, atomic `paySinkingFund`; `suggestAllocation`, `planCover`,
  `sinkingMonthlySuggestion`; sinking `frequency` / `nextDueDate`; fund route `fund/[id]`.

---

## 2026-10-03 — 1.0.0 · data v2 · `0e8bbb2`

**For users**
- **المعاملات** tab: monthly list grouped by day, filters, income/expense/net cards.
- Add / edit / delete transactions; transfers between currencies with an editable received amount;
  Arabic digits accepted in amounts.

**Technical**
- `TransactionSheet`, `TransactionRow`, date picker (native + web), `parseAmount`,
  `transactionsForMonth`, `groupTransactionsByDay`; edits keep the rate snapshot unless the
  currency changes.

---

## 2026-10-03 — 1.0.0 · data v2 · `62cac38`

**For users**
- New data model: accounts, Arabic categories, transactions, funds, holdings.
- Dashboard: net worth, unassigned money, month net, funds with editing; Assets: edit account
  balance, gold profit/loss.
- Arabic error messages.

**Technical**
- Upgrade to Expo SDK 57; data model V2 with migration v0 → v1 → v2 (with raw backup); pure
  `operations.ts` with typed error codes; 28 logic tests.

---

## 2026-10-03 — 1.0.0 · data v1 · `0ac8217`

**For users**
- Screens stay in sync; consistent totals everywhere.

**Technical**
- Zustand + persist store, single-source selectors, template cleanup, personal seed moved out of git.

---

## 2026-06-06 — 1.0.0 · `eb5fee4`, `df3abe8`, `0879a88`

- Initial Expo Router project and first folder structure (dashboard and assets prototypes).
