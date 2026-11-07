import { COUNTRY_REGISTRY, countryCodes, type CountryRegistry } from '@/constants/countries';
import { convertCurrency, fromEGP, projectAmount, toEGP } from '@/utils/currency';
import { addIn, decimalsFor, roundIn, sumIn, sumTo } from '@/utils/money';
import { monthOf, monthsUntil, shiftMonth, toMonthKey } from '@/utils/dates';
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
  FundMovement,
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

// --- Accounts ---------------------------------------------------------------

type LiquidState = Pick<State, 'accounts' | 'transactions' | 'settings'>;
// What per-currency liquid money needs: every currency the data uses, not just the accounts'.
type LiquidByCurrencyState = LiquidState & Pick<State, 'funds' | 'holdings' | 'fundMovements'>;

// Net effect of all transactions on the account, in its own currency. Added in integer minor units, so
// a thousand 0.01s are exactly 10.00.
export function accountNetFlow(state: Pick<State, 'accounts' | 'transactions'>, accountId: string): number {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return 0;
  const effects: number[] = [];
  for (const tx of state.transactions) {
    if (tx.type === 'transfer') {
      if (tx.fromAccountId === accountId) effects.push(-tx.amount);
      if (tx.toAccountId === accountId) effects.push(tx.toAmount);
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

type CurrencyListState = Pick<State, 'settings' | 'accounts' | 'funds' | 'holdings' | 'fundMovements'>;

// Every currency the data uses: the enabled ones first (settings order), then any other currency an
// account, fund, currency holding or fund movement is in. What per-currency lists and loops run over.
export function currencyList(state: CurrencyListState): CurrencyCode[] {
  return [
    ...new Set<CurrencyCode>([
      ...state.settings.enabledCurrencies,
      ...state.accounts.map((a) => a.currency),
      ...state.funds.map((f) => f.currency),
      ...state.holdings.flatMap((h) => (h.type === 'currency' ? [h.currency] : [])),
      ...state.fundMovements.flatMap((m) => (m.currency ? [m.currency] : [])),
    ]),
  ];
}

const zeroByCurrency = (state: CurrencyListState): Record<CurrencyCode, number> =>
  Object.fromEntries(currencyList(state).map((c) => [c, 0]));
// Float noise isn't money.
const MONEY_EPSILON = 0.005;

// The currency a movement's amount is in: its own, else its fund's (undefined when the fund is
// gone, which is also why such movements are ignored everywhere).
export function movementCurrency(
  state: Pick<State, 'funds'>,
  movement: Pick<FundMovement, 'fundId' | 'currency'>
): CurrencyCode | undefined {
  return movement.currency ?? state.funds.find((f) => f.id === movement.fundId)?.currency;
}

// Cash set aside for the fund, per currency, each in its own currency: nothing is converted, so
// 1000 SAR stays 1000 SAR whatever the rates do.
export function fundCashByCurrency(state: State, fundId: string): Record<CurrencyCode, number> {
  const result = zeroByCurrency(state);
  const fund = findFund(state, fundId);
  if (!fund) return result;
  for (const m of state.fundMovements) {
    if (m.fundId !== fundId) continue;
    const currency = m.currency ?? fund.currency;
    result[currency] = addIn(result[currency], m.amount, currency);
  }
  return result;
}

export function fundAllocatedIn(state: State, fundId: string, currency: CurrencyCode): number {
  return fundCashByCurrency(state, fundId)[currency];
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
  state: Pick<State, 'funds' | 'rateSnapshots'>,
  movement: Pick<FundMovement, 'fundId' | 'amount' | 'currency' | 'rateSnapshotId'>,
  currency: CurrencyCode
): number {
  const from = movementCurrency(state, movement);
  if (!from) return 0;
  return roundIn(projectAmount(state.rateSnapshots, movement.rateSnapshotId, movement.amount, from, currency), currency);
}

// A movement's CURRENT value in its fund's currency (today's rate): what it adds to
// fundAllocated.
export function movementValueInFund(
  state: State,
  movement: Pick<FundMovement, 'fundId' | 'amount' | 'currency'>
): number {
  const fund = findFund(state, movement.fundId);
  if (!fund) return 0;
  return roundIn(
    convertCurrency(movement.amount, movement.currency ?? fund.currency, fund.currency, state.settings.rates),
    fund.currency
  );
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
    state.fundMovements
      .filter((m) => m.fundId === fundId && monthOf(m.date) === month)
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
  // Display only: every currency converted to EGP at today's rate.
  totalEGP: number;
  surplusEGP: number;
  deficitEGP: number;
}

// Liquid money not yet set aside by any fund, per currency (linked holdings are not cash).
// Account balances are summed in their own currency and a movement takes its own currency's
// money, so nothing is converted until display: 1000 SAR stays 1000 SAR whatever the rates do.
//
// A movement without a `currency` (saved before currencies, or made by the fund edit sheet) has
// no source currency. It is covered by the money in its fund's currency first, then by what is
// left in the other currencies at today's rate (EGP → SAR → USD), and any rest is a shortfall in
// its own currency. So data from before currencies shows exactly the totals it always did.
export function unassignedByCurrency(state: State): Record<CurrencyCode, number> {
  const rates = state.settings.rates;
  const pool = liquidByCurrency(state);
  const need = zeroByCurrency(state);
  for (const m of state.fundMovements) {
    const fund = findFund(state, m.fundId);
    if (!fund) continue;
    if (m.currency) pool[m.currency] = addIn(pool[m.currency], -m.amount, m.currency);
    else need[fund.currency] = addIn(need[fund.currency], m.amount, fund.currency);
  }
  // 1. Each currency's currency-less movements take from the same currency's money first.
  for (const c of currencyList(state)) {
    if (need[c] <= 0) {
      // A net release (withdrawals beyond the allocations) gives the money back to its currency.
      pool[c] -= need[c];
      need[c] = 0;
      continue;
    }
    const take = Math.min(need[c], Math.max(0, pool[c]));
    pool[c] -= take;
    need[c] -= take;
  }
  // 2. What is still uncovered takes from the other currencies' leftovers at today's rate.
  // (v7's implicit FX; it goes away with account-backed funds. Currencies it touches are left unrounded:
  // a half-cent of SAR would otherwise become 0.06 EGP when shown in EGP.)
  const converted = new Set<CurrencyCode>();
  for (const c of currencyList(state)) {
    for (const d of currencyList(state)) {
      if (d === c || need[c] <= MONEY_EPSILON) continue;
      const available = Math.max(0, pool[d]);
      if (available <= 0) continue;
      const wanted = convertCurrency(need[c], c, d, rates);
      converted.add(c).add(d);
      if (wanted <= available) {
        pool[d] -= wanted;
        need[c] = 0;
      } else {
        pool[d] -= available;
        need[c] -= convertCurrency(available, d, c, rates);
      }
    }
  }
  // 3. Anything left over is short in its own currency.
  for (const c of currencyList(state)) {
    const left = pool[c] - Math.max(0, need[c]);
    pool[c] = converted.has(c) ? left : roundIn(left, c);
  }
  return pool;
}

export function unassignedSummary(state: State): UnassignedSummary {
  const rates = state.settings.rates;
  const byCurrency = unassignedByCurrency(state);
  const summary: UnassignedSummary = { byCurrency, surpluses: [], deficits: [], totalEGP: 0, surplusEGP: 0, deficitEGP: 0 };
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
  const cash = fundCashByCurrency(state, fundId);
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
      const cash = fundAllocatedIn(state, fund.id, currency);
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
    .find((f) => (currency ? fundAllocatedIn(state, f.id, currency) : fundAllocated(state, f.id)) > 0)?.id;
}
// --- Transaction lists ------------------------------------------------------

export type TransactionFilter = 'all' | Transaction['type'];

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
    .filter((tx) => monthOf(tx.date) === month && (filter === 'all' || tx.type === filter))
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

// Signed effect on net cash flow, in `to` at the transaction's own rates; transfers and asset purchases
// (money changing form, not leaving) are neutral.
export function transactionNet(
  state: Pick<State, 'rateSnapshots' | 'settings'>,
  tx: Transaction,
  to: CurrencyCode = reportingCurrency(state)
): number {
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
  state: Pick<State, 'rateSnapshots' | 'settings'>,
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

  for (const tx of state.transactions.filter(isIncomeExpense)) {
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
    savedToFunds: sumIn(state.fundMovements.filter((m) => inMonth(m.date)).map((m) => movementAmountIn(state, m, to)), to),
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
