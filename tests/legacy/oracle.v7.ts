// The Phase B test oracle: every number the v7 app derives from a v7 state, computed by the FROZEN
// v7 selectors (store/legacy). The v8 code must reproduce this report (to rounding, with each
// difference listed and explained) for the same data after migration.
//
// The report is a flat, canonical shape of plain numbers keyed by id/month/currency, so a v8 adapter
// can produce the same shape with different functions.
import * as an from '@/store/legacy/analytics.v7';
import * as plan from '@/store/legacy/planning.v7';
import * as sel from '@/store/legacy/selectors.v7';
import type { CurrencyCode, FinanceState as FinanceStateV7 } from '@/store/legacy/types.v7';

const CURRENCIES: CurrencyCode[] = ['EGP', 'SAR', 'USD'];

export interface PeriodReport {
  income: number;
  expense: number;
  net: number;
  gold: number;
  fundsNet: number;
  byBucket: Record<string, number>;
}

export interface OracleReport {
  accounts: Record<string, { currency: string; balance: number }>;
  liquidByCurrency: Record<string, number>;
  unassignedByCurrency: Record<string, number>;
  totals: { liquidEGP: number; holdingsEGP: number; liabilitiesEGP: number; netWorthEGP: number; EG: number; SA: number };
  holdings: Record<string, { valueEGP: number; costEGP: number }>;
  // Recorded transactions in each currency, as worth when recorded (income / expense / gold purchases).
  transactions: Record<string, Record<string, number>>;
  months: Record<
    string,
    { incomeEGP: number; expenseEGP: number; essentials: number; lifestyle: number; giving: number; savedToFundsEGP: number; investedEGP: number }
  >;
  plans: Record<string, { currency: string; totalPlanned: number; totalSpent: number; unplannedSpent: number; safeToSpend: number | null; lines: Record<string, number> }>;
  funds: Record<string, { allocated: number; linked: number; current: number; progress: number; cash: Record<string, number> }>;
  movements: Record<string, Record<string, number>>;
  analytics: {
    sinceStart: Record<string, PeriodReport>;
    netWorth: Record<string, { month: string; total: number }[]>;
    runwayEGP: { avgEssentials: number; liquid: number; unassigned: number };
  };
  snapshots: Record<string, { netWorthEGP: number; liquidEGP: number; holdingsEGP: number }>;
}

const months = (state: FinanceStateV7): string[] =>
  [...new Set(state.transactions.map((t) => t.date.slice(0, 7)))].sort();

// All v7 numbers for `state`, computed by the frozen v7 code.
export function oracleReport(state: FinanceStateV7, now: Date): OracleReport {
  const report: OracleReport = {
    accounts: {},
    liquidByCurrency: { ...sel.liquidByCurrency(state) },
    unassignedByCurrency: { ...sel.unassignedByCurrency(state) },
    totals: {
      liquidEGP: sel.liquidTotalEGP(state),
      holdingsEGP: sel.holdingsTotalEGP(state),
      liabilitiesEGP: sel.liabilitiesTotalEGP(state),
      netWorthEGP: sel.netWorthEGP(state),
      ...sel.netWorthByLocation(state),
    },
    holdings: {},
    transactions: {},
    months: {},
    plans: {},
    funds: {},
    movements: {},
    analytics: { sinceStart: {}, netWorth: {}, runwayEGP: { avgEssentials: 0, liquid: 0, unassigned: 0 } },
    snapshots: {},
  };

  for (const a of state.accounts) report.accounts[a.id] = { currency: a.currency, balance: sel.accountBalance(state, a.id) };
  for (const h of state.holdings) report.holdings[h.id] = { valueEGP: sel.holdingValueEGP(state, h), costEGP: h.purchaseCostEGP };

  for (const tx of state.transactions) {
    if (tx.type === 'transfer') continue;
    report.transactions[tx.id] = Object.fromEntries(CURRENCIES.map((c) => [c, sel.transactionAmountIn(state, tx, c)]));
  }

  for (const month of months(state)) {
    const s = sel.monthSummary(state, month);
    const f = sel.monthFlows(state, month);
    report.months[month] = {
      incomeEGP: s.incomeEGP,
      expenseEGP: s.expenseEGP,
      essentials: s.expenseByBucket.essentials,
      lifestyle: s.expenseByBucket.lifestyle,
      giving: s.expenseByBucket.giving,
      savedToFundsEGP: f.savedToFundsEGP,
      investedEGP: f.investedEGP,
    };
  }

  for (const p of state.monthlyPlans) {
    const progress = plan.planProgress(state, p.month);
    if (!progress) continue;
    report.plans[p.month] = {
      currency: p.currency,
      totalPlanned: progress.totalPlanned,
      totalSpent: progress.totalSpent,
      unplannedSpent: progress.unplannedSpent,
      safeToSpend: plan.safeToSpend(state, p.month),
      lines: Object.fromEntries(progress.lines.map((l) => [l.categoryId, l.spent])),
    };
  }

  for (const fund of state.funds) {
    report.funds[fund.id] = {
      allocated: sel.fundAllocated(state, fund.id),
      linked: sel.fundLinkedValue(state, fund.id),
      current: sel.fundCurrent(state, fund.id),
      progress: sel.fundProgress(state, fund.id),
      cash: { ...sel.fundCashByCurrency(state, fund.id) },
    };
  }
  for (const m of state.fundMovements) {
    report.movements[m.id] = Object.fromEntries(CURRENCIES.map((c) => [c, sel.movementAmountIn(state, m, c)]));
  }

  for (const currency of ['EGP', 'SAR'] as const) {
    const query: an.AnalyticsQuery = {
      period: an.resolvePeriod(state, 'sinceStart', now),
      currency,
      includeOneTime: true,
    };
    const t = an.periodTotals(state, query);
    report.analytics.sinceStart[currency] = {
      income: t.income,
      expense: t.expense,
      net: t.net,
      gold: t.gold,
      fundsNet: t.fundsNet,
      byBucket: { ...t.byBucket },
    };
    const series = an.netWorthSeries(state, { location: 'all', currency, includeEstimated: true, now });
    report.analytics.netWorth[currency] = series.points.map((p) => ({ month: p.month, total: p.total }));
  }
  const runway = an.runway(state, 'EGP', now);
  report.analytics.runwayEGP = {
    avgEssentials: runway.avgEssentials,
    liquid: runway.liquid.amount,
    unassigned: runway.unassigned.amount,
  };

  for (const s of state.netWorthSnapshots) {
    report.snapshots[s.month] = { netWorthEGP: s.netWorthEGP, liquidEGP: s.liquidEGP, holdingsEGP: s.holdingsEGP };
  }
  return report;
}
