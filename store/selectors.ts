import { COUNTRY_REGISTRY, countryCodes, type CountryRegistry } from '@/constants/countries';
import { convertCurrency, fromEGP, projectAmount, toEGP } from '@/utils/currency';
import { addIn, decimalsFor, roundIn, sumIn, sumTo } from '@/utils/money';
import { monthOf, monthsUntil, shiftMonth, toMonthKey } from '@/utils/dates';
import { CATEGORY_IDS, feeCategoryId } from './defaultCategories';
import { daysLeftInMonth } from './shared';
import type {
  Account,
  CountryBreakdown,
  AssetPurchaseTransaction,
  Category,
  CountryCode,
  CurrencyCode,
  ExpenseBucket,
  FinanceState,
  Fund,
  ReservationKind,
  GoldKarat,
  Holding,
  IncomeExpenseTransaction,
  Liability,
  NetWorthBreakdown,
  SinkingFrequency,
  Transaction,
} from './types';

// Single source of truth for every derived financial figure. All functions are pure.
// Balances and holdings are valued at CURRENT rates/prices (what they're worth now);
// transaction flows use each transaction's snapshotted rateToEGP (what they were worth then).

type State = FinanceState;


const isIncomeExpense = (tx: Transaction): tx is IncomeExpenseTransaction =>
  tx.type === 'income' || tx.type === 'expense';

// --- Fees as spending ---------------------------------------------------------

type FeeState = Pick<State, 'transactions' | 'accounts' | 'categories'>;

// The fees of every transfer and exchange as VIRTUAL expenses (never stored): in the currency of the account
// they are charged to, in their category (the fees category by default), dated and valued at the record's own
// rates. `feeOfId` is the record they belong to.
export function feeExpenses(state: FeeState): IncomeExpenseTransaction[] {
  const rows: IncomeExpenseTransaction[] = [];
  for (const tx of state.transactions) {
    if (tx.type !== 'transfer' && tx.type !== 'exchange') continue;
    tx.fees.forEach((fee, index) => {
      const account = state.accounts.find((a) => a.id === fee.accountId);
      rows.push({
        id: `${tx.id}#fee${index}`,
        feeOfId: tx.id,
        type: 'expense',
        amount: fee.amount,
        currency: account?.currency ?? '',
        accountId: fee.accountId,
        categoryId: fee.categoryId ?? feeCategoryId(state.categories) ?? CATEGORY_IDS.fees,
        date: tx.date,
        ...(tx.note ? { note: tx.note } : {}),
        rateSnapshotId: tx.rateSnapshotId,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
      });
    });
  }
  return rows;
}

// Every income and expense: the recorded ones plus the fees of transfers and exchanges (as expenses). What
// spending, income and plan figures are made of.
export function incomeExpenseRows(state: FeeState): IncomeExpenseTransaction[] {
  return [...state.transactions.filter(isIncomeExpense), ...feeExpenses(state)];
}

// --- Accounts ---------------------------------------------------------------

type LiquidState = Pick<State, 'accounts' | 'transactions' | 'settings'>;
// What per-currency liquid money needs: every currency the data uses, not just the accounts'.
type LiquidByCurrencyState = LiquidState & Pick<State, 'funds' | 'holdings' | 'unresolvedMovements'>;

// Net effect of all transactions on the account, in its own currency. Added in integer minor units, so
// a thousand 0.01s are exactly 10.00.
export function accountNetFlow(state: Pick<State, 'accounts' | 'transactions'>, accountId: string): number {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return 0;
  const effects: number[] = [];
  for (const tx of state.transactions) {
    if (tx.type === 'transfer' || tx.type === 'exchange') {
      const sent = tx.type === 'transfer' ? tx.amount : tx.sentAmount;
      const received = tx.type === 'transfer' ? tx.amount : tx.receivedAmount;
      if (tx.fromAccountId === accountId) effects.push(-sent);
      if (tx.toAccountId === accountId) effects.push(received);
      // Fees leave the account they are charged to, on top of the move itself.
      for (const fee of tx.fees) if (fee.accountId === accountId) effects.push(-fee.amount);
    } else if (tx.accountId === accountId) {
      // Expenses and asset purchases both take money out of the account.
      effects.push(tx.type === 'income' ? tx.amount : -tx.amount);
    }
  }
  return sumTo(effects, decimalsFor(account.currency));
}

// Balance in the account's own currency.
export function accountBalance(state: Pick<State, 'accounts' | 'transactions'>, accountId: string): number {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return 0;
  return roundIn(account.openingBalance + accountNetFlow(state, accountId), account.currency);
}

// The openingBalance that makes the derived balance equal `currentBalance`.
export function openingBalanceForCurrentBalance(
  state: Pick<State, 'accounts' | 'transactions'>,
  accountId: string,
  currentBalance: number
): number {
  const currency = state.accounts.find((a) => a.id === accountId)?.currency ?? 'EGP';
  return roundIn(currentBalance - accountNetFlow(state, accountId), currency);
}

// A current amount in `from` valued in `to` at today's rates, rounded to `to`'s decimals (INV-7: every
// item is rounded before it is summed). The same currency comes back untouched.
const valueNow = (state: Pick<State, 'settings'>, amount: number, from: CurrencyCode, to: CurrencyCode): number =>
  roundIn(convertCurrency(amount, from, to, state.settings.rates), to);

// The currency totals are shown in unless a screen asks for another: a projection, never a stored amount.
export const reportingCurrency = (state: Pick<State, 'settings'>): CurrencyCode => state.settings.reportingCurrency;

export function accountValue(state: LiquidState, account: Account, to: CurrencyCode = reportingCurrency(state)): number {
  return valueNow(state, accountBalance(state, account.id), account.currency, to);
}

// Archived accounts still hold money, so they count.
export function liquidTotal(state: LiquidState, to: CurrencyCode = reportingCurrency(state)): number {
  return sumIn(state.accounts.map((a) => accountValue(state, a, to)), to);
}

// --- Holdings ---------------------------------------------------------------

// EGP per gram for a karat: 24k and 21k have their own market prices; 18k derives from 24k.
export function goldPricePerGram(settings: State['settings'], karat: GoldKarat): number {
  if (karat === 24) return settings.goldPrice24kEGP;
  if (karat === 21) return settings.goldPrice21kEGP;
  return settings.goldPrice24kEGP * 0.75;
}

// Gold is priced in EGP (the market input), so its value is converted from there.
export function holdingValue(state: Pick<State, 'settings'>, holding: Holding, to: CurrencyCode = reportingCurrency(state)): number {
  if (holding.type === 'gold') {
    return valueNow(state, holding.weightGrams * goldPricePerGram(state.settings, holding.karat), 'EGP', to);
  }
  return valueNow(state, holding.quantity, holding.currency, to);
}

// What the holding cost, in `to` at the rates of its purchase (the cost itself is native).
export function holdingCost(
  state: Pick<State, 'rateSnapshots' | 'settings'>,
  holding: Holding,
  to: CurrencyCode = reportingCurrency(state)
): number {
  const { amount, currency } = holding.purchaseCost;
  return roundIn(projectAmount(state.rateSnapshots, holding.purchaseRateSnapshotId, amount, currency, to), to);
}

export function holdingPnl(state: State, holding: Holding, to: CurrencyCode = reportingCurrency(state)): number {
  return roundIn(holdingValue(state, holding, to) - holdingCost(state, holding, to), to);
}

export function holdingsTotal(state: State, to: CurrencyCode = reportingCurrency(state)): number {
  return sumIn(state.holdings.map((h) => holdingValue(state, h, to)), to);
}

export function totalAssets(state: State, to: CurrencyCode = reportingCurrency(state)): number {
  return sumIn([liquidTotal(state, to), holdingsTotal(state, to)], to);
}

// --- Liabilities ------------------------------------------------------------

// In the liability's currency. Payments are expense transactions tagged with liabilityId
// (the store enforces they share the liability's currency).
export function liabilityRemaining(state: State, liability: Liability): number {
  const paid = sumIn(
    state.transactions
      .filter(isIncomeExpense)
      .filter((tx) => tx.type === 'expense' && tx.liabilityId === liability.id)
      .map((tx) => tx.amount),
    liability.currency
  );
  return roundIn(Math.max(0, liability.principal - paid), liability.currency);
}

const liabilityValue = (state: State, liability: Liability, to: CurrencyCode): number =>
  valueNow(state, liabilityRemaining(state, liability), liability.currency, to);

export function liabilitiesTotal(state: State, to: CurrencyCode = reportingCurrency(state)): number {
  return sumIn(state.liabilities.map((l) => liabilityValue(state, l, to)), to);
}

export function netWorth(state: State, to: CurrencyCode = reportingCurrency(state)): number {
  return sumIn([liquidTotal(state, to), holdingsTotal(state, to), -liabilitiesTotal(state, to)], to);
}

const emptyBreakdown = (): CountryBreakdown => ({ cash: 0, gold: 0, currencies: 0, liabilities: 0 });

// Every country in the registry plus any other country the data uses (registry order first), so lists
// show the same rows whether or not a country has money in it right now.
export function countriesInUse(
  state: Pick<State, 'accounts' | 'holdings' | 'liabilities'>,
  registry: CountryRegistry = COUNTRY_REGISTRY
): CountryCode[] {
  const used = [...state.accounts, ...state.holdings, ...state.liabilities].map((e) => e.country);
  return [...new Set([...countryCodes(registry), ...used])];
}

// Cash, gold, currency holdings and liabilities per country, in `to` at current rates.
export function netWorthBreakdown(state: State, to: CurrencyCode = reportingCurrency(state)): Record<CountryCode, CountryBreakdown> {
  const result: Record<CountryCode, CountryBreakdown> = {};
  for (const country of countriesInUse(state)) result[country] = emptyBreakdown();
  for (const account of state.accounts) {
    const where = result[account.country];
    where.cash = addIn(where.cash, accountValue(state, account, to), to);
  }
  for (const holding of state.holdings) {
    const where = result[holding.country];
    const value = holdingValue(state, holding, to);
    if (holding.type === 'gold') where.gold = addIn(where.gold, value, to);
    else where.currencies = addIn(where.currencies, value, to);
  }
  for (const liability of state.liabilities) {
    const where = result[liability.country];
    where.liabilities = addIn(where.liabilities, liabilityValue(state, liability, to), to);
  }
  return result;
}

// The stored shape of a breakdown (EGP, as net worth snapshots keep it).
export const toStoredBreakdown = (b: Record<CountryCode, CountryBreakdown>): NetWorthBreakdown =>
  Object.fromEntries(
    Object.entries(b).map(([country, p]) => [
      country,
      { cashEGP: p.cash, goldEGP: p.gold, currenciesEGP: p.currencies, liabilitiesEGP: p.liabilities },
    ])
  );

// The figures of a moment in `to`. A stored net worth snapshot keeps them in EGP (its fields are named for
// it); screens show them in the reporting currency.
export interface NetWorthFigures {
  netWorth: number;
  liquid: number;
  holdings: number;
  breakdown: Record<CountryCode, CountryBreakdown>;
}

export function netWorthFigures(state: State, to: CurrencyCode = reportingCurrency(state)): NetWorthFigures {
  return {
    netWorth: netWorth(state, to),
    liquid: liquidTotal(state, to),
    holdings: holdingsTotal(state, to),
    breakdown: netWorthBreakdown(state, to),
  };
}

// Best-effort net worth at the end of `date` ('YYYY-MM-DD'), at CURRENT rates and prices (there
// is no price history): transactions dated after it are left out, as are accounts opened,
// holdings bought and liabilities started after it. Missing dates count as "always there".
export function netWorthAsOf(state: State, date: string, to: CurrencyCode = reportingCurrency(state)): NetWorthFigures {
  const onOrBefore = (d: string | undefined) => !d || d.slice(0, 10) <= date;
  const past: State = {
    ...state,
    accounts: state.accounts.filter((a) => onOrBefore(a.openingDate)),
    transactions: state.transactions.filter((tx) => onOrBefore(tx.date)),
    holdings: state.holdings.filter((h) => onOrBefore(h.purchaseDate)),
    liabilities: state.liabilities.filter((l) => onOrBefore(l.startDate)),
  };
  return netWorthFigures(past, to);
}

// Net worth split by country (a liability is subtracted from the country it is owed in), so the
// countries always add up to netWorth.
export function netWorthByCountry(state: State, to: CurrencyCode = reportingCurrency(state)): Record<CountryCode, number> {
  const result: Record<CountryCode, number> = {};
  for (const [country, b] of Object.entries(netWorthBreakdown(state, to))) {
    result[country] = sumIn([b.cash, b.gold, b.currencies, -b.liabilities], to);
  }
  return result;
}

// Account balances summed per currency, in that currency (no conversion).
export function liquidByCurrency(state: LiquidByCurrencyState): Record<CurrencyCode, number> {
  const result = zeroByCurrency(state);
  for (const account of state.accounts) {
    result[account.currency] = addIn(result[account.currency], accountBalance(state, account.id), account.currency);
  }
  return result;
}

export interface GoldTotals {
  totalGrams: number;
  gramsByKarat: Record<GoldKarat, number>;
  totalCost: number;
}

export function goldTotals(state: Pick<State, 'holdings' | 'rateSnapshots' | 'settings'>, to: CurrencyCode = reportingCurrency(state)): GoldTotals {
  const totals: GoldTotals = { totalGrams: 0, gramsByKarat: { 18: 0, 21: 0, 24: 0 }, totalCost: 0 };
  for (const h of state.holdings) {
    if (h.type !== 'gold') continue;
    totals.totalGrams += h.weightGrams;
    totals.gramsByKarat[h.karat] += h.weightGrams;
    totals.totalCost = addIn(totals.totalCost, holdingCost(state, h, to), to);
  }
  return totals;
}

// --- Funds ------------------------------------------------------------------

function findFund(state: State, fundId: string): Fund | undefined {
  return state.funds.find((f) => f.id === fundId);
}

type CurrencyListState = Pick<State, 'settings' | 'accounts' | 'funds' | 'holdings' | 'unresolvedMovements'>;

// Every currency the data uses: the enabled ones first (settings order), then any other currency an
// account, fund, currency holding or unresolved migrated movement is in. What per-currency lists and loops run over.
export function currencyList(state: CurrencyListState): CurrencyCode[] {
  return [
    ...new Set<CurrencyCode>([
      ...state.settings.enabledCurrencies,
      ...state.accounts.map((a) => a.currency),
      ...state.funds.map((f) => f.currency),
      ...state.holdings.flatMap((h) => (h.type === 'currency' ? [h.currency] : [])),
      ...state.unresolvedMovements.map((m) => m.currency),
    ]),
  ];
}

const zeroByCurrency = (state: CurrencyListState): Record<CurrencyCode, number> =>
  Object.fromEntries(currencyList(state).map((c) => [c, 0]));
// Float noise isn't money.
const MONEY_EPSILON = 0.005;

// --- Reservations -----------------------------------------------------------

// Everything that counts toward a fund's cash, in one shape: a reservation (money of an account, in the
// account's currency) or a movement the v7 migration could not assign to one account (`unresolved`, in its own
// currency). `kind` of an unresolved one is 'adjust' (what the migrated movements are).
export interface FundMovementRow {
  id: string;
  fundId: string;
  // Signed, in `currency`.
  amount: number;
  currency: CurrencyCode;
  kind: ReservationKind;
  date: string;
  note?: string;
  rateSnapshotId: string;
  accountId?: string;
  unresolved?: boolean;
}

type MovementRowState = Pick<State, 'accounts' | 'reservationMovements' | 'unresolvedMovements'>;

export function fundMovementRows(state: MovementRowState): FundMovementRow[] {
  const currencyOf = new Map(state.accounts.map((a) => [a.id, a.currency]));
  const rows: FundMovementRow[] = [];
  for (const m of state.reservationMovements) {
    const currency = currencyOf.get(m.accountId);
    // A reservation on an account that is gone has nothing to be valued in.
    if (!currency) continue;
    rows.push({
      id: m.id,
      fundId: m.fundId,
      amount: m.amount,
      currency,
      kind: m.kind,
      date: m.date,
      ...(m.note ? { note: m.note } : {}),
      rateSnapshotId: m.rateSnapshotId,
      accountId: m.accountId,
    });
  }
  for (const m of state.unresolvedMovements) {
    rows.push({
      id: m.id,
      fundId: m.fundId,
      amount: m.amount,
      currency: m.currency,
      kind: 'adjust',
      date: m.date,
      ...(m.note ? { note: m.note } : {}),
      rateSnapshotId: m.rateSnapshotId,
      unresolved: true,
    });
  }
  return rows;
}

// Whether a movement adds to or takes from what is saved. Moving a reservation between funds or accounts
// (reallocate, a transfer or exchange carrying it) saves nothing new.
export const countsAsSaving = (kind: ReservationKind): boolean =>
  kind !== 'reallocate' && kind !== 'follow_transfer' && kind !== 'follow_exchange';

// What fund `fundId` has reserved on `accountId`, in the account's currency.
export function reservation(state: Pick<State, 'reservationMovements' | 'accounts'>, fundId: string, accountId: string): number {
  const currency = state.accounts.find((a) => a.id === accountId)?.currency;
  if (!currency) return 0;
  return roundIn(
    sumIn(
      state.reservationMovements.filter((m) => m.fundId === fundId && m.accountId === accountId).map((m) => m.amount),
      currency
    ),
    currency
  );
}

// Everything reserved on the account, across funds.
export function accountReserved(state: Pick<State, 'reservationMovements' | 'accounts'>, accountId: string): number {
  const currency = state.accounts.find((a) => a.id === accountId)?.currency;
  if (!currency) return 0;
  const perFund = new Map<string, number[]>();
  for (const m of state.reservationMovements) {
    if (m.accountId === accountId) perFund.set(m.fundId, [...(perFund.get(m.fundId) ?? []), m.amount]);
  }
  return sumIn([...perFund.values()].map((amounts) => sumIn(amounts, currency)), currency);
}

// What is not set aside for a fund: balance − reserved (INV-5 keeps it from going below 0).
export function accountAvailable(
  state: Pick<State, 'reservationMovements' | 'accounts' | 'transactions'>,
  accountId: string
): number {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return 0;
  return roundIn(accountBalance(state, accountId) - accountReserved(state, accountId), account.currency);
}

// A fund's reservations per account (only the ones holding money), largest first.
export function fundReservationsByAccount(
  state: Pick<State, 'reservationMovements' | 'accounts'>,
  fundId: string
): { accountId: string; currency: CurrencyCode; amount: number }[] {
  return state.accounts
    .map((a) => ({ accountId: a.id, currency: a.currency, amount: reservation(state, fundId, a.id) }))
    .filter((r) => r.amount > MONEY_EPSILON)
    .sort((a, b) => b.amount - a.amount || (a.accountId < b.accountId ? -1 : 1));
}

// Cash set aside for the fund, per currency, each in its own currency: nothing is converted, so 1000 SAR stays
// 1000 SAR whatever the rates do. Includes unresolved migrated movements (they count toward the fund's total);
// `resolvedOnly` leaves them out (what can actually be released).
export function fundCashByCurrency(state: State, fundId: string, resolvedOnly = false): Record<CurrencyCode, number> {
  const result = zeroByCurrency(state);
  if (!findFund(state, fundId)) return result;
  for (const m of fundMovementRows(state)) {
    if (m.fundId !== fundId || (resolvedOnly && m.unresolved)) continue;
    result[m.currency] = addIn(result[m.currency], m.amount, m.currency);
  }
  return result;
}

export function fundAllocatedIn(state: State, fundId: string, currency: CurrencyCode): number {
  return fundCashByCurrency(state, fundId)[currency];
}

// The part of the fund's cash that is a real reservation on an account (what can be released).
export function fundReservedIn(state: State, fundId: string, currency: CurrencyCode): number {
  return fundCashByCurrency(state, fundId, true)[currency];
}

// Cash allocated to the fund, in the fund's currency: each currency's cash at TODAY's rate.
// (A fund that only holds its own currency, like every fund saved before currencies, is just
// the sum of its movements.)
export function fundAllocated(state: State, fundId: string): number {
  const fund = findFund(state, fundId);
  if (!fund) return 0;
  const cash = fundCashByCurrency(state, fundId);
  return sumIn(
    currencyList(state).map((c) => roundIn(convertCurrency(cash[c], c, fund.currency, state.settings.rates), fund.currency)),
    fund.currency
  );
}

// Market value of the fund's linked holdings, in the fund's currency: a currency holding is its
// quantity (no round trip through EGP when it is the fund's own currency), gold is its EGP
// market value converted.
export function fundLinkedValue(state: State, fundId: string): number {
  const fund = findFund(state, fundId);
  if (!fund) return 0;
  const rates = state.settings.rates;
  return sumIn(
    state.holdings
      .filter((h) => fund.linkedHoldingIds.includes(h.id))
      .map((h) =>
        roundIn(
          h.type === 'currency'
            ? convertCurrency(h.quantity, h.currency, fund.currency, rates)
            : fromEGP(holdingValue(state, h, 'EGP'), fund.currency, rates),
          fund.currency
        )
      ),
    fund.currency
  );
}

// Fund currency: cash movements + market value of linked holdings.
export function fundCurrent(state: State, fundId: string): number {
  const fund = findFund(state, fundId);
  return roundIn(fundAllocated(state, fundId) + fundLinkedValue(state, fundId), fund?.currency ?? 'EGP');
}

// 0..∞ (can exceed 1 when over-funded). A non-positive target counts as complete.
export function fundProgress(state: State, fundId: string): number {
  const fund = findFund(state, fundId);
  if (!fund) return 0;
  if (fund.targetAmount <= 0) return 1;
  return Math.max(0, fundCurrent(state, fundId) / fund.targetAmount);
}

// A fund movement in `currency` as it was worth when made (for history: plan progress, the
// monthly review, month totals): its own currency is returned unchanged, otherwise converted
// with its own rate snapshot.
export function movementAmountIn(
  state: Pick<State, 'rateSnapshots'>,
  movement: Pick<FundMovementRow, 'amount' | 'currency' | 'rateSnapshotId'>,
  currency: CurrencyCode
): number {
  return roundIn(projectAmount(state.rateSnapshots, movement.rateSnapshotId, movement.amount, movement.currency, currency), currency);
}

// A movement's CURRENT value in its fund's currency (today's rate): what it adds to
// fundAllocated.
export function movementValueInFund(state: State, movement: Pick<FundMovementRow, 'fundId' | 'amount' | 'currency'>): number {
  const fund = findFund(state, movement.fundId);
  if (!fund) return 0;
  return roundIn(convertCurrency(movement.amount, movement.currency, fund.currency, state.settings.rates), fund.currency);
}

// When the target must be reached: the deadline for goals, the next due date for sinking funds.
export function fundDueDate(fund: Fund): string | undefined {
  return fund.type === 'sinking' ? fund.nextDueDate : fund.deadline;
}

export const SINKING_CYCLE_MONTHS: Record<SinkingFrequency, number> = {
  yearly: 12,
  semiannual: 6,
  quarterly: 3,
};

// Fund currency per month to hit the target by the due date; null without one.
export function fundRequiredMonthly(state: State, fundId: string, now: Date = new Date()): number | null {
  const fund = findFund(state, fundId);
  const due = fund && fundDueDate(fund);
  if (!fund || !due) return null;
  const remaining = Math.max(0, fund.targetAmount - fundCurrent(state, fundId));
  return remaining / monthsUntil(due, now);
}

// Sinking funds: the full cycle amount spread over the months until it is due (ignores what
// is already saved, unlike fundRequiredMonthly). null for other funds or without a schedule.
export function sinkingMonthlySuggestion(
  fund: Pick<Fund, 'type' | 'targetAmount' | 'nextDueDate'>,
  now: Date = new Date()
): number | null {
  if (fund.type !== 'sinking' || !fund.nextDueDate) return null;
  return fund.targetAmount / monthsUntil(fund.nextDueDate, now);
}

export type FundStatus = 'ahead' | 'on_track' | 'pending' | 'behind' | 'no_deadline';

// The last this-many days of a month (today included) turn a shortfall from pending to behind.
export const BEHIND_DAYS_LEFT = 7;

// Compares this month's net allocations with what was required at the START of the month
// (so allocating this month doesn't shrink its own requirement).
// ahead: > 110% or target already reached · on_track: required…110% ·
// below required: pending while more than 7 days are left in the month (today counts) or when
// the fund was created this month, behind otherwise.
export function fundStatus(state: State, fundId: string, now: Date = new Date()): FundStatus {
  const fund = findFund(state, fundId);
  const pace = monthPace(state, fundId, now);
  if (!fund || !pace) return 'no_deadline';
  const { required, allocatedThisMonth } = pace;
  const month = toMonthKey(now);

  if (required <= 0) return 'ahead';
  if (allocatedThisMonth < required) {
    const createdThisMonth = toMonthKey(new Date(fund.createdAt)) === month;
    return createdThisMonth || daysLeftInMonth(month, now) > BEHIND_DAYS_LEFT ? 'pending' : 'behind';
  }
  return allocatedThisMonth > required * 1.1 ? 'ahead' : 'on_track';
}

interface MonthPace {
  // Fund currency: what this month needed at its start, and what was allocated so far.
  required: number;
  allocatedThisMonth: number;
}

function monthPace(state: State, fundId: string, now: Date): MonthPace | null {
  const fund = findFund(state, fundId);
  const due = fund && fundDueDate(fund);
  if (!fund || !due) return null;
  const month = toMonthKey(now);
  const allocatedThisMonth = sumIn(
    fundMovementRows(state)
      .filter((m) => m.fundId === fundId && monthOf(m.date) === month && countsAsSaving(m.kind))
      .map((m) => movementValueInFund(state, m)),
    fund.currency
  );
  const currentAtMonthStart = fundCurrent(state, fundId) - allocatedThisMonth;
  const remainingAtMonthStart = Math.max(0, fund.targetAmount - currentAtMonthStart);
  return { required: remainingAtMonthStart / monthsUntil(due, now), allocatedThisMonth };
}

// Fund currency still missing from this month's required amount (what fundStatus measures);
// 0 when on track or without a due date.
export function fundMonthShortfall(state: State, fundId: string, now: Date = new Date()): number {
  const pace = monthPace(state, fundId, now);
  return pace ? Math.max(0, pace.required - pace.allocatedThisMonth) : 0;
}

// Active funds, highest priority (lowest number) first.
export function fundsByPriority(state: Pick<State, 'funds'>): Fund[] {
  return state.funds.filter((f) => !f.archived).sort((a, b) => a.priority - b.priority);
}

// Gold/currency holdings that `fundId` may link: unlinked ones plus its own.
export function linkableHoldings(state: State, fundId?: string): Holding[] {
  return state.holdings.filter(
    (h) => !state.funds.some((f) => f.id !== fundId && f.linkedHoldingIds.includes(h.id))
  );
}

// --- Money without a job ------------------------------------------------------

export interface CurrencyAmount {
  currency: CurrencyCode;
  // Always positive.
  amount: number;
}

export interface UnassignedSummary {
  // Per currency, each in its own currency: negative = more of that currency is set aside than
  // the accounts hold.
  byCurrency: Record<CurrencyCode, number>;
  // The currencies with money left / with too little, native amounts (> 0.005 only).
  surpluses: CurrencyAmount[];
  deficits: CurrencyAmount[];
  // Migrated movements not yet assigned to an account, per currency (signed net, only non-zero): reserved for a
  // fund but "مش محدد حسابه". Already left out of byCurrency.
  unresolved: { currency: CurrencyCode; amount: number }[];
  // Display only: every currency converted to EGP at today's rate.
  totalEGP: number;
  surplusEGP: number;
  deficitEGP: number;
}

// Migrated movements nobody could assign to one account yet ("محجوز ومش محدد حسابه"), per currency, each in its
// own currency (signed net). They count toward their fund's total and are NOT on any account, so they are their own
// line in the money picture: reserved by accounts + unresolved + unassigned = the cash, per currency.
export function unresolvedByCurrency(state: Pick<State, 'unresolvedMovements'> & CurrencyListState): Record<CurrencyCode, number> {
  const result = zeroByCurrency(state);
  for (const m of state.unresolvedMovements) result[m.currency] = addIn(result[m.currency], m.amount, m.currency);
  return result;
}

// Liquid money not yet reserved for a fund, per currency, each in its own currency (linked holdings are not cash):
// Σ over the accounts of that currency of available (balance − reserved) − what the unresolved migrated movements
// hold in that currency (not counted twice: the fund has it, so it is not free). Nothing is converted, so 1000 SAR
// stays 1000 SAR whatever the rates do, and a SAR reservation never takes EGP money. (The v7 "implicit FX" of
// movements that had no currency is gone.) Negative means more is reserved than the accounts hold (INV-5 prevents
// it; shown, never hidden).
export function unassignedByCurrency(
  state: LiquidByCurrencyState & Pick<State, 'reservationMovements'>
): Record<CurrencyCode, number> {
  const pool = liquidByCurrency(state);
  const reserved = new Map<CurrencyCode, number[]>();
  for (const account of state.accounts) {
    reserved.set(account.currency, [...(reserved.get(account.currency) ?? []), accountReserved(state, account.id)]);
  }
  const unresolved = unresolvedByCurrency(state);
  for (const [currency, amounts] of reserved) pool[currency] = roundIn(pool[currency] - sumIn(amounts, currency), currency);
  for (const currency of Object.keys(pool)) pool[currency] = roundIn(pool[currency] - (unresolved[currency] ?? 0), currency);
  return pool;
}

export function unassignedSummary(state: State): UnassignedSummary {
  const rates = state.settings.rates;
  const byCurrency = unassignedByCurrency(state);
  const unresolved = unresolvedByCurrency(state);
  const summary: UnassignedSummary = {
    byCurrency,
    surpluses: [],
    deficits: [],
    unresolved: currencyList(state).flatMap((currency) => (Math.abs(unresolved[currency]) > MONEY_EPSILON ? [{ currency, amount: unresolved[currency] }] : [])),
    totalEGP: 0,
    surplusEGP: 0,
    deficitEGP: 0,
  };
  for (const currency of currencyList(state)) {
    const amount = byCurrency[currency];
    const egp = roundIn(toEGP(amount, currency, rates), 'EGP');
    summary.totalEGP = addIn(summary.totalEGP, egp, 'EGP');
    if (amount > MONEY_EPSILON) {
      summary.surpluses.push({ currency, amount });
      summary.surplusEGP = addIn(summary.surplusEGP, egp, 'EGP');
    } else if (amount < -MONEY_EPSILON) {
      summary.deficits.push({ currency, amount: -amount });
      summary.deficitEGP = addIn(summary.deficitEGP, -egp, 'EGP');
    }
  }
  return summary;
}

// The total of unassignedByCurrency in EGP at today's rate, for display. Negative means more
// is set aside than the accounts hold.
export function unassignedEGP(state: State): number {
  return unassignedSummary(state).totalEGP;
}

// unassignedEGP if the fund's cash allocation were set to `cashAllocation` (fund currency).
// Used to preview an edit before saving and to validate it.
export function unassignedEGPWithFundCash(
  state: State,
  fundId: string,
  cashAllocation: number
): number {
  const fund = findFund(state, fundId);
  if (!fund) return unassignedEGP(state);
  const change = cashAllocation - fundAllocated(state, fundId);
  return roundIn(unassignedEGP(state) - toEGP(change, fund.currency, state.settings.rates), 'EGP');
}

// --- Distributing and covering ---------------------------------------------

export interface FundAmount {
  fundId: string;
  // In `currency`, or in the fund's currency when `currency` is omitted.
  amount: number;
  currency?: CurrencyCode;
  // The account to reserve on / release from; omitted = chosen by the default rules (largest available / largest
  // reservation), which the sheet shows and lets the user change.
  accountId?: string;
}

// Sum of `amounts` in EGP at current rates (unknown funds count as 0).
export function fundAmountsEGP(state: State, amounts: FundAmount[]): number {
  const rates = state.settings.rates;
  return sumIn(
    amounts.map(({ fundId, amount, currency }) => {
      const fund = findFund(state, fundId);
      return fund ? roundIn(toEGP(amount, currency ?? fund.currency, rates), 'EGP') : 0;
    }),
    'EGP'
  );
}

// A withdrawal of `amount` of `currency` from `fund`; the currency is left out when it is the
// fund's own.
function withdrawalOf(fund: Fund, currency: CurrencyCode, amount: number): FundAmount {
  return { fundId: fund.id, amount, ...(currency !== fund.currency ? { currency } : {}) };
}

// How to take `amount` (in `currency`) out of a fund's cash: the same currency's cash first, then
// the fund's own currency, then the others, converted at today's rate. `shortfall` is what the
// fund's cash could not cover (in `currency`).
export function withdrawalPlan(
  state: State,
  fundId: string,
  amount: number,
  currency: CurrencyCode
): { withdrawals: FundAmount[]; shortfall: number } {
  const fund = findFund(state, fundId);
  if (!fund) return { withdrawals: [], shortfall: amount };
  const rates = state.settings.rates;
  const cash = fundCashByCurrency(state, fundId, true);
  const order = [currency, fund.currency, ...currencyList(state)].filter((c, i, all) => all.indexOf(c) === i);
  const withdrawals: FundAmount[] = [];
  let left = amount;
  for (const c of order) {
    if (left <= MONEY_EPSILON) break;
    const available = Math.max(0, cash[c]);
    const wanted = convertCurrency(left, currency, c, rates);
    const take = Math.min(wanted, available);
    if (take <= MONEY_EPSILON) continue;
    withdrawals.push(withdrawalOf(fund, c, take));
    left = take >= wanted ? 0 : left - convertCurrency(take, c, currency, rates);
  }
  return { withdrawals, shortfall: left <= MONEY_EPSILON ? 0 : left };
}

// How much a fund should get this month (fund currency): its required monthly amount if it
// has a due date, else its planned monthly contribution, never more than what's left to
// reach the target.
export function fundSuggestedMonthly(state: State, fundId: string, now: Date = new Date()): number {
  const fund = findFund(state, fundId);
  if (!fund) return 0;
  const remaining = Math.max(0, fund.targetAmount - fundCurrent(state, fundId));
  const monthly = fundRequiredMonthly(state, fundId, now) ?? fund.monthlyContribution ?? 0;
  return Math.min(monthly, remaining);
}

// Splits `amountEGP` across funds in priority order, each capped by its suggested monthly
// amount, until the money runs out. Funds that would get nothing are omitted. Amounts are in
// each fund's currency.
export function suggestAllocation(state: State, amountEGP: number, now: Date = new Date()): FundAmount[] {
  const rates = state.settings.rates;
  let leftEGP = Math.max(0, amountEGP);
  const result: FundAmount[] = [];
  for (const fund of fundsByPriority(state)) {
    if (leftEGP <= 0.005) break;
    const wantEGP = toEGP(fundSuggestedMonthly(state, fund.id, now), fund.currency, rates);
    const giveEGP = Math.min(wantEGP, leftEGP);
    if (giveEGP <= 0.005) continue;
    result.push({ fundId: fund.id, amount: roundIn(fromEGP(giveEGP, fund.currency, rates), fund.currency) });
    leftEGP -= giveEGP;
  }
  return result;
}

// The same split for money in one currency: `amount` of `currency` across the funds, in that
// currency (each fund's suggestion converted at today's rate). Every entry carries `currency`.
export function suggestAllocationIn(
  state: State,
  currency: CurrencyCode,
  amount: number,
  now: Date = new Date()
): FundAmount[] {
  const rates = state.settings.rates;
  let left = Math.max(0, amount);
  const result: FundAmount[] = [];
  for (const fund of fundsByPriority(state)) {
    if (left <= MONEY_EPSILON) break;
    const want = convertCurrency(fundSuggestedMonthly(state, fund.id, now), fund.currency, currency, rates);
    const give = Math.min(want, left);
    if (give <= MONEY_EPSILON) continue;
    result.push({ fundId: fund.id, amount: roundIn(give, currency), currency });
    left -= give;
  }
  return result;
}

export interface CoverPlan {
  withdrawals: FundAmount[];
  // EGP still uncovered after the withdrawals (0 when fully covered).
  remainingEGP: number;
}

// Withdraws cash from the chosen funds, lowest priority first, until each short currency's
// unassigned money is back to zero. A currency is covered by funds' cash in that same currency
// (the shortfall is in that currency's money). `only` limits it to one currency. Funds without
// cash in the currency are skipped.
export function planCover(state: State, fundIds: string[], only?: CurrencyCode): CoverPlan {
  const rates = state.settings.rates;
  const unassigned = unassignedByCurrency(state);
  const chosen = state.funds
    .filter((f) => fundIds.includes(f.id))
    .sort((a, b) => b.priority - a.priority);
  const withdrawals: FundAmount[] = [];
  let remainingEGP = 0;
  for (const currency of currencyList(state)) {
    if (only && currency !== only) continue;
    let deficit = Math.max(0, -unassigned[currency]);
    for (const fund of chosen) {
      if (deficit <= MONEY_EPSILON) break;
      const cash = fundReservedIn(state, fund.id, currency);
      const take = Math.min(cash, deficit);
      if (take <= MONEY_EPSILON) continue;
      // Round up to the cent so the cover never falls a fraction short.
      withdrawals.push(withdrawalOf(fund, currency, Math.min(cash, Math.ceil(take * 100) / 100)));
      deficit -= take;
    }
    remainingEGP = addIn(remainingEGP, roundIn(toEGP(Math.max(0, deficit), currency, rates), 'EGP'), 'EGP');
  }
  return { withdrawals, remainingEGP };
}

// Default cover choice: the lowest-priority fund that holds cash (in `currency`, when given).
export function defaultCoverFundId(state: State, currency?: CurrencyCode): string | undefined {
  return [...fundsByPriority(state)]
    .reverse()
    .find((f) => (currency ? fundReservedIn(state, f.id, currency) : fundAllocated(state, f.id)) > 0)?.id;
}
// --- Transaction lists ------------------------------------------------------

// The "تحويل" filter covers transfers and exchanges alike.
export type TransactionFilter = 'all' | Exclude<Transaction['type'], 'exchange'>;

export const matchesFilter = (tx: Transaction, filter: TransactionFilter): boolean =>
  filter === 'all' || tx.type === filter || (filter === 'transfer' && tx.type === 'exchange');

// Newest first: by date, then by creation time within the same day.
export function compareNewestFirst(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export function recentTransactions(state: Pick<State, 'transactions'>, count: number): Transaction[] {
  return [...state.transactions].sort(compareNewestFirst).slice(0, count);
}

export function transactionsForMonth(
  state: Pick<State, 'transactions'>,
  month: string,
  filter: TransactionFilter = 'all'
): Transaction[] {
  return state.transactions
    .filter((tx) => monthOf(tx.date) === month && matchesFilter(tx, filter))
    .sort(compareNewestFirst);
}

// A recorded transaction's amount in `currency` as it was worth when recorded: unchanged in its
// own currency; otherwise converted with the transaction's own rate snapshot.
export function transactionAmountIn(
  state: Pick<State, 'rateSnapshots'>,
  tx: Pick<IncomeExpenseTransaction, 'amount' | 'currency' | 'rateSnapshotId'>,
  currency: CurrencyCode
): number {
  return roundIn(projectAmount(state.rateSnapshots, tx.rateSnapshotId, tx.amount, tx.currency, currency), currency);
}

// Signed effect on net cash flow, in `to` at the transaction's own rates; the move itself of a transfer or
// exchange and asset purchases (money changing form, not leaving) are neutral, but their fees are spending.
export function transactionNet(
  state: Pick<State, 'rateSnapshots' | 'settings' | 'accounts'>,
  tx: Transaction,
  to: CurrencyCode = reportingCurrency(state)
): number {
  if (tx.type === 'transfer' || tx.type === 'exchange') {
    return -sumIn(
      feeExpenses({ transactions: [tx], accounts: state.accounts, categories: [] }).map((fee) => transactionAmountIn(state, fee, to)),
      to
    );
  }
  if (!isIncomeExpense(tx)) return 0;
  const amount = transactionAmountIn(state, tx, to);
  return tx.type === 'income' ? amount : -amount;
}

export interface DayGroup {
  date: string;
  // In the currency asked for.
  net: number;
  transactions: Transaction[];
}

// Groups by calendar day, newest day first and newest transaction first within a day.
export function groupTransactionsByDay(
  state: Pick<State, 'rateSnapshots' | 'settings' | 'accounts'>,
  transactions: Transaction[],
  to: CurrencyCode = reportingCurrency(state)
): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const tx of [...transactions].sort(compareNewestFirst)) {
    const day = tx.date.slice(0, 10);
    const group = groups.get(day) ?? { date: day, net: 0, transactions: [] };
    group.net += transactionNet(state, tx, to);
    group.transactions.push(tx);
    groups.set(day, group);
  }
  return [...groups.values()];
}

// --- Monthly cash flow ------------------------------------------------------

// Amounts are in the currency asked for (the reporting currency by default), each transaction at its own rates.
export interface MonthSummary {
  income: number;
  expense: number;
  expenseByBucket: Record<ExpenseBucket, number>;
  netCashFlow: number;
  // net / income; null when there is no income.
  savingsRate: number | null;
}

export interface MonthSummaryOptions {
  // The currency of the amounts; the reporting currency when omitted.
  to?: CurrencyCode;
  // Leave out one-time expenses (used for averages such as the emergency target).
  excludeOneTime?: boolean;
}

// Income and expenses only: transfers move money between own accounts and asset purchases
// turn cash into holdings, so neither counts. Transactions before trackingStartDate are ignored.
export function monthSummary(state: State, month: string, options: MonthSummaryOptions = {}): MonthSummary {
  const to = options.to ?? reportingCurrency(state);
  const categoryBucket = new Map(state.categories.map((c) => [c.id, c.bucket]));
  const summary: MonthSummary = {
    income: 0,
    expense: 0,
    expenseByBucket: { essentials: 0, lifestyle: 0, giving: 0 },
    netCashFlow: 0,
    savingsRate: null,
  };

  for (const tx of incomeExpenseRows(state)) {
    if (monthOf(tx.date) !== month || tx.date < state.settings.trackingStartDate) continue;
    if (options.excludeOneTime && tx.oneTime) continue;
    const amount = transactionAmountIn(state, tx, to);
    if (tx.type === 'income') {
      summary.income = addIn(summary.income, amount, to);
    } else {
      summary.expense = addIn(summary.expense, amount, to);
      const bucket = categoryBucket.get(tx.categoryId);
      if (bucket && bucket !== 'income') summary.expenseByBucket[bucket] = addIn(summary.expenseByBucket[bucket], amount, to);
    }
  }

  summary.netCashFlow = roundIn(summary.income - summary.expense, to);
  summary.savingsRate = summary.income > 0 ? summary.netCashFlow / summary.income : null;
  return summary;
}

export interface MonthFlows {
  income: number;
  expense: number;
  // Net fund movements of the month (allocations minus withdrawals), each at its own rates.
  savedToFunds: number;
  // Asset purchases (cash turned into holdings), at their snapshot rates.
  invested: number;
}

// Where the month's money went: monthSummary's income and expenses plus what was put into funds
// and invested. Like monthSummary, ignores dates before trackingStartDate.
export function monthFlows(state: State, month: string, to: CurrencyCode = reportingCurrency(state)): MonthFlows {
  const { income, expense } = monthSummary(state, month, { to });
  const start = state.settings.trackingStartDate;
  const inMonth = (date: string) => monthOf(date) === month && date >= start;
  return {
    income,
    expense,
    savedToFunds: sumIn(
      fundMovementRows(state)
        .filter((m) => inMonth(m.date) && countsAsSaving(m.kind))
        .map((m) => movementAmountIn(state, m, to)),
      to
    ),
    invested: sumIn(
      state.transactions
        .filter((tx): tx is AssetPurchaseTransaction => tx.type === 'asset_purchase' && inMonth(tx.date))
        .map((tx) => transactionAmountIn(state, tx, to)),
      to
    ),
  };
}

// Average monthly essentials (one-time expenses excluded) over the 3 full months before
// `now`, times `months`. Only
// months with recorded essentials count toward the average; null when none of the three
// has any (not enough history to suggest a number).
export function suggestedEmergencyTarget(
  state: State,
  months: 3 | 6,
  now: Date = new Date()
): number | null {
  const current = toMonthKey(now);
  const lastThree = [1, 2, 3].map((n) => shiftMonth(current, -n));
  const recorded = lastThree
    .map((m) => monthSummary(state, m, { excludeOneTime: true, to: 'EGP' }).expenseByBucket.essentials)
    .filter((essentials) => essentials > 0);
  if (recorded.length === 0) return null;
  return roundIn((sumIn(recorded, 'EGP') / recorded.length) * months, 'EGP');
}

// --- Diagnostics ------------------------------------------------------------

export function stateSummary(state: State) {
  return {
    accounts: state.accounts.length,
    holdings: state.holdings.length,
    funds: state.funds.length,
    netWorthEGP: Math.round(netWorth(state, 'EGP') * 100) / 100,
    unassignedEGP: Math.round(unassignedEGP(state) * 100) / 100,
  };
}

// --- Categories -------------------------------------------------------------

// Categories offered in pickers: active ones of `kind`, plus `keepIds` (e.g. the archived
// category of a transaction being edited, so it stays selectable). Reports never filter.
export function pickerCategories(
  categories: Category[],
  kind: Category['kind'],
  keepIds: (string | undefined)[] = []
): Category[] {
  return categories.filter((c) => c.kind === kind && (!c.archived || keepIds.includes(c.id)));
}
