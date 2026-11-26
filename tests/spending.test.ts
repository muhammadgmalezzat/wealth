// Phase 3: the redesigned «الإنفاق» tab and the Overview's monthly net worth view. Synthetic data only.
// Run with: npm run test:logic
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as sui from '@/components/analytics/spendingUi';
import { donutSlices, singleBars, sliceAt } from '@/components/analytics/seriesLayout';
import * as analytics from '@/store/analytics';
import { spendingFootprint } from '@/store/cashflowCharts';
import { overview } from '@/store/overview';
import { previousAnalyticsPeriod, resolveAnalyticsPeriod, resolvePeriodChoice, type PeriodPreset } from '@/store/periods';
import { compareCategory, largestRemainder, legacyPeriodOf, MAX_DAILY_BARS, spendingView } from '@/store/spending';
import { sumIn } from '@/utils/money';
import { expense, findNonFinite, richWorld } from './fixtures/synthetic';

const NOW = new Date(2026, 10, 26, 12, 0);
const PRESETS: PeriodPreset[] = ['thisWeek', 'lastWeek', 'month', 'lastMonth', '3m', '6m', '12m', 'thisYear', 'lastYear', 'sinceStart', 'payCycle'];
const CURRENCIES = ['EGP', 'SAR', 'USD'];
const strip = (text: string) => text.replace(/[⁦-⁩‎]/g, '');

describe('«الإنفاق»: no number changes against the old screen', () => {
  const s = richWorld();

  it('the sections kept from the old tab get exactly the old period for the old presets', () => {
    const old: [PeriodPreset, analytics.PeriodKind][] = [['month', 'month'], ['3m', '3m'], ['6m', '6m'], ['12m', 'year'], ['sinceStart', 'sinceStart']];
    for (const [preset, kind] of old) {
      assert.deepEqual(legacyPeriodOf(resolveAnalyticsPeriod(s, preset, NOW)), analytics.resolvePeriod(s, kind, NOW), preset);
    }
    // The other presets: a custom range of the same dates.
    const week = resolveAnalyticsPeriod(s, 'lastWeek', NOW);
    assert.deepEqual(legacyPeriodOf(week), { kind: 'custom', from: week.from, to: week.to });
  });

  it('for every preset, three currencies and the one-time toggle: total, every category and one-time equal the old functions', () => {
    for (const preset of PRESETS) {
      for (const currency of CURRENCIES) {
        for (const includeOneTime of [true, false]) {
          const period = resolvePeriodChoice(s, { preset }, NOW);
          const view = spendingView(s, { period, alignment: 'elapsed', currency, includeOneTime });
          const label = `${preset} ${currency} ${includeOneTime}`;
          if (view.shares.total === null) {
            assert.ok(period.notes.includes('before_tracking'), label);
            continue;
          }
          // Old screen: the same dates on the old period system.
          const old: analytics.AnalyticsQuery = { period: legacyPeriodOf(period), currency, includeOneTime };
          const oldTotals = analytics.periodTotals(s, old);
          assert.equal(view.shares.total, oldTotals.expense, `${label} total`);
          const oldCategories = analytics.spendingBreakdown(s, old).categories;
          assert.deepEqual(
            view.shares.rows.map((r) => [r.categoryId, r.amount]).sort(),
            oldCategories.map((c) => [c.categoryId, c.amount]).sort(),
            `${label} categories`
          );
          assert.equal(view.oneTime.amount, analytics.oneTimeSpend(s, old), `${label} one-time`);
          assert.equal(view.comparison.current.metrics.income.value, oldTotals.income, `${label} income`);
        }
      }
    }
  });

  it('every breakdown adds up to the spending card exactly (daily bars, accounts, currencies, sources)', () => {
    for (const preset of PRESETS) {
      for (const currency of CURRENCIES) {
        const view = spendingView(s, { period: resolvePeriodChoice(s, { preset }, NOW), alignment: 'elapsed', currency, includeOneTime: true });
        if (view.shares.total === null) continue;
        const total = view.shares.total;
        const label = `${preset} ${currency}`;
        assert.equal(sumIn(view.trend.bars.map((b) => b.amount), currency), total, `${label} trend`);
        assert.equal(sumIn(view.byAccount.map((r) => r.value), currency), total, `${label} accounts`);
        assert.equal(sumIn(view.byCurrency.map((r) => r.value), currency), total, `${label} currencies`);
        assert.equal(sumIn([view.fromFunds!, view.fromFree!], currency), total, `${label} sources`);
        assert.equal(sumIn(view.shares.rows.map((r) => r.amount), currency), total, `${label} categories`);
        assert.equal(findNonFinite(view), null, label);
      }
    }
  });

  it('the one documented difference: a row dated after today counts in the old month total, not in the measured one', () => {
    const future = { ...s, transactions: [...s.transactions, expense('later', 500, '2026-11-29')] };
    const period = resolveAnalyticsPeriod(future, 'month', NOW);
    const view = spendingView(future, { period, alignment: 'elapsed', currency: 'EGP', includeOneTime: true });
    const old = analytics.periodTotals(future, { period: legacyPeriodOf(period), currency: 'EGP', includeOneTime: true });
    assert.equal(old.expense - view.shares.total!, 500);
  });
});

describe('«فلوسك راحت فين»: shares over all categories, the same as «بصمة الإنفاق»', () => {
  const s = richWorld();

  it('shares add up to exactly 100.0 %; the donut slices are the footprint; a category has the same % everywhere', () => {
    for (const preset of PRESETS) {
      for (const currency of CURRENCIES) {
        const view = spendingView(s, { period: resolvePeriodChoice(s, { preset }, NOW), alignment: 'elapsed', currency, includeOneTime: true });
        if (view.shares.rows.length === 0) continue;
        assert.equal(view.shares.rows.reduce((t, r) => t + r.tenths, 0), 1000, `${preset} ${currency}`);
        const footprint = spendingFootprint(view.comparison);
        assert.deepEqual(view.footprint, footprint);
        assert.equal(footprint.segments.reduce((t, x) => t + x.tenths, 0), 1000);
        for (const seg of footprint.segments.filter((x) => x.key !== 'rest')) {
          assert.equal(seg.tenths, view.shares.rows.find((r) => r.categoryId === seg.key)!.tenths);
        }
        const rest = footprint.segments.find((x) => x.key === 'rest');
        if (rest) assert.equal(rest.tenths, view.shares.rows.slice(4).reduce((t, r) => t + r.tenths, 0));
      }
    }
  });

  it('largest remainder: exact, stable, zeros stay zero', () => {
    assert.deepEqual(largestRemainder([1, 1, 1]), [334, 333, 333]);
    assert.deepEqual(largestRemainder([3, 1]), [750, 250]);
    assert.deepEqual(largestRemainder([0, 0]), [0, 0]);
    assert.equal(largestRemainder([7.13, 2.2, 0.01, 99.9]).reduce((a, b) => a + b, 0), 1000);
  });
});

describe('«الإنفاق»: trend, A vs B, the one-time toggle', () => {
  const s = richWorld();

  it('day by day up to today (a day without spending is a real 0), the average = the card\'s average daily spending', () => {
    const view = spendingView(s, { period: resolveAnalyticsPeriod(s, 'month', NOW), alignment: 'elapsed', currency: 'EGP', includeOneTime: true });
    assert.equal(view.trend.unit, 'day');
    assert.equal(view.trend.bars.length, 26);
    assert.equal(view.trend.bars[0].key, '2026-11-01');
    assert.equal(view.trend.bars.at(-1)!.key, '2026-11-26');
    assert.equal(view.trend.bars.find((b) => b.key === '2026-11-02')!.amount, 0);
    assert.equal(view.trend.average, view.comparison.current.metrics.avgDailySpending.value);
  });

  it(`beyond ${MAX_DAILY_BARS} days: weeks from Saturday, clipped to the measured range`, () => {
    const view = spendingView(s, { period: resolveAnalyticsPeriod(s, '6m', NOW), alignment: 'elapsed', currency: 'EGP', includeOneTime: true });
    assert.equal(view.trend.unit, 'week');
    assert.equal(view.trend.bars[0].from, '2026-06-01');
    assert.equal(view.trend.bars.at(-1)!.to, '2026-11-26');
  });

  it('A vs B for one category; a chosen A changes the comparison, not the B figures', () => {
    const period = resolveAnalyticsPeriod(s, 'month', NOW);
    const byDefault = spendingView(s, { period, alignment: 'full', currency: 'EGP', includeOneTime: true });
    assert.deepEqual(byDefault.comparison.previous!.period.from, previousAnalyticsPeriod(s, period)!.from);
    const groceries = compareCategory(byDefault, 'cat-essentials-groceries');
    assert.deepEqual([groceries.previous.value, groceries.current.value], [3_000, 3_300]);
    const july = resolveAnalyticsPeriod(s, 'custom', NOW, { from: '2026-07-01', to: '2026-07-31' });
    const chosen = spendingView(s, { period, alignment: 'full', currency: 'EGP', includeOneTime: true, previous: july });
    const rent = compareCategory(chosen, 'cat-essentials-rent');
    assert.deepEqual([rent.previous.value, rent.current.value], [21_500.25, 0]);
    assert.equal(chosen.shares.total, byDefault.shares.total);
    // Spent in neither side: a real 0 on both tracked sides.
    assert.deepEqual([compareCategory(byDefault, 'nothing').previous.value, compareCategory(byDefault, 'nothing').current.value], [0, 0]);
  });

  it('the one-time toggle: spending without it, the one-time figure whatever it says', () => {
    const period = resolveAnalyticsPeriod(s, 'month', NOW);
    const on = spendingView(s, { period, alignment: 'elapsed', currency: 'EGP', includeOneTime: true });
    const off = spendingView(s, { period, alignment: 'elapsed', currency: 'EGP', includeOneTime: false });
    assert.equal(on.oneTime.amount, 700);
    assert.equal(off.oneTime.amount, 700);
    assert.equal(on.shares.total! - off.shares.total!, 700);
    assert.equal(on.oneTime.ofTotal, off.oneTime.ofTotal);
  });
});

describe('Overview monthly net worth view: the monthly snapshots, gaps kept', () => {
  it('equals the old «صافي الثروة عبر الوقت» points; months without a snapshot are gaps; at most 24', () => {
    const s = richWorld();
    const snapshots = [
      { month: '2026-08', total: 50_000 },
      { month: '2026-10', total: 60_000 },
    ].map(({ month, total }) => ({ id: `nw-${month}`, month, netWorthEGP: total, liquidEGP: total, holdingsEGP: 0, rateSnapshotId: s.rateSnapshots[0].id, takenAt: `${month}-28T10:00:00.000Z`, updatedAt: `${month}-28T10:00:00.000Z`, estimated: month === '2026-08' }));
    const w = { ...s, netWorthSnapshots: snapshots };
    const o = overview(w, { period: resolveAnalyticsPeriod(w, 'month', NOW), alignment: 'elapsed', currency: 'EGP', now: NOW, dailyStore: null });
    const old = analytics.netWorthSeries(w, { location: 'all', currency: 'EGP', includeEstimated: true, now: NOW }).points;
    assert.deepEqual(o.monthly.map((m) => m.month), ['2026-08', '2026-09', '2026-10', '2026-11']);
    assert.equal(o.monthly[1].value, null);
    for (const m of o.monthly.filter((x) => x.value !== null)) assert.equal(m.value, old.find((p) => p.month === m.month)!.total);
    assert.equal(o.monthly.at(-1)!.live, true);
    assert.ok(o.monthly.length <= 24);
  });
});

describe('Phase 3 geometry and copy', () => {
  it('donut: slices cover the full circle in order; a single value is a full ring; taps find the slice', () => {
    const slices = donutSlices([50, 30, 20], 100, 100, 90, 60);
    assert.ok(Math.abs(slices.at(-1)!.end - 2 * Math.PI) < 1e-9);
    assert.ok(slices.every((s) => s.d.length > 0));
    assert.equal(sliceAt(100, 15, 100, 100, 90, 60, slices), 0); // top, just right of 12 o'clock → first slice
    assert.equal(sliceAt(100, 100, 100, 100, 90, 60, slices), null); // the hole
    assert.equal(sliceAt(100, 185, 100, 100, 90, 60, slices), 1); // bottom (180°) → second (180°–288°)
    const one = donutSlices([10], 100, 100, 90, 60);
    assert.equal(one[0].d.split('M').length - 1, 2);
    assert.deepEqual(donutSlices([0, 0], 100, 100, 90, 60).map((s) => s.d), ['', '']);
  });

  it('bars: zero stays zero, the reference line sits at its value', () => {
    const b = singleBars([0, 100, 50], 340, 140, 50);
    assert.equal(b.bars[0].h, 0);
    assert.ok(b.refY !== null && Math.abs(b.refY - b.bars[2].y) < 1e-9);
    assert.equal(singleBars([1], 340, 140, null).refY, null);
  });

  it('copy', () => {
    assert.equal(sui.trendTitle('day'), 'المصروف يوم بيوم');
    assert.equal(strip(sui.averageLabel('day', 231.35, 'EGP')!), 'المتوسط: ج.م 231.35 في اليوم');
    assert.equal(sui.averageLabel('week', null, 'EGP'), null);
    assert.match(strip(sui.oneTimeLine(700, 0.116, 'EGP')), /^لمرة واحدة: ج\.م 700 \(11\.6% من مصروف الفترة\)$/);
    assert.equal(sui.oneTimeLine(0, null, 'EGP'), 'مفيش مصاريف لمرة واحدة في الفترة دي.');
    assert.equal(strip(sui.sourcesLine(1_500, 4_515, 'EGP')!), 'ج.م 1,500 من صناديق · ج.م 4,515 من فلوسك الحرة');
  });
});
