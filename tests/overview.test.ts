// Phase 2 of docs/architecture/PROFESSIONAL_ANALYTICS_AND_COMPARISON_DESIGN.md: the Overview tab's numbers, the
// net worth daily series, the chart geometry and the UI copy. Synthetic data only. Run with: npm run test:logic
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as ui from '@/components/analytics/overviewUi';
import { indexAt, seriesLayout } from '@/components/analytics/seriesLayout';
import * as analytics from '@/store/analytics';
import { compareValues, comparePeriods, type MetricValue } from '@/store/comparison';
import { netWorthDailySeries, pointValues } from '@/store/history';
import { overview } from '@/store/overview';
import { resolveAnalyticsPeriod, resolvePeriodChoice } from '@/store/periods';
import * as sel from '@/store/selectors';
import type { Receivable } from '@/store/types';
import { account, baseState, expense, findNonFinite, flowWorld, income, recordOn, T0 } from './fixtures/synthetic';

const NOW = new Date(2026, 10, 26, 12, 0);
const v = (value: number | null): MetricValue => (value === null ? { value: null, quality: 'unavailable', reason: 'no_previous' } : { value, quality: 'recorded' });
const strip = (text: string) => text.replace(/[⁦-⁩‎]/g, '');

// --- Decision 3 ---------------------------------------------------------------------------------------------------

describe('decision 3: "stable" only changes the arrow and colour — the change itself is always shown', () => {
  it('a change under 1 % keeps its real delta and percentage in the engine', () => {
    const c = compareValues(v(1_000), v(1_009), { kind: 'amount', goodWhen: 'up', currency: 'EGP' });
    assert.equal(c.direction, 'flat');
    assert.equal(c.delta, 9);
    assert.equal(c.pct, 0.009);
    assert.equal(c.tone, 'neutral');
  });

  it('the card line says «مستقر» AND shows the amount (never hidden, never zero)', () => {
    const line = ui.changeLine(compareValues(v(1_000), v(1_009), { kind: 'amount', goodWhen: 'up', currency: 'EGP' }), 'EGP');
    assert.equal(strip(line.text), 'مستقر · ج.م +9 (0.9%)');
    assert.equal(line.color, 'textSecondary');
    const tiny = ui.changeLine(compareValues(v(100_000), v(100_000.5), { kind: 'amount', goodWhen: 'up', currency: 'EGP' }), 'EGP');
    assert.equal(strip(tiny.text), 'مستقر · ج.م +0.5');
    const rate = ui.changeLine(compareValues(v(0.4), v(0.4004), { kind: 'ratio', goodWhen: 'up' }), 'EGP');
    assert.equal(strip(rate.text), 'مستقر · +0.04 نقطة');
  });
});

describe('overview copy: change lines, reasons, quality, periods', () => {
  const amount = (p: number | null, c: number | null, goodWhen: 'up' | 'none' = 'up') => ui.changeLine(compareValues(v(p), v(c), { kind: 'amount', goodWhen, currency: 'EGP' }), 'EGP');

  it('up / down with percentage and amount, coloured by tone; spending is neutral', () => {
    assert.equal(strip(amount(1_000, 1_250).text), '↑ 25% · ج.م +250');
    assert.equal(amount(1_000, 1_250).color, 'primary700');
    assert.equal(amount(1_000, 750).color, 'warning');
    assert.equal(amount(1_000, 1_250, 'none').color, 'textSecondary');
  });

  it('zero base, sign flips, missing sides: words instead of percentages', () => {
    assert.equal(strip(amount(0, 500).text), 'جديد · ج.م +500');
    assert.equal(strip(amount(-500, 300).text), 'اتحوّل من سالب لموجب · ج.م +800');
    assert.equal(strip(amount(500, -300).text), 'اتحوّل من موجب لسالب · ج.م −800');
    assert.deepEqual(amount(null, 300), { text: 'مفيش فترة قبلها للمقارنة', color: 'textMuted' });
    const noIncomeBefore = compareValues({ value: null, quality: 'unavailable', reason: 'no_income' }, v(0.4), { kind: 'ratio', goodWhen: 'up' });
    assert.equal(ui.changeLine(noIncomeBefore, 'EGP').text, 'مفيش دخل في الفترة اللي فاتت');
    assert.equal(ui.reasonText('before_tracking', { trackingStart: '2026-08-05' }).startsWith('البيانات بتبدأ من'), true);
    assert.equal(ui.reasonText('not_recorded', { dailySince: '2026-11-20' }).includes('السجل اليومي من'), true);
  });

  it('percentage points for rates, small values keep digits', () => {
    assert.equal(strip(ui.pointsPhrase(0.042)), '+4.2 نقطة');
    assert.equal(strip(ui.pointsPhrase(-0.0123)), '−1.2 نقطة');
    assert.equal(strip(ui.pointsPhrase(0.0004)), '+0.04 نقطة');
    assert.equal(ui.pointsPhrase(0.00001), 'أقل من 0.01 نقطة');
    assert.equal(ui.pointsPhrase(0), '0 نقطة');
  });

  it('never prints NaN or Infinity, whatever the inputs', () => {
    const pool = [0, 0.001, -0.004, 1, -1, 1e-12, 1e12, -1e12, 123.45, null];
    for (const p of pool) for (const c of pool) for (const kind of ['amount', 'ratio'] as const) {
      const line = ui.changeLine(compareValues(v(p), v(c), { kind, goodWhen: 'up', currency: 'EGP' }), 'EGP');
      assert.doesNotMatch(line.text, /NaN|Infinity|undefined/);
    }
  });

  it('quality labels: nothing for recorded, words otherwise', () => {
    assert.equal(ui.qualityLabel('recorded'), null);
    assert.equal(ui.qualityLabel('recorded', true), 'اتعدّل بعد التسجيل');
    assert.equal(ui.qualityLabel('reconstructed'), 'محسوب من المعاملات');
    assert.equal(ui.qualityLabel('estimated'), 'تقديري');
    assert.equal(ui.qualityLabel('unavailable'), 'مش متاح');
  });

  it('the pill and the line under it (presets, custom, pay cycle)', () => {
    const s = baseState({ trackingStartDate: '2020-01-01' });
    const month = resolveAnalyticsPeriod(s, 'month', NOW);
    assert.equal(ui.pillLabel(month), 'الشهر ده ▾');
    assert.match(strip(ui.periodLine(month)), /لسه شغال$/);
    assert.equal(ui.pillLabel(resolveAnalyticsPeriod(s, 'lastMonth', NOW)), 'الشهر اللي فات ▾');
    assert.doesNotMatch(strip(ui.periodLine(resolveAnalyticsPeriod(s, 'lastMonth', NOW))), /لسه شغال/);
    assert.equal(ui.pillLabel(resolveAnalyticsPeriod(s, 'custom', NOW, { from: '2026-11-01', to: '2026-11-10' })).endsWith(' ▾'), true);
    const noSalary = resolveAnalyticsPeriod(s, 'payCycle', NOW);
    assert.match(ui.periodLine(noSalary), /لسه مفيش راتب متسجّل/);
    const two = { ...s, accounts: [account('a-egp', 'EGP', 0)], transactions: [income('a', '2026-11-10'), income('b', '2026-11-14')] };
    const cycle = resolveAnalyticsPeriod(two, 'payCycle', NOW);
    assert.match(ui.periodLine(cycle), /الدورة دي فيها راتبين/);
    assert.match(ui.periodLine(cycle), /17 يوم/);
    assert.deepEqual(Object.keys(ui.PRESET_LABELS).sort(), [...ui.PRESET_ORDER].sort());
  });

  it('notes: missing and partial history in words', () => {
    assert.match(ui.noteTexts(['previous_untracked'], '2026-11-01')[0], /^البيانات المتاحة بتبدأ من .+ مفيش بيانات كفاية لمقارنة دقيقة بالفترة اللي قبلها\.$/);
    assert.match(ui.noteTexts(['previous_partly_untracked'], '2026-10-15')[0], /المقارنة مش كاملة/);
    assert.equal(ui.noteTexts(['aligned_elapsed']).length, 0);
  });
});

// --- Chart geometry ---------------------------------------------------------------------------------------------------

describe('net worth chart geometry: gaps stay gaps', () => {
  const pts = (values: (number | null)[]) => values.map((value) => ({ value }));

  it('a gap splits the line (nothing drawn across it); a lone day is a dot', () => {
    const layout = seriesLayout(pts([100, 110, null, null, 120, null, 130, 125]), 200, 100);
    assert.equal(layout.lines.length, 2);
    assert.equal(layout.dots.length, 1);
    assert.deepEqual(layout.ys.map((y) => y === null), [false, false, true, true, false, true, false, false]);
    // No path point at a gap's x.
    const gapX = layout.xs[2].toFixed(1);
    assert.ok(layout.lines.every((d) => !d.includes(`${gapX} `)));
    assert.ok(layout.areas.every((d) => d.endsWith('Z')));
  });

  it('no values → nothing drawn (never zeros); a flat series sits mid-height', () => {
    assert.equal(seriesLayout(pts([null, null]), 200, 100).hasValues, false);
    const flat = seriesLayout(pts([500, 500, 500]), 200, 100);
    assert.ok(flat.ys.every((y) => y !== null && Math.abs(y - 50) < 1e-9));
    const negative = seriesLayout(pts([-300, -100]), 200, 100);
    assert.ok(negative.ys[0]! > negative.ys[1]!);
  });

  it('the touched day is the nearest one, clamped to the ends', () => {
    assert.equal(indexAt(-50, 10, 200), 0);
    assert.equal(indexAt(500, 10, 200), 9);
    assert.equal(indexAt(100, 11, 200), 5);
    assert.equal(indexAt(10, 1, 200), 0);
  });
});

// --- Daily series ------------------------------------------------------------------------------------------------------

describe('net worth daily series: recorded days and today only', () => {
  const s = flowWorld();
  const store = recordOn(s, '2026-11-24', recordOn(s, '2026-11-21', recordOn(s, '2026-11-20')));
  const series = netWorthDailySeries(s, store, { from: '2026-11-01', to: '2026-11-30' }, 'EGP', NOW);

  it('one point per day up to today; unrecorded days are null (gaps), today is live', () => {
    assert.equal(series.length, 26);
    assert.deepEqual(series.filter((p) => p.value !== null).map((p) => p.date), ['2026-11-20', '2026-11-21', '2026-11-24', '2026-11-26']);
    assert.equal(series.at(-1)!.source, 'live');
    assert.equal(series.at(-1)!.value, sel.netWorth(s, 'EGP'));
    assert.ok(series.filter((p) => p.source === 'none').every((p) => p.value === null));
  });

  it('each recorded day equals the slower positionAt path (D3 balances from the ledger), after a backdated insert too', () => {
    for (const date of ['2026-11-20', '2026-11-21', '2026-11-24']) {
      assert.equal(series.find((p) => p.date === date)!.value, pointValues(s, store, date, 'EGP', NOW).metrics.netWorth.value, date);
    }
    const backdated = { ...s, transactions: [...s.transactions, expense('late', 250, '2026-11-19')] };
    const again = netWorthDailySeries(backdated, store, { from: '2026-11-01', to: '2026-11-30' }, 'EGP', NOW);
    const day = again.find((p) => p.date === '2026-11-20')!;
    assert.equal(day.value, pointValues(backdated, store, '2026-11-20', 'EGP', NOW).metrics.netWorth.value);
    assert.equal(day.ledgerDiverged, true);
    assert.equal(day.value, series.find((p) => p.date === '2026-11-20')!.value! - 250);
  });

  it('memoized on the data; a range before tracking is clamped; no history → only today', () => {
    assert.equal(netWorthDailySeries(s, store, { from: '2026-11-01', to: '2026-11-30' }, 'EGP', NOW), series);
    assert.equal(netWorthDailySeries(s, store, { from: '2026-07-01', to: '2026-08-02' }, 'EGP', NOW).length, 2);
    const none = netWorthDailySeries(s, null, { from: '2026-11-01', to: '2026-11-30' }, 'EGP', NOW);
    assert.deepEqual(none.filter((p) => p.value !== null).map((p) => p.date), ['2026-11-26']);
  });
});

// --- Overview ------------------------------------------------------------------------------------------------------

describe('overview: composed from the engine, nothing invented', () => {
  const s = flowWorld();
  const store = recordOn(s, '2026-11-20');
  const period = resolveAnalyticsPeriod(s, 'month', NOW);
  const data = overview(s, { period, alignment: 'elapsed', currency: 'EGP', now: NOW, dailyStore: store });

  it('flows are exactly comparePeriods; point metrics at the two measured ends (today vs 26 Oct)', () => {
    assert.deepEqual(data.comparison, comparePeriods(s, { current: period, alignment: 'elapsed', currency: 'EGP', includeOneTime: true }));
    assert.equal(data.endDate, '2026-11-26');
    assert.equal(data.previousEndDate, '2026-10-26');
    assert.equal(data.current.at.source, 'live');
    assert.equal(data.previous!.at.source, 'ledger');
  });

  it('the money position: live figures equal the selectors; reserved + free = liquid (no double counting)', () => {
    const m = data.current.metrics;
    assert.equal(m.netWorth.value, sel.netWorth(s, 'EGP'));
    assert.equal(m.liquid.value, 48_485);
    assert.equal(m.reserved.value, 1_300);
    assert.equal(m.freeMoney.value, 47_185);
    assert.equal(m.nonLiquid.value, sel.holdingsTotal(s, 'EGP'));
    assert.equal(m.totalAssets.value, m.liquid.value! + m.nonLiquid.value!);
    assert.equal(m.reserved.value! + m.freeMoney.value!, m.liquid.value);
    assert.equal(m.freeMoney.value, analytics.runway(s, 'EGP', NOW).unassigned.amount);
  });

  it('a previous end without a daily record: net worth estimated, reserved / free money unavailable (never 0)', () => {
    assert.equal(data.point.netWorth.quality, 'estimated');
    assert.equal(data.previous!.metrics.reserved.value, null);
    assert.equal(data.point.reserved.delta, null);
    assert.equal(ui.changeLine(data.point.reserved, 'EGP', { dailySince: data.dailySince }).text.startsWith('مفيش تسجيل لليوم ده'), true);
  });

  it('a previous end that WAS recorded is compared as recorded', () => {
    const custom = resolveAnalyticsPeriod(s, 'custom', NOW, { from: '2026-11-21', to: '2026-11-26' });
    const withPrev = overview(s, { period: custom, alignment: 'elapsed', currency: 'EGP', now: NOW, dailyStore: store });
    assert.equal(withPrev.previousEndDate, '2026-11-20');
    assert.equal(withPrev.point.netWorth.quality, 'recorded');
    assert.equal(withPrev.point.reserved.quality, 'recorded');
    assert.notEqual(withPrev.point.netWorth.delta, null);
  });

  it('series and history start; receivables only as a separate current line, never in net worth', () => {
    assert.equal(data.dailySince, '2026-11-20');
    assert.equal(data.series.length, 26);
    assert.equal(data.openReceivables, null);
    const owed: Receivable = { id: 'r1', label: 'الشركة', kind: 'salary', forMonth: '2026-11', amount: 6_000, currency: 'EGP', createdAt: T0, updatedAt: T0 };
    const withOwed = { ...s, receivables: [owed] };
    const current = overview(withOwed, { period, alignment: 'elapsed', currency: 'EGP', now: NOW, dailyStore: store });
    assert.equal(current.openReceivables, 6_000);
    assert.equal(current.current.metrics.netWorth.value, data.current.metrics.netWorth.value);
    const past = overview(withOwed, { period: resolveAnalyticsPeriod(withOwed, 'lastMonth', NOW), alignment: 'elapsed', currency: 'EGP', now: NOW, dailyStore: store });
    assert.equal(past.openReceivables, null);
  });

  it('no NaN / Infinity anywhere, for every preset, with and without history, in three currencies', () => {
    for (const preset of ['thisWeek', 'lastWeek', 'month', 'lastMonth', '3m', '6m', '12m', 'thisYear', 'lastYear', 'sinceStart', 'payCycle'] as const) {
      for (const currency of ['EGP', 'SAR', 'USD']) {
        for (const dailyStore of [null, store]) {
          const p = resolvePeriodChoice(s, { preset }, NOW);
          assert.equal(findNonFinite(overview(s, { period: p, alignment: 'elapsed', currency, now: NOW, dailyStore })), null, `${preset} ${currency}`);
        }
      }
    }
  });

  it('an empty data set: unavailable or real zeros, never NaN', () => {
    const empty = baseState();
    const o = overview(empty, { period: resolveAnalyticsPeriod(empty, 'month', NOW), alignment: 'elapsed', currency: 'EGP', now: NOW, dailyStore: null });
    assert.equal(findNonFinite(o), null);
    assert.equal(o.comparison.metrics.savingsRate.current.reason, 'no_income');
    assert.equal(o.current.metrics.netWorth.value, 0);
  });

  it('resolvePeriodChoice previews a draft cycle start without saving it', () => {
    const w = { ...s, transactions: [...s.transactions, income('s-late', '2026-11-12')] };
    assert.equal(resolvePeriodChoice(w, { preset: 'payCycle' }, NOW).from, '2026-11-01');
    assert.equal(resolvePeriodChoice(w, { preset: 'payCycle', payCycleStart: '2026-11-25' }, NOW).from, '2026-11-25');
    const saved = { ...w, settings: { ...w.settings, payCycleStartOverride: '2026-11-25' } };
    assert.equal(resolvePeriodChoice(saved, { preset: 'payCycle', payCycleStart: null }, NOW).from, '2026-11-01');
    assert.equal(w.settings.payCycleStartOverride, undefined);
  });
});
