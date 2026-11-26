// Phase 2b: the Overview's transaction-based charts (cash-flow bars, sparklines, spending footprint). Synthetic data
// only. Run with: npm run test:logic
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as ui from '@/components/analytics/overviewUi';
import { categoryIcon, EXPENSE_COLOR, FOOTPRINT_COLORS, INCOME_COLOR, RESERVED_COLOR } from '@/components/analytics/categoryIcons';
import { groupedBars, slotAt, sparkLayout } from '@/components/analytics/seriesLayout';
import { cashflowChart, spendingFootprint } from '@/store/cashflowCharts';
import { comparePeriods } from '@/store/comparison';
import { overview } from '@/store/overview';
import { resolveAnalyticsPeriod, resolvePeriodChoice, type PeriodPreset } from '@/store/periods';
import { sumIn } from '@/utils/money';
import { fromDateKey } from '@/utils/dates';
import { expense, findNonFinite, flowWorld, income, richWorld } from './fixtures/synthetic';

const NOW = new Date(2026, 10, 26, 12, 0);
const PRESETS: PeriodPreset[] = ['thisWeek', 'lastWeek', 'month', 'lastMonth', '3m', '6m', '12m', 'thisYear', 'lastYear', 'sinceStart', 'payCycle'];
const CURRENCIES = ['EGP', 'SAR', 'USD'];
const strip = (text: string) => text.replace(/[⁦-⁩‎]/g, '');

describe('cash-flow bars: reconcile with the cards, never before tracking', () => {
  const s = richWorld();

  it('for every preset and three currencies, the bars inside the period add up to the income and spending cards exactly', () => {
    for (const preset of PRESETS) {
      for (const currency of CURRENCIES) {
        const period = resolvePeriodChoice(s, { preset }, NOW);
        const cards = comparePeriods(s, { current: period, currency, includeOneTime: true }).current.metrics;
        const chart = cashflowChart(s, period, { currency });
        const inside = chart.buckets.filter((b) => b.inPeriod);
        if (cards.income.value === null) {
          // A period before tracking: no card value and no bar (never a zero bar).
          assert.equal(inside.length, 0, `${preset} before tracking`);
          continue;
        }
        assert.ok(inside.length > 0, `${preset} has bars`);
        assert.equal(sumIn(inside.map((b) => b.income), currency), cards.income.value, `${preset} ${currency} income`);
        assert.equal(sumIn(inside.map((b) => b.expense), currency), cards.expense.value, `${preset} ${currency} expense`);
        assert.equal(findNonFinite(chart), null);
      }
    }
  });

  it('transfers, exchanges, gold purchases and fund allocations are not drawn; fees are spending', () => {
    const chart = cashflowChart(flowWorld(), resolveAnalyticsPeriod(flowWorld(), '6m', NOW), { currency: 'EGP' });
    const nov = chart.buckets.find((b) => b.key === '2026-11')!;
    assert.deepEqual([nov.income, nov.expense, nov.net], [20_000, 6_015, 13_985]);
  });

  it('months before tracking are not drawn (no zero bars) and the chart says where the data starts', () => {
    const t = richWorld('2026-09-15');
    const chart = cashflowChart(t, resolveAnalyticsPeriod(t, '6m', NOW), { currency: 'EGP' });
    assert.deepEqual(chart.buckets.map((b) => b.key), ['2026-09', '2026-10', '2026-11']);
    assert.equal(chart.buckets[0].from, '2026-09-15');
    assert.equal(chart.buckets[0].partial, true);
    assert.equal(chart.dataStart, '2026-09-15');
    assert.ok(chart.buckets.every((b) => b.from >= '2026-09-15'));
    assert.equal(cashflowChart(s, resolveAnalyticsPeriod(s, '6m', NOW), { currency: 'EGP' }).dataStart, null);
  });

  it('6 months by default; the period\'s own months when longer; weeks (from Saturday) for a month or less', () => {
    const six = cashflowChart(s, resolveAnalyticsPeriod(s, '3m', NOW), { currency: 'EGP' });
    assert.equal(six.unit, 'month');
    assert.deepEqual(six.buckets.map((b) => b.key), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    assert.deepEqual(six.buckets.map((b) => b.inPeriod), [false, false, false, true, true, true]);
    assert.equal(cashflowChart(s, resolveAnalyticsPeriod(s, '12m', NOW), { currency: 'EGP' }).buckets.length, 9); // from March (tracking)
    const weeks = cashflowChart(s, resolveAnalyticsPeriod(s, 'month', NOW), { currency: 'EGP' });
    assert.equal(weeks.unit, 'week');
    assert.deepEqual(weeks.buckets.map((b) => [b.from, b.to]), [
      ['2026-11-01', '2026-11-06'],
      ['2026-11-07', '2026-11-13'],
      ['2026-11-14', '2026-11-20'],
      ['2026-11-21', '2026-11-26'],
    ]);
    assert.ok(weeks.buckets.slice(1).every((b) => fromDateKey(b.key).getDay() === 6));
  });

  it('the running bar is marked; averages and counts use complete bars only', () => {
    const chart = cashflowChart(s, resolveAnalyticsPeriod(s, '6m', NOW), { currency: 'EGP' });
    assert.deepEqual(chart.buckets.map((b) => b.inProgress), [false, false, false, false, false, true]);
    assert.equal(chart.completeCount, 5);
    const complete = chart.buckets.slice(0, 5);
    assert.equal(chart.averageIncome, Math.round((sumIn(complete.map((b) => b.income), 'EGP') / 5) * 100) / 100);
    assert.equal(chart.averageExpense, Math.round((sumIn(complete.map((b) => b.expense), 'EGP') / 5) * 100) / 100);
    assert.equal(chart.positive + chart.negative, complete.filter((b) => Math.abs(b.net) >= 0.005).length);
    assert.equal(chart.negative, 1); // July: rent 21,500.25 against a salary of 20,000
  });

  it('a period that starts mid-month (a pay cycle, a custom range) splits that month at its start (bars inside still add up)', () => {
    const period = resolveAnalyticsPeriod(s, 'custom', NOW, { from: '2026-09-28', to: '2026-11-26' });
    const chart = cashflowChart(s, period, { currency: 'EGP' });
    const cards = comparePeriods(s, { current: period, currency: 'EGP', includeOneTime: true }).current.metrics;
    assert.equal(sumIn(chart.buckets.filter((b) => b.inPeriod).map((b) => b.expense), 'EGP'), cards.expense.value);
    const sep = chart.buckets.filter((b) => b.key === '2026-09');
    assert.deepEqual(sep.map((b) => [b.from, b.to, b.inPeriod]), [
      ['2026-09-01', '2026-09-27', false],
      ['2026-09-28', '2026-09-30', true],
    ]);
  });

  it('sparklines: always exactly the last 6 months, never widened nor split', () => {
    for (const preset of ['month', '12m', 'payCycle'] as const) {
      const period = resolvePeriodChoice(s, { preset }, NOW);
      const spark = cashflowChart(s, period, { currency: 'EGP', unit: 'month', minMonths: 6, followPeriod: false });
      assert.deepEqual(spark.buckets.map((b) => b.key), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'], preset);
    }
  });

  it('memoized; a backdated insert recomputes', () => {
    const p = resolveAnalyticsPeriod(s, '6m', NOW);
    assert.equal(cashflowChart(s, p, { currency: 'EGP' }), cashflowChart(s, p, { currency: 'EGP' }));
    const more = { ...s, transactions: [...s.transactions, expense('x', 100, '2026-07-01')] };
    assert.equal(cashflowChart(more, p, { currency: 'EGP' }).buckets.find((b) => b.key === '2026-07')!.expense, 21_600.25);
  });
});

describe('spending footprint: shares add up to 100 %, amounts to the spending card', () => {
  const s = richWorld();

  it('for every preset and three currencies (top 4 + «باقي الفئات»)', () => {
    for (const preset of PRESETS) {
      for (const currency of CURRENCIES) {
        const comparison = comparePeriods(s, { current: resolvePeriodChoice(s, { preset }, NOW), currency, includeOneTime: true });
        const f = spendingFootprint(comparison);
        assert.equal(f.total, comparison.current.metrics.expense.value);
        if (f.total === null) {
          assert.equal(f.segments.length, 0, `${preset}: no data, no segments`);
          continue;
        }
        if (f.segments.length === 0) continue;
        assert.equal(f.segments.reduce((t, x) => t + x.tenths, 0), 1000, `${preset} ${currency} tenths`);
        assert.ok(Math.abs(f.segments.reduce((t, x) => t + x.share, 0) - 1) < 1e-9);
        assert.equal(sumIn(f.segments.map((x) => x.amount), currency), f.total, `${preset} ${currency} amounts`);
        assert.ok(f.segments.filter((x) => x.key !== 'rest').length <= 4);
        assert.equal(findNonFinite(f), null);
      }
    }
  });

  it('November: top 4 by amount, then the rest with its own change against the same categories before', () => {
    const comparison = comparePeriods(s, { current: resolveAnalyticsPeriod(s, 'month', NOW), alignment: 'full', currency: 'EGP', includeOneTime: true });
    const f = spendingFootprint(comparison);
    assert.deepEqual(f.segments.slice(0, 4).map((x) => x.key), ['cat-essentials-groceries', 'cat-essentials-home-setup', 'cat-lifestyle-gadgets', 'cat-essentials-transport']);
    const rest = f.segments[4];
    assert.equal(rest.key, 'rest');
    assert.ok(rest.categoryIds.includes('cat-essentials-fees'));
    // October spent 1,000 on dining (now in the rest) and nothing else of the rest's categories.
    assert.equal(rest.change.previous.value, 0);
    assert.equal(f.segments[0].change.previous.value, 3_000);
  });

  it('no spending → no segments (never a 0 % bar)', () => {
    const empty = { ...s, transactions: s.transactions.filter((t) => t.type !== 'expense' && t.type !== 'transfer' && t.type !== 'exchange') };
    const f = spendingFootprint(comparePeriods(empty, { current: resolveAnalyticsPeriod(empty, 'month', NOW), currency: 'EGP', includeOneTime: true }));
    assert.deepEqual(f, { total: 0, segments: [] });
  });

  it('largest remainder: three equal thirds are 33.4 + 33.3 + 33.3', () => {
    const three = {
      ...s,
      transactions: [
        expense('a', 100, '2026-11-02', { categoryId: 'cat-essentials-rent' }),
        expense('b', 100, '2026-11-02', { categoryId: 'cat-lifestyle-dining' }),
        expense('c', 100, '2026-11-02', { categoryId: 'cat-giving-gifts' }),
      ],
    };
    const f = spendingFootprint(comparePeriods(three, { current: resolveAnalyticsPeriod(three, 'month', NOW), currency: 'EGP', includeOneTime: true }));
    assert.deepEqual(f.segments.map((x) => x.tenths).sort((a, b) => b - a), [334, 333, 333]);
    assert.deepEqual(f.segments.map((x) => strip(ui.shareText(x.tenths))).sort(), ['33.3%', '33.3%', '33.4%']);
  });
});

describe('overview with the charts: nothing non-finite, sparklines gated by recorded days', () => {
  it('every preset × currency', () => {
    const s = richWorld();
    for (const preset of PRESETS) {
      for (const currency of CURRENCIES) {
        const o = overview(s, { period: resolvePeriodChoice(s, { preset }, NOW), alignment: 'elapsed', currency, now: NOW, dailyStore: null });
        assert.equal(findNonFinite(o), null, `${preset} ${currency}`);
        assert.equal(o.pointSparks, null); // no daily history → no snapshot sparklines
        // The last 6 months up to the period's end, minus months before tracking (lastYear: none).
        assert.equal(o.sparkline.buckets.length, preset === 'lastYear' ? 0 : 6, preset);
      }
    }
  });
});

describe('chart geometry and copy', () => {
  it('bars: zero stays zero, the axis starts at 0 and covers the max, touches map to bars', () => {
    const layout = groupedBars([{ income: 0, expense: 0 }, { income: 20_000, expense: 6_015 }, { income: 0, expense: 450 }], 300, 150);
    assert.equal(layout.slots[0].income.h, 0);
    assert.equal(layout.slots[0].expense.h, 0);
    assert.equal(layout.ticks[0].value, 0);
    assert.ok(layout.ticks[layout.ticks.length - 1].value >= 20_000);
    assert.ok(layout.slots[1].income.h > layout.slots[1].expense.h);
    assert.equal(slotAt(0, layout), 0);
    assert.equal(slotAt(299, layout), 2);
    assert.equal(findNonFinite(groupedBars([], 300, 150)), null);
  });

  it('sparkline: gaps break it, a running last value is a hollow dot not joined to the line', () => {
    const running = sparkLayout([100, 120, null, 90, 110, 130], true, 120, 28);
    assert.equal(running.lines.length, 2); // 100–120, then 90–110 (130 is running: hollow, not joined)
    assert.equal(running.dots.length, 0);
    assert.ok(running.hollow);
    assert.equal(sparkLayout([100, null, 90, null, 130], false, 120, 28).dots.length, 3);
    const closed = sparkLayout([100, 120, 130], false, 120, 28);
    assert.equal(closed.hollow, null);
    assert.equal(closed.lines.length, 1);
    assert.deepEqual(sparkLayout([null, null], false, 120, 28), { lines: [], dots: [], hollow: null });
  });

  it('copy: titles, averages, counts', () => {
    assert.equal(ui.bucketTitle({ unit: 'month', key: '2026-11', from: '2026-11-01', to: '2026-11-26', partial: true, inProgress: true }).endsWith('لسه شغال'), true);
    const line = ui.averagesLine({ unit: 'month', averageIncome: 20_000, averageExpense: 6_000, completeCount: 5 }, 'EGP')!;
    assert.match(strip(line), /^متوسط الشهر: دخل ج\.م 20,000 · مصروف ج\.م 6,000 \(من 5 شهور كاملة\)$/);
    assert.equal(ui.averagesLine({ unit: 'week', averageIncome: null, averageExpense: null, completeCount: 0 }, 'EGP'), null);
    assert.equal(ui.balanceCountLine({ unit: 'month', positive: 4, negative: 1, completeCount: 5 }), 'شهور بفايض: 4 · شهور بعجز: 1');
    assert.equal(ui.restLabel(3), 'باقي الفئات (3)');
  });

  it('colours: income emerald, spending sky everywhere; footprint never emerald or gold; every category has an icon', () => {
    assert.equal(INCOME_COLOR, 'primary');
    assert.equal(EXPENSE_COLOR, 'chartSky');
    assert.equal(FOOTPRINT_COLORS[0], EXPENSE_COLOR);
    assert.ok(FOOTPRINT_COLORS.every((c) => c !== 'primary' && c !== 'gold'));
    assert.notEqual(RESERVED_COLOR, 'gold'); // gold is only for gold
    assert.equal(categoryIcon('cat-essentials-rent', 'essentials'), 'home');
    assert.equal(categoryIcon('my-own', 'giving'), 'volunteer-activism');
  });
});
