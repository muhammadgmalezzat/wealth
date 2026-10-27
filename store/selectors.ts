import { convertCurrency, fromEGP, historicalAmountIn, toEGP } from '@/utils/currency';
import { monthOf, monthsUntil, shiftMonth, toMonthKey } from '@/utils/dates';
import { daysLeftInMonth } from './shared';
import type {
  Account,
  Category,
  CurrencyCode,
  ExpenseBucket,
  FinanceState,
  Fund,
  FundMovement,
  GoldKarat,
  Holding,
  IncomeExpenseTransaction,
  Liability,
  Location,
  LocationBreakdown,
  NetWorthBreakdown,
  SinkingFrequency,
  Transaction,
} from './types';

// Single source of truth for every derived financial figure. All functions are pure.
// Balances and holdings are valued at CURRENT rates/prices (what they're worth now);
// transaction flows use each transaction's snapshotted rateToEGP (what they were worth then).

type State = FinanceState;

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

const isIncomeExpense = (tx: Transaction): tx is IncomeExpenseTransaction =>
  tx.type === 'income' || tx.type === 'expense';

// --- Accounts ---------------------------------------------------------------

type LiquidState = Pick<State, 'accounts' | 'transactions' | 'settings'>;

// Net effect of all transactions on the account, in its own currency.
export function accountNetFlow(state: Pick<State, 'transactions'>, accountId: string): number {
  let flow = 0;
  for (const tx of state.transactions) {
    if (tx.type === 'transfer') {
      if (tx.fromAccountId === accountId) flow -= tx.amount;
      if (tx.toAccountId === accountId) flow += tx.toAmount;
    } else if (tx.accountId === accountId) {
      // Expenses and asset purchases both take money out of the account.
      flow += tx.type === 'income' ? tx.amount : -tx.amount;
    }
  }
  return flow;
}

// Balance in the account's own currency.
export function accountBalance(state: Pick<State, 'accounts' | 'transactions'>, accountId: string): number {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return 0;
  return account.openingBalance + accountNetFlow(state, accountId);
}

// The openingBalance that makes the derived balance equal `currentBalance`.
export function openingBalanceForCurrentBalance(
  state: Pick<State, 'transactions'>,
  accountId: string,
  currentBalance: number
): number {
  return currentBalance - accountNetFlow(state, accountId);
}

export function accountBalanceEGP(state: LiquidState, account: Account): number {
  return toEGP(accountBalance(state, account.id), account.currency, state.settings.exchangeRates);
}

// Archived accounts still hold money, so they count.
export function liquidTotalEGP(state: LiquidState): number {
  return sum(state.accounts.map((a) => accountBalanceEGP(state, a)));
}

// --- Holdings ---------------------------------------------------------------

// EGP per gram for a karat: 24k and 21k have their own market prices; 18k derives from 24k.
export function goldPricePerGram(settings: State['settings'], karat: GoldKarat): number {
  if (karat === 24) return settings.goldPrice24kEGP;
  if (karat === 21) return settings.goldPrice21kEGP;
  return settings.goldPrice24kEGP * 0.75;
}

export function holdingValueEGP(state: Pick<State, 'settings'>, holding: Holding): number {
  if (holding.type === 'gold') {
    return holding.weightGrams * goldPricePerGram(state.settings, holding.karat);
  }
  return toEGP(holding.quantity, holding.currency, state.settings.exchangeRates);
}

export function holdingPnlEGP(state: State, holding: Holding): number {
  return holdingValueEGP(state, holding) - holding.purchaseCostEGP;
}

export function holdingsTotalEGP(state: State): number {
  return sum(state.holdings.map((h) => holdingValueEGP(state, h)));
}

export function totalAssetsEGP(state: State): number {
  return liquidTotalEGP(state) + holdingsTotalEGP(state);
}

// --- Liabilities ------------------------------------------------------------

// In the liability's currency. Payments are expense transactions tagged with liabilityId
// (the store enforces they share the liability's currency).
export function liabilityRemaining(state: State, liability: Liability): number {
  const paid = sum(
    state.transactions
      .filter(isIncomeExpense)
      .filter((tx) => tx.type === 'expense' && tx.liabilityId === liability.id)
      .map((tx) => tx.amount)
  );
  return Math.max(0, liability.principal - paid);
}

export function liabilitiesTotalEGP(state: State): number {
  return sum(
    state.liabilities.map((l) =>
      toEGP(liabilityRemaining(state, l), l.currency, state.settings.exchangeRates)
    )
  );
}

export function netWorthEGP(state: State): number {
  return liquidTotalEGP(state) + holdingsTotalEGP(state) - liabilitiesTotalEGP(state);
}

// Cash, gold and currency holdings per location (EGP at current rates), plus liabilities.
export function netWorthBreakdown(state: State): NetWorthBreakdown {
  const empty = (): LocationBreakdown => ({ cashEGP: 0, goldEGP: 0, currenciesEGP: 0 });
  const result: NetWorthBreakdown = { EG: empty(), SA: empty(), liabilitiesEGP: liabilitiesTotalEGP(state) };
  for (const account of state.accounts) result[account.location].cashEGP += accountBalanceEGP(state, account);
  for (const holding of state.holdings) {
    const where = result[holding.location ?? 'EG'];
    if (holding.type === 'gold') where.goldEGP += holdingValueEGP(state, holding);
    else where.currenciesEGP += holdingValueEGP(state, holding);
  }
  return result;
}

export interface NetWorthFigures {
  netWorthEGP: number;
  liquidEGP: number;
  holdingsEGP: number;
  breakdown: NetWorthBreakdown;
}

export function netWorthFigures(state: State): NetWorthFigures {
  return {
    netWorthEGP: netWorthEGP(state),
    liquidEGP: liquidTotalEGP(state),
    holdingsEGP: holdingsTotalEGP(state),
    breakdown: netWorthBreakdown(state),
  };
}

// Best-effort net worth at the end of `date` ('YYYY-MM-DD'), at CURRENT rates and prices (there
// is no price history): transactions dated after it are left out, as are accounts opened,
// holdings bought and liabilities started after it. Missing dates count as "always there".
export function netWorthAsOf(state: State, date: string): NetWorthFigures {
  const onOrBefore = (d: string | undefined) => !d || d.slice(0, 10) <= date;
  const past: State = {
    ...state,
    accounts: state.accounts.filter((a) => onOrBefore(a.openingDate)),
    transactions: state.transactions.filter((tx) => onOrBefore(tx.date)),
    holdings: state.holdings.filter((h) => onOrBefore(h.purchaseDate)),
    liabilities: state.liabilities.filter((l) => onOrBefore(l.startDate)),
  };
  return netWorthFigures(past);
}

// Net worth split by where things are. Holdings without a location count as Egypt, and so
// do liabilities (they have no location), so EG + SA always equals netWorthEGP.
export function netWorthByLocation(state: State): Record<Location, number> {
  const result: Record<Location, number> = { EG: 0, SA: 0 };
  for (const account of state.accounts) result[account.location] += accountBalanceEGP(state, account);
  for (const holding of state.holdings) result[holding.location ?? 'EG'] += holdingValueEGP(state, holding);
  result.EG -= liabilitiesTotalEGP(state);
  return result;
}

// Account balances summed per currency, in that currency (no conversion).
export function liquidByCurrency(state: LiquidState): Record<CurrencyCode, number> {
  const result: Record<CurrencyCode, number> = { EGP: 0, SAR: 0, USD: 0 };
  for (const account of state.accounts) result[account.currency] += accountBalance(state, account.id);
  return result;
}

export interface GoldTotals {
  totalGrams: number;
  gramsByKarat: Record<GoldKarat, number>;
  totalCostEGP: number;
}

export function goldTotals(state: Pick<State, 'holdings'>): GoldTotals {
  const totals: GoldTotals = { totalGrams: 0, gramsByKarat: { 18: 0, 21: 0, 24: 0 }, totalCostEGP: 0 };
  for (const h of state.holdings) {
    if (h.type !== 'gold') continue;
    totals.totalGrams += h.weightGrams;
    totals.gramsByKarat[h.karat] += h.weightGrams;
    totals.totalCostEGP += h.purchaseCostEGP;
  }
  return totals;
}

// --- Funds ------------------------------------------------------------------

function findFund(state: State, fundId: string): Fund | undefined {
  return state.funds.find((f) => f.id === fundId);
}

const CURRENCY_ORDER: readonly CurrencyCode[] = ['EGP', 'SAR', 'USD'];
const zeroByCurrency = (): Record<CurrencyCode, number> => ({ EGP: 0, SAR: 0, USD: 0 });
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
  const result = zeroByCurrency();
  const fund = findFund(state, fundId);
  if (!fund) return result;
  for (const m of state.fundMovements) {
    if (m.fundId === fundId) result[m.currency ?? fund.currency] += m.amount;
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
  return sum(CURRENCY_ORDER.map((c) => convertCurrency(cash[c], c, fund.currency, state.settings.exchangeRates)));
}

// Market value of the fund's linked holdings, in the fund's currency: a currency holding is its
// quantity (no round trip through EGP when it is the fund's own currency), gold is its EGP
// market value converted.
export function fundLinkedValue(state: State, fundId: string): number {
  const fund = findFund(state, fundId);
  if (!fund) return 0;
  const rates = state.settings.exchangeRates;
  return sum(
    state.holdings
      .filter((h) => fund.linkedHoldingIds.includes(h.id))
      .map((h) =>
        h.type === 'currency'
          ? convertCurrency(h.quantity, h.currency, fund.currency, rates)
          : fromEGP(holdingValueEGP(state, h), fund.currency, rates)
      )
  );
}

// Fund currency: cash movements + market value of linked holdings.
export function fundCurrent(state: State, fundId: string): number {
  return fundAllocated(state, fundId) + fundLinkedValue(state, fundId);
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
// with its ratesSnapshot. Movements made before they carried a snapshot convert at today's rates.
export function movementAmountIn(
  state: State,
  movement: Pick<FundMovement, 'fundId' | 'amount' | 'currency' | 'ratesSnapshot'>,
  currency: CurrencyCode
): number {
  const from = movementCurrency(state, movement);
  if (!from) return 0;
  return convertCurrency(movement.amount, from, currency, movement.ratesSnapshot ?? state.settings.exchangeRates);
}

// A movement's CURRENT value in its fund's currency (today's rate): what it adds to
// fundAllocated.
export function movementValueInFund(
  state: State,
  movement: Pick<FundMovement, 'fundId' | 'amount' | 'currency'>
): number {
  const fund = findFund(state, movement.fundId);
  if (!fund) return 0;
  return convertCurrency(movement.amount, movement.currency ?? fund.currency, fund.currency, state.settings.exchangeRates);
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
  const allocatedThisMonth = sum(
    state.fundMovements
      .filter((m) => m.fundId === fundId && monthOf(m.date) === month)
      .map((m) => movementValueInFund(state, m))
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
  const rates = state.settings.exchangeRates;
  const pool = liquidByCurrency(state);
  const need = zeroByCurrency();
  for (const m of state.fundMovements) {
    const fund = findFund(state, m.fundId);
    if (!fund) continue;
    if (m.currency) pool[m.currency] -= m.amount;
    else need[fund.currency] += m.amount;
  }
  // 1. Each currency's currency-less movements take from the same currency's money first.
  for (const c of CURRENCY_ORDER) {
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
  for (const c of CURRENCY_ORDER) {
    for (const d of CURRENCY_ORDER) {
      if (d === c || need[c] <= MONEY_EPSILON) continue;
      const available = Math.max(0, pool[d]);
      if (available <= 0) continue;
      const wanted = convertCurrency(need[c], c, d, rates);
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
  for (const c of CURRENCY_ORDER) pool[c] -= Math.max(0, need[c]);
  return pool;
}

export function unassignedSummary(state: State): UnassignedSummary {
  const rates = state.settings.exchangeRates;
  const byCurrency = unassignedByCurrency(state);
  const summary: UnassignedSummary = { byCurrency, surpluses: [], deficits: [], totalEGP: 0, surplusEGP: 0, deficitEGP: 0 };
  for (const currency of CURRENCY_ORDER) {
    const amount = byCurrency[currency];
    const egp = toEGP(amount, currency, rates);
    summary.totalEGP += egp;
    if (amount > MONEY_EPSILON) {
      summary.surpluses.push({ currency, amount });
      summary.surplusEGP += egp;
    } else if (amount < -MONEY_EPSILON) {
      summary.deficits.push({ currency, amount: -amount });
      summary.deficitEGP -= egp;
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
  return unassignedEGP(state) - toEGP(change, fund.currency, state.settings.exchangeRates);
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
  const rates = state.settings.exchangeRates;
  return sum(
    amounts.map(({ fundId, amount, currency }) => {
      const fund = findFund(state, fundId);
      return fund ? toEGP(amount, currency ?? fund.currency, rates) : 0;
    })
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
  const rates = state.settings.exchangeRates;
  const cash = fundCashByCurrency(state, fundId);
  const order = [currency, fund.currency, ...CURRENCY_ORDER].filter((c, i, all) => all.indexOf(c) === i);
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
  const rates = state.settings.exchangeRates;
  let leftEGP = Math.max(0, amountEGP);
  const result: FundAmount[] = [];
  for (const fund of fundsByPriority(state)) {
    if (leftEGP <= 0.005) break;
    const wantEGP = toEGP(fundSuggestedMonthly(state, fund.id, now), fund.currency, rates);
    const giveEGP = Math.min(wantEGP, leftEGP);
    if (giveEGP <= 0.005) continue;
    result.push({ fundId: fund.id, amount: round2(fromEGP(giveEGP, fund.currency, rates)) });
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
  const rates = state.settings.exchangeRates;
  let left = Math.max(0, amount);
  const result: FundAmount[] = [];
  for (const fund of fundsByPriority(state)) {
    if (left <= MONEY_EPSILON) break;
    const want = convertCurrency(fundSuggestedMonthly(state, fund.id, now), fund.currency, currency, rates);
    const give = Math.min(want, left);
    if (give <= MONEY_EPSILON) continue;
    result.push({ fundId: fund.id, amount: round2(give), currency });
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
  const rates = state.settings.exchangeRates;
  const unassigned = unassignedByCurrency(state);
  const chosen = state.funds
    .filter((f) => fundIds.includes(f.id))
    .sort((a, b) => b.priority - a.priority);
  const withdrawals: FundAmount[] = [];
  let remainingEGP = 0;
  for (const currency of CURRENCY_ORDER) {
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
    remainingEGP += toEGP(Math.max(0, deficit), currency, rates);
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
// own currency; otherwise its rateToEGP for the source leg and its ratesSnapshot for the target
// leg (today's rates only for transactions older than ratesSnapshot — a known approximation).
export function transactionAmountIn(
  state: Pick<State, 'settings'>,
  tx: Pick<IncomeExpenseTransaction, 'amount' | 'rateToEGP' | 'currency' | 'ratesSnapshot'>,
  currency: CurrencyCode
): number {
  return historicalAmountIn(tx.amount, tx.currency, currency, tx.rateToEGP, tx.ratesSnapshot, state.settings.exchangeRates);
}

// Signed EGP effect on net cash flow at the snapshotted rate; transfers and asset purchases
// (money changing form, not leaving) are neutral.
export function transactionNetEGP(tx: Transaction): number {
  if (!isIncomeExpense(tx)) return 0;
  const amountEGP = tx.amount * tx.rateToEGP;
  return tx.type === 'income' ? amountEGP : -amountEGP;
}

export interface DayGroup {
  date: string;
  netEGP: number;
  transactions: Transaction[];
}

// Groups by calendar day, newest day first and newest transaction first within a day.
export function groupTransactionsByDay(transactions: Transaction[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const tx of [...transactions].sort(compareNewestFirst)) {
    const day = tx.date.slice(0, 10);
    const group = groups.get(day) ?? { date: day, netEGP: 0, transactions: [] };
    group.netEGP += transactionNetEGP(tx);
    group.transactions.push(tx);
    groups.set(day, group);
  }
  return [...groups.values()];
}

// --- Monthly cash flow ------------------------------------------------------

export interface MonthSummary {
  incomeEGP: number;
  expenseEGP: number;
  expenseByBucket: Record<ExpenseBucket, number>;
  netCashFlow: number;
  // net / income; null when there is no income.
  savingsRate: number | null;
}

export interface MonthSummaryOptions {
  // Leave out one-time expenses (used for averages such as the emergency target).
  excludeOneTime?: boolean;
}

// Income and expenses only: transfers move money between own accounts and asset purchases
// turn cash into holdings, so neither counts. Transactions before trackingStartDate are ignored.
export function monthSummary(state: State, month: string, options: MonthSummaryOptions = {}): MonthSummary {
  const categoryBucket = new Map(state.categories.map((c) => [c.id, c.bucket]));
  const summary: MonthSummary = {
    incomeEGP: 0,
    expenseEGP: 0,
    expenseByBucket: { essentials: 0, lifestyle: 0, giving: 0 },
    netCashFlow: 0,
    savingsRate: null,
  };

  for (const tx of state.transactions.filter(isIncomeExpense)) {
    if (monthOf(tx.date) !== month || tx.date < state.settings.trackingStartDate) continue;
    if (options.excludeOneTime && tx.oneTime) continue;
    const amountEGP = tx.amount * tx.rateToEGP;
    if (tx.type === 'income') {
      summary.incomeEGP += amountEGP;
    } else {
      summary.expenseEGP += amountEGP;
      const bucket = categoryBucket.get(tx.categoryId);
      if (bucket && bucket !== 'income') summary.expenseByBucket[bucket] += amountEGP;
    }
  }

  summary.netCashFlow = summary.incomeEGP - summary.expenseEGP;
  summary.savingsRate = summary.incomeEGP > 0 ? summary.netCashFlow / summary.incomeEGP : null;
  return summary;
}

export interface MonthFlows {
  incomeEGP: number;
  expenseEGP: number;
  // Net fund movements of the month (allocations minus withdrawals), each at its own rates.
  savedToFundsEGP: number;
  // Asset purchases (cash turned into holdings), at their snapshot rates.
  investedEGP: number;
}

// Where the month's money went: monthSummary's income and expenses plus what was put into funds
// and invested. Like monthSummary, ignores dates before trackingStartDate.
export function monthFlows(state: State, month: string): MonthFlows {
  const { incomeEGP, expenseEGP } = monthSummary(state, month);
  const start = state.settings.trackingStartDate;
  const inMonth = (date: string) => monthOf(date) === month && date >= start;
  return {
    incomeEGP,
    expenseEGP,
    savedToFundsEGP: sum(state.fundMovements.filter((m) => inMonth(m.date)).map((m) => movementAmountIn(state, m, 'EGP'))),
    investedEGP: sum(
      state.transactions.filter((tx) => tx.type === 'asset_purchase' && inMonth(tx.date)).map((tx) => tx.amount * tx.rateToEGP)
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
    .map((m) => monthSummary(state, m, { excludeOneTime: true }).expenseByBucket.essentials)
    .filter((essentials) => essentials > 0);
  if (recorded.length === 0) return null;
  return (sum(recorded) / recorded.length) * months;
}

// --- Diagnostics ------------------------------------------------------------

export function stateSummary(state: State) {
  return {
    accounts: state.accounts.length,
    holdings: state.holdings.length,
    funds: state.funds.length,
    netWorthEGP: Math.round(netWorthEGP(state) * 100) / 100,
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
