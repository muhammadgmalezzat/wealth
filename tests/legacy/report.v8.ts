// The v8 side of the Phase B acceptance test: the same canonical report as tests/legacy/oracle.v7.ts,
// computed by the LIVE code on a migrated state. Updated as the live API moves to v8.
import * as an from '@/store/analytics';
import * as plan from '@/store/planning';
import * as sel from '@/store/selectors';
import type { CurrencyCode, FinanceState } from '@/store/types';

import type { OracleReport } from './oracle.v7';

const CURRENCIES: CurrencyCode[] = ['EGP', 'SAR', 'USD'];

const months = (state: FinanceState): string[] =>
  [...new Set(state.transactions.map((t) => t.date.slice(0, 7)))].sort();

export function reportV8(state: FinanceState, now: Date): OracleReport {
  const report: OracleReport = {
    accounts: {},
    liquidByCurrency: { ...sel.liquidByCurrency(state) },
    unassignedByCurrency: { ...sel.unassignedByCurrency(state) },
    totals: {
      liquidEGP: sel.liquidTotal(state, 'EGP'),
      holdingsEGP: sel.holdingsTotal(state, 'EGP'),
      liabilitiesEGP: sel.liabilitiesTotal(state, 'EGP'),
      netWorthEGP: sel.netWorth(state, 'EGP'),
      EG: 0,
      SA: 0,
      ...sel.netWorthByCountry(state),
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
  for (const h of state.holdings) report.holdings[h.id] = { valueEGP: sel.holdingValue(state, h, 'EGP'), costEGP: sel.holdingCost(state, h, 'EGP') };

  for (const tx of state.transactions) {
    if (tx.type === 'transfer' || tx.type === 'exchange') continue;
    report.transactions[tx.id] = Object.fromEntries(CURRENCIES.map((c) => [c, sel.transactionAmountIn(state, tx, c)]));
  }

  for (const month of months(state)) {
    const s = sel.monthSummary(state, month, { to: 'EGP' });
    const f = sel.monthFlows(state, month, 'EGP');
    report.months[month] = {
      incomeEGP: s.income,
      expenseEGP: s.expense,
      essentials: s.expenseByBucket.essentials,
      lifestyle: s.expenseByBucket.lifestyle,
      giving: s.expenseByBucket.giving,
      savedToFundsEGP: f.savedToFunds,
      investedEGP: f.invested,
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
  for (const m of sel.fundMovementRows(state)) {
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

export interface ReportDifference {
  path: string;
  oracle: unknown;
  v8: unknown;
}

// Every place the two reports differ by more than `tolerance` (absolute), numbers and strings alike.
export function diffReports(oracle: unknown, v8: unknown, tolerance = 0, path = ''): ReportDifference[] {
  if (typeof oracle === 'number' && typeof v8 === 'number') {
    return Math.abs(oracle - v8) <= tolerance ? [] : [{ path, oracle, v8 }];
  }
  if (oracle !== null && v8 !== null && typeof oracle === 'object' && typeof v8 === 'object') {
    const keys = new Set([...Object.keys(oracle as object), ...Object.keys(v8 as object)]);
    return [...keys].flatMap((k) =>
      diffReports((oracle as Record<string, unknown>)[k], (v8 as Record<string, unknown>)[k], tolerance, path ? `${path}.${k}` : k)
    );
  }
  return oracle === v8 ? [] : [{ path, oracle, v8 }];
}
