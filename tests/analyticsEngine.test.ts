// Phase 1b of docs/architecture/PROFESSIONAL_ANALYTICS_AND_COMPARISON_DESIGN.md: the period system, the comparison
// engine (Mode A) and point-in-time positions (Mode B). Synthetic data only. Run with: npm run test:logic
/// <reference types="node" />
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import * as analytics from '@/store/analytics';
import { createBackup, openBackup, parseBackup, serializeBackup } from '@/store/backup';
import { compareValues, comparePeriods, periodSide, weakerQuality, type MetricValue } from '@/store/comparison';
import { emptyDailyStore, syncDailyStore, type DailySnapshotStore } from '@/store/dailySnapshots';
import { CATEGORY_IDS, DEFAULT_CATEGORIES } from '@/store/defaultCategories';
import { FinanceValidationError } from '@/store/errors';
import { compareDates, positionAt, valuePosition, type PriceSet } from '@/store/history';
import { LATEST_V8_STEP } from '@/store/migrateV8';
import { LATEST_V9_STEP } from '@/store/migrateV9';
import { LATEST_V10_STEP } from '@/store/migrateV10';
import * as ops from '@/store/operations';
import {
  alignToElapsed,
  coverageOf,
  DEFAULT_PERIOD_PRESET,
  isRememberablePreset,
  MIN_CYCLE_DAYS,
  payCycles,
  PERIOD_PRESETS,
  preferredPreset,
  previousAnalyticsPeriod,
  resolveAnalyticsPeriod,
  weekStart,
  type AnalyticsPeriod,
} from '@/store/periods';
import { snapshotForNow } from '@/store/rateSnapshots';
import * as sel from '@/store/selectors';
import type { Account, FinanceState, IncomeExpenseTransaction, Receivable, ReservationMovement, Transaction } from '@/store/types';
import { daysBetween, fromDateKey, shiftDate, toDateKey } from '@/utils/dates';
import { makeSnapshot } from '@/utils/rates';

const T0 = '2026-08-01T08:00:00.000Z';
// 26 Nov 2026, noon local time.
const NOW = new Date(2026, 10, 26, 12, 0);
const ctxAt = (now: Date) => ({ now: () => now, newId: () => `id-${Math.random()}` });

const PER_USD = { USD: 1, EGP: 50, SAR: 4 }; // 1 SAR = 12.5 EGP
const RATES = makeSnapshot({ base: 'USD', perUsd: PER_USD }, { takenAt: T0, source: 'manual' });

function baseState(overrides: Partial<FinanceState['settings']> = {}): FinanceState {
  return {
    rateSnapshots: [RATES],
    accounts: [],
    categories: DEFAULT_CATEGORIES,
    transactions: [],
    funds: [],
    reservationMovements: [],
    unresolvedMovements: [],
    holdings: [],
    liabilities: [],
    recurringRules: [],
    monthlyPlans: [],
    netWorthSnapshots: [],
    actionDismissals: [],
    monthlyReviews: [],
    receivables: [],
    settings: {
      rates: { base: 'USD', perUsd: PER_USD, updatedAt: T0, source: 'manual' },
      enabledCurrencies: ['EGP', 'SAR', 'USD'],
      v8Step: LATEST_V8_STEP,
      v9Step: LATEST_V9_STEP,
      v10Step: LATEST_V10_STEP,
      reportingCurrency: 'EGP',
      planCurrency: 'EGP',
      goldPrice24kEGP: 6000,
      goldPrice21kEGP: 5250,
      goldPriceUpdatedAt: T0,
      trackingStartDate: '2026-08-01',
      deviceId: 'test-device',
      ...overrides,
    },
    tombstones: [],
  };
}

const account = (id: string, currency: string, openingBalance: number, extra: Partial<Account> = {}): Account => ({
  id,
  name: id,
  type: 'bank',
  currency,
  openingBalance,
  country: currency === 'SAR' ? 'SA' : 'EG',
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});

const tx = (id: string, type: 'income' | 'expense', amount: number, date: string, extra: Partial<IncomeExpenseTransaction> = {}): IncomeExpenseTransaction => ({
  id,
  type,
  amount,
  currency: 'EGP',
  accountId: 'a-egp',
  categoryId: type === 'income' ? CATEGORY_IDS.salary : 'cat-essentials-groceries',
  date,
  rateSnapshotId: RATES.id,
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});
const salary = (id: string, date: string, amount = 20_000, extra: Partial<IncomeExpenseTransaction> = {}) => tx(id, 'income', amount, date, extra);
const spend = (id: string, amount: number, date: string, extra: Partial<IncomeExpenseTransaction> = {}) => tx(id, 'expense', amount, date, extra);

const movement = (id: string, kind: ReservationMovement['kind'], amount: number, date: string, extra: Partial<ReservationMovement> = {}): ReservationMovement => ({
  id,
  fundId: 'f-home',
  accountId: 'a-egp',
  amount,
  kind,
  date,
  rateSnapshotId: RATES.id,
  updatedAt: T0,
  ...extra,
});

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

// Every number either a finite number or null.
function assertNoNaN(value: unknown, path = 'value') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} = ${value}`);
  else if (value && typeof value === 'object' && !(value instanceof Map)) for (const [k, v] of Object.entries(value)) assertNoNaN(v, `${path}.${k}`);
}

const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s);
const resolve = (state: FinanceState, preset: Parameters<typeof resolveAnalyticsPeriod>[1], now: Date, custom?: { from: string; to: string }) =>
  resolveAnalyticsPeriod(state, preset, now, custom);
const range = (p: AnalyticsPeriod | null) => (p ? [p.from, p.to] : null);

// --- Periods ------------------------------------------------------------------------------------------------------

describe('periods: presets', () => {
  const s = baseState({ trackingStartDate: '2020-01-01' });

  it('weeks start on Saturday (D5), whatever the weekday, across month and year ends', () => {
    // 2026-11-28 is a Saturday.
    for (const [date, start] of [
      ['2026-11-28', '2026-11-28'],
      ['2026-11-29', '2026-11-28'],
      ['2026-12-04', '2026-11-28'],
      ['2026-11-27', '2026-11-21'],
      ['2027-01-01', '2026-12-26'],
    ]) {
      assert.equal(weekStart(date), start, date);
      assert.equal(fromDateKey(weekStart(date)).getDay(), 6);
    }
    assert.deepEqual(range(resolve(s, 'thisWeek', at(2027, 1, 1))), ['2026-12-26', '2027-01-01']);
    assert.deepEqual(range(resolve(s, 'lastWeek', at(2027, 1, 1))), ['2026-12-19', '2026-12-25']);
    assert.deepEqual(range(previousAnalyticsPeriod(s, resolve(s, 'thisWeek', at(2027, 1, 1)))), ['2026-12-19', '2026-12-25']);
  });

  it('calendar presets and their previous periods (incl. January and year ends)', () => {
    const jan = at(2027, 1, 15);
    const cases: [Parameters<typeof resolve>[1], string[], string[] | null][] = [
      ['month', ['2027-01-01', '2027-01-31'], ['2026-12-01', '2026-12-31']],
      ['lastMonth', ['2026-12-01', '2026-12-31'], ['2026-11-01', '2026-11-30']],
      ['3m', ['2026-11-01', '2027-01-31'], ['2026-08-01', '2026-10-31']],
      ['6m', ['2026-08-01', '2027-01-31'], ['2026-02-01', '2026-07-31']],
      ['12m', ['2026-02-01', '2027-01-31'], ['2025-02-01', '2026-01-31']],
      ['thisYear', ['2027-01-01', '2027-12-31'], ['2026-01-01', '2026-12-31']],
      ['lastYear', ['2026-01-01', '2026-12-31'], ['2025-01-01', '2025-12-31']],
      ['sinceStart', ['2020-01-01', '2027-01-15'], null],
    ];
    for (const [preset, now, prev] of cases) {
      const p = resolve(s, preset, jan);
      assert.deepEqual(range(p), now, preset);
      assert.deepEqual(range(previousAnalyticsPeriod(s, p)), prev, `${preset} previous`);
    }
  });

  it('the default is this calendar month; only presets (not custom dates) are remembered (D6)', () => {
    assert.equal(DEFAULT_PERIOD_PRESET, 'month');
    assert.equal(preferredPreset(s), 'month');
    assert.equal(preferredPreset(baseState({ analyticsPeriod: '6m' })), '6m');
    assert.equal(preferredPreset(baseState({ analyticsPeriod: 'custom' })), 'month');
    assert.equal(preferredPreset(baseState({ analyticsPeriod: 'nonsense' })), 'month');
    assert.deepEqual(PERIOD_PRESETS.filter(isRememberablePreset), PERIOD_PRESETS.filter((p) => p !== 'custom'));
  });

  it('custom: as given (swapped if reversed); previous = the same number of days right before', () => {
    const p = resolve(s, 'custom', NOW, { from: '2026-11-10', to: '2026-11-01' });
    assert.deepEqual(range(p), ['2026-11-01', '2026-11-10']);
    assert.deepEqual(range(previousAnalyticsPeriod(s, p)), ['2026-10-22', '2026-10-31']);
  });

  it('leap years: February has 29 days in 2028, and an in-progress 31 March aligns to the end of February', () => {
    const feb = resolve(s, 'month', at(2028, 2, 10));
    assert.deepEqual(range(feb), ['2028-02-01', '2028-02-29']);
    assert.equal(coverageOf(s, feb).totalDays, 29);
    for (const [year, end] of [[2028, '2028-02-29'], [2027, '2027-02-28']] as const) {
      const march = resolve(s, 'month', at(year, 3, 31));
      const aligned = alignToElapsed(s, march, previousAnalyticsPeriod(s, march)!);
      assert.deepEqual(range(aligned), [`${year}-02-01`, end]);
    }
  });

  it('time of day and time zone: only the LOCAL calendar date of `now` matters (one second either side of midnight)', () => {
    const before = at(2026, 11, 30, 23, 59, 59);
    const after = at(2026, 12, 1, 0, 0, 1);
    assert.deepEqual(range(resolve(s, 'month', before)), ['2026-11-01', '2026-11-30']);
    assert.deepEqual(range(resolve(s, 'month', after)), ['2026-12-01', '2026-12-31']);
    assert.equal(resolve(s, 'month', before).today, '2026-11-30');
    // Day counts never depend on DST (Egypt changes clocks in late April / late October).
    assert.equal(coverageOf(s, resolve(s, 'month', at(2026, 4, 30, 23, 30))).totalDays, 30);
    assert.equal(coverageOf(s, resolve(s, 'month', at(2026, 10, 31, 0, 30))).totalDays, 31);
    assert.equal(daysBetween('2026-01-01', '2026-12-31'), 364);
  });

  it('tracking start: clamped and labelled; a period wholly before it is before_tracking (never zero-filled)', () => {
    const t = baseState({ trackingStartDate: '2026-11-05' });
    const nov = resolve(t, 'month', NOW);
    assert.equal(nov.from, '2026-11-05');
    assert.equal(nov.nominalFrom, '2026-11-01');
    assert.ok(nov.notes.includes('clamped_to_tracking'));
    assert.deepEqual(coverageOf(t, nov), { trackedFrom: '2026-11-05', elapsedDays: 26, totalDays: 30, complete: false });
    const oct = previousAnalyticsPeriod(t, nov)!;
    assert.ok(oct.notes.includes('before_tracking'));
    assert.equal(coverageOf(t, oct).trackedFrom, null);
  });

  it('in progress: this month is; last month is not and is complete', () => {
    const nov = resolve(s, 'month', NOW);
    assert.equal(nov.inProgress, true);
    assert.ok(nov.notes.includes('in_progress'));
    assert.equal(coverageOf(s, nov).elapsedDays, 26);
    const oct = resolve(s, 'lastMonth', NOW);
    assert.equal(oct.inProgress, false);
    assert.equal(coverageOf(s, oct).complete, true);
  });
});

// --- Pay cycle (D1) -----------------------------------------------------------------------------------------------

describe('periods: pay cycle (salary receipts, 20-day grouping, manual override)', () => {
  const withReceipts = (dates: string[], extra: Partial<FinanceState> = {}, settings: Partial<FinanceState['settings']> = {}) => ({
    ...baseState(settings),
    accounts: [account('a-egp', 'EGP', 0)],
    transactions: dates.map((d, i) => salary(`s${i}`, d)),
    ...extra,
  });

  it('no salary: the calendar month, labelled no_salary (previous: last month)', () => {
    const s = withReceipts([]);
    const p = resolve(s, 'payCycle', NOW);
    assert.deepEqual(range(p), ['2026-11-01', '2026-11-30']);
    assert.ok(p.notes.includes('no_salary'));
    assert.deepEqual(range(previousAnalyticsPeriod(s, p)), ['2026-10-01', '2026-10-31']);
    // Other income (not salary) does not open a cycle.
    const other = { ...s, transactions: [salary('x', '2026-11-03', 500, { categoryId: CATEGORY_IDS.freelance })] };
    assert.ok(resolve(other, 'payCycle', NOW).notes.includes('no_salary'));
  });

  it('on time: from one receipt to the day before the next; the current one is open (in progress)', () => {
    const s = withReceipts(['2026-09-27', '2026-10-28', '2026-11-25']);
    assert.deepEqual(
      payCycles(s, '2026-11-26').map((c) => [c.from, c.to]),
      [
        ['2026-09-27', '2026-10-27'],
        ['2026-10-28', '2026-11-24'],
        ['2026-11-25', null],
      ]
    );
    const p = resolve(s, 'payCycle', NOW);
    assert.deepEqual(range(p), ['2026-11-25', '2026-11-26']);
    assert.equal(p.inProgress, true);
    assert.deepEqual(range(previousAnalyticsPeriod(s, p)), ['2026-10-28', '2026-11-24']);
  });

  it('late salary: a long cycle (no fixed day assumed)', () => {
    const s = withReceipts(['2026-09-01', '2026-10-01', '2026-11-20']);
    assert.deepEqual(range(previousAnalyticsPeriod(s, resolve(s, 'payCycle', NOW))), ['2026-10-01', '2026-11-19']);
  });

  it('two receipts close together (two late salaries collected in a week) are one cycle: multiple_salaries', () => {
    const s = withReceipts(['2026-09-01', '2026-11-10', '2026-11-14']);
    const p = resolve(s, 'payCycle', NOW);
    assert.deepEqual(range(p), ['2026-11-10', '2026-11-26']);
    assert.deepEqual(p.cycle!.receipts, ['2026-11-10', '2026-11-14']);
    assert.ok(p.notes.includes('multiple_salaries'));
  });

  it('the 20-day boundary: 19 days after the cycle start joins it, 20 days starts a new one', () => {
    assert.equal(MIN_CYCLE_DAYS, 20);
    assert.equal(payCycles(withReceipts(['2026-11-01', shiftDate('2026-11-01', 19)]), '2026-11-26').length, 1);
    assert.equal(payCycles(withReceipts(['2026-11-01', shiftDate('2026-11-01', 20)]), '2026-11-26').length, 2);
  });

  it('salary receivable collections count, whatever their category; "other" receivables and future receipts do not', () => {
    const receivable = (id: string, kind: Receivable['kind']): Receivable => ({ id, label: 'الشركة', kind, forMonth: '2026-10', amount: 20_000, currency: 'EGP', createdAt: T0, updatedAt: T0 });
    const s = {
      ...withReceipts([]),
      receivables: [receivable('r-sal', 'salary'), receivable('r-loan', 'other')],
      transactions: [
        salary('c1', '2026-11-12', 20_000, { categoryId: CATEGORY_IDS.otherIncome, receivableId: 'r-sal', forMonth: '2026-10' }),
        salary('c2', '2026-10-01', 500, { categoryId: CATEGORY_IDS.otherIncome, receivableId: 'r-loan', forMonth: '2026-10' }),
        salary('future', '2026-12-01'),
      ],
    };
    assert.deepEqual(payCycles(s, '2026-11-26').map((c) => c.from), ['2026-11-12']);
  });

  it('manual override (a preference): starts the current cycle on its date and absorbs receipts within 20 days', () => {
    const s = withReceipts(['2026-09-28', '2026-10-27', '2026-11-03'], {}, { payCycleStartOverride: '2026-11-01' });
    const cycles = payCycles(s, '2026-11-26');
    assert.deepEqual(cycles.map((c) => [c.from, c.to, c.info.override]), [
      ['2026-09-28', '2026-10-31', false],
      ['2026-11-01', null, true],
    ]);
    // 27 Oct and 3 Nov are within 20 days of the override: absorbed (3 Nov listed as a receipt of the override cycle).
    assert.deepEqual(cycles[1].info.receipts, ['2026-11-03']);
    const p = resolve(s, 'payCycle', NOW);
    assert.ok(p.notes.includes('cycle_override'));
    // An override in the future is ignored (and the op refuses it, below).
    const future = withReceipts(['2026-11-20'], {}, { payCycleStartOverride: '2026-12-01' });
    assert.deepEqual(payCycles(future, '2026-11-26').map((c) => c.from), ['2026-11-20']);
  });

  it('the first cycle has no previous; cycles align by elapsed days', () => {
    const s = withReceipts(['2026-11-10']);
    assert.equal(previousAnalyticsPeriod(s, resolve(s, 'payCycle', NOW)), null);
    const two = withReceipts(['2026-10-05', '2026-11-20']);
    const p = resolve(two, 'payCycle', NOW);
    assert.deepEqual(range(alignToElapsed(two, p, previousAnalyticsPeriod(two, p)!)), ['2026-10-05', '2026-10-11']);
  });

  it('salary receipts are memoized on the transactions array (a new array recomputes)', () => {
    const s = withReceipts(['2026-11-01']);
    assert.equal(sel.reservation(s, 'x', 'y'), 0); // unrelated selector untouched
    const first = payCycles(s, '2026-11-26');
    assert.deepEqual(payCycles(s, '2026-11-26'), first);
    const more = { ...s, transactions: [...s.transactions, salary('late', '2026-11-25')] };
    assert.equal(payCycles(more, '2026-11-26').length, 2);
  });
});

describe('analytics preferences (settings only, no ledger change)', () => {
  const s = baseState();
  const ctx = ctxAt(NOW);

  it('remembers a preset, forgets it, refuses custom and unknown presets', () => {
    const patch = ops.setAnalyticsPreferences(s, { period: '3m' }, ctx);
    assert.deepEqual(Object.keys(patch), ['settings']);
    assert.equal(patch.settings!.analyticsPeriod, '3m');
    assert.equal('analyticsPeriod' in ops.setAnalyticsPreferences({ ...s, ...patch }, { period: null }, ctx).settings!, false);
    for (const bad of ['custom', 'week', '']) {
      assert.throws(() => ops.setAnalyticsPreferences(s, { period: bad }, ctx), (e) => e instanceof FinanceValidationError && e.code === 'INVALID_KIND');
    }
  });

  it('sets and clears the manual pay-cycle start; refuses invalid and future dates', () => {
    assert.equal(ops.setAnalyticsPreferences(s, { payCycleStart: '2026-11-01' }, ctx).settings!.payCycleStartOverride, '2026-11-01');
    assert.equal(ops.setAnalyticsPreferences(s, { payCycleStart: '2026-11-26' }, ctx).settings!.payCycleStartOverride, '2026-11-26');
    const cleared = ops.setAnalyticsPreferences({ ...s, settings: { ...s.settings, payCycleStartOverride: '2026-11-01' } }, { payCycleStart: null }, ctx);
    assert.equal('payCycleStartOverride' in cleared.settings!, false);
    for (const bad of ['2026-11-27', '26/11/2026', 'x']) {
      assert.throws(() => ops.setAnalyticsPreferences(s, { payCycleStart: bad }, ctx), (e) => e instanceof FinanceValidationError && e.code === 'INVALID_DATE');
    }
  });

  it('round-trips through a backup (no data version change)', async () => {
    const state = { ...s, settings: { ...s.settings, analyticsPeriod: 'payCycle', payCycleStartOverride: '2026-11-01' } };
    const file = await createBackup(state, { now: NOW, crypto: { randomBytes: (n) => new Uint8Array(randomBytes(n)) } });
    const opened = await openBackup(parseBackup(serializeBackup(file)), { now: NOW, newId: () => 'x' });
    assert.equal(opened.state.settings.analyticsPeriod, 'payCycle');
    assert.equal(opened.state.settings.payCycleStartOverride, '2026-11-01');
  });
});

// --- Change rules -------------------------------------------------------------------------------------------------

describe('comparison: change rules (zero / negative baselines, never NaN or Infinity)', () => {
  const v = (value: number | null): MetricValue => (value === null ? { value: null, quality: 'unavailable', reason: 'no_previous' } : { value, quality: 'recorded' });
  const amount = (p: number | null, c: number | null, goodWhen: 'up' | 'down' | 'none' = 'up') => compareValues(v(p), v(c), { kind: 'amount', goodWhen, currency: 'EGP' });

  it('an ordinary change: absolute, percentage, direction, tone', () => {
    const c = amount(1_000, 1_250);
    assert.equal(c.delta, 250);
    assert.equal(c.pct, 0.25);
    assert.equal(c.direction, 'up');
    assert.equal(c.tone, 'good');
    assert.equal(amount(1_000, 1_250, 'none').tone, 'neutral'); // more spending isn't "bad" by itself
    assert.equal(amount(1_000, 750, 'up').tone, 'attention');
    assert.equal(amount(1_000, 0).pct, -1);
  });

  it('the design example: 60,000 → 84,250 = +24,250 (+40.42 %)', () => {
    const c = amount(60_000, 84_250);
    assert.equal(c.delta, 24_250);
    assert.equal(Math.round(c.pct! * 10_000) / 100, 40.42);
  });

  it('zero base: no percentage (never ∞), reason zero_base; both zero: flat', () => {
    const c = amount(0, 500);
    assert.equal(c.pct, null);
    assert.equal(c.reason, 'zero_base');
    assert.equal(c.direction, 'up');
    const z = amount(0, 0);
    assert.equal(z.direction, 'flat');
    assert.equal(z.pct, null);
    assert.equal(z.reason, undefined);
  });

  it('negative bases: same sign uses |previous|; a sign flip has no percentage', () => {
    const better = amount(-1_000, -500);
    assert.equal(better.delta, 500);
    assert.equal(better.pct, 0.5);
    assert.equal(better.direction, 'up');
    for (const [p, c] of [[-500, 300], [500, -300]]) {
      const flip = amount(p, c);
      assert.equal(flip.pct, null);
      assert.equal(flip.reason, 'sign_flip');
      assert.equal(flip.delta, c - p);
    }
  });

  it('flat within 1 % of the base; ratios in percentage points (never a % of a %)', () => {
    assert.equal(amount(1_000, 1_009).direction, 'flat');
    assert.equal(amount(1_000, 1_011).direction, 'up');
    const r = compareValues(v(0.428), v(0.38), { kind: 'ratio', goodWhen: 'up' });
    assert.equal(r.pct, null);
    assert.equal(r.pp, -0.048);
    assert.equal(r.direction, 'down');
    assert.equal(r.tone, 'attention');
  });

  it('a missing side: unavailable, no numbers; quality is the weaker side', () => {
    const c = amount(null, 500);
    assert.deepEqual([c.delta, c.pct, c.direction, c.reason], [null, null, null, 'unavailable']);
    assert.equal(weakerQuality('recorded', 'estimated'), 'estimated');
    assert.equal(compareValues({ value: 1, quality: 'reconstructed' }, { value: 2, quality: 'recorded' }, { kind: 'amount', goodWhen: 'up' }).quality, 'reconstructed');
  });

  it('fuzz: any mix of zeros, negatives, tiny and huge values never yields NaN or Infinity', () => {
    const pool = [0, -0, 0.001, -0.004, 0.005, 1, -1, 1e-12, 1e12, -1e12, 123.45, -987.65, null];
    for (const p of pool) for (const c of pool) for (const kind of ['amount', 'ratio'] as const) assertNoNaN(compareValues(v(p), v(c), { kind, goodWhen: 'up', currency: 'EGP' }));
  });
});

// --- Mode A: period vs period ---------------------------------------------------------------------------------------

// Synthetic world: salary 20,000 each month; October spending 3,000 (10th) + 1,000 (28th); November: groceries
// 3,300, a home-setup purchase of 2,000 paid 1,500 «من صندوق», a one-time 700, a transfer with a fee of 10, an
// exchange with a fee of 5, a gold purchase of 4,000, a reservation of 3,000 and a release of 200.
function flowWorld(settings: Partial<FinanceState['settings']> = {}): FinanceState {
  const s = baseState(settings);
  const transfer: Transaction = { id: 't-move', type: 'transfer', fromAccountId: 'a-egp', toAccountId: 'a-egp2', amount: 5_000, fees: [{ accountId: 'a-egp', amount: 10 }], date: '2026-11-10', rateSnapshotId: RATES.id, createdAt: T0, updatedAt: T0 };
  const exchange: Transaction = { id: 't-fx', type: 'exchange', fromAccountId: 'a-egp', toAccountId: 'a-sar', sentAmount: 1_250, receivedAmount: 100, fees: [{ accountId: 'a-egp', amount: 5 }], date: '2026-11-12', rateSnapshotId: RATES.id, createdAt: T0, updatedAt: T0 };
  const gold: Transaction = { id: 't-gold', type: 'asset_purchase', amount: 4_000, accountId: 'a-egp', currency: 'EGP', holdingId: 'h-gold', date: '2026-11-15', rateSnapshotId: RATES.id, createdAt: T0, updatedAt: T0 };
  return {
    ...s,
    accounts: [account('a-egp', 'EGP', 10_000, { openingDate: '2026-08-01' }), account('a-egp2', 'EGP', 0), account('a-sar', 'SAR', 1_000)],
    funds: [{ id: 'f-home', name: 'البيت', type: 'goal', targetAmount: 10_000, currency: 'EGP', priority: 1, linkedHoldingIds: [], createdAt: T0, updatedAt: T0 }],
    holdings: [{ id: 'h-gold', type: 'gold', name: 'سبيكة', weightGrams: 0.5, karat: 24, purchaseCost: { amount: 4_000, currency: 'EGP' }, purchaseRateSnapshotId: RATES.id, purchaseDate: '2026-11-15', country: 'EG', updatedAt: T0 }],
    transactions: [
      salary('s-oct', '2026-10-01'),
      spend('e-oct1', 3_000, '2026-10-10'),
      spend('e-oct2', 1_000, '2026-10-28', { categoryId: 'cat-lifestyle-dining' }),
      salary('s-nov', '2026-11-01'),
      spend('e-nov1', 3_300, '2026-11-05'),
      spend('e-home', 2_000, '2026-11-20', { categoryId: 'cat-essentials-home-setup' }),
      spend('e-once', 700, '2026-11-22', { categoryId: 'cat-lifestyle-gadgets', oneTime: true }),
      transfer,
      exchange,
      gold,
    ],
    reservationMovements: [
      movement('m-res', 'reserve', 3_000, '2026-11-02'),
      movement('m-spend', 'spend', -1_500, '2026-11-20', { sourceTransactionId: 'e-home' }),
      movement('m-rel', 'release', -200, '2026-11-21'),
    ],
  };
}

describe('comparison Mode A: one period\'s flows', () => {
  const s = flowWorld();
  const nov = resolve(s, 'month', NOW);
  const side = periodSide(s, nov, { currency: 'EGP', includeOneTime: true });
  const m = side.metrics;

  it('income, spending and net: transfers, exchanges, gold purchases and fund allocations are neither; fees are spending', () => {
    assert.equal(m.income.value, 20_000);
    assert.equal(m.expense.value, 3_300 + 2_000 + 700 + 10 + 5);
    assert.equal(m.net.value, 20_000 - 6_015);
    assert.equal(m.fundContributions.value, 3_000); // the reservation; the release and the spend are not contributions
  });

  it('reuses the existing analytics: same totals as periodTotals and (for a whole month) monthSummary', () => {
    const totals = analytics.periodTotals(s, { period: { kind: 'custom', from: '2026-11-01', to: '2026-11-26' }, currency: 'EGP', includeOneTime: true });
    assert.equal(m.income.value, totals.income);
    assert.equal(m.expense.value, totals.expense);
    const oct = periodSide(s, resolve(s, 'lastMonth', NOW), { currency: 'EGP', includeOneTime: true });
    const summary = sel.monthSummary(s, '2026-10', { to: 'EGP' });
    assert.deepEqual([oct.metrics.income.value, oct.metrics.expense.value, oct.metrics.net.value], [summary.income, summary.expense, summary.netCashFlow]);
    assert.equal(oct.metrics.savingsRate.value, summary.savingsRate);
  });

  it('D4: «من صندوق» split and the second savings rate', () => {
    assert.equal(m.expenseFromFunds.value, 1_500);
    assert.equal(m.expenseFromFreeMoney.value, 4_515);
    assert.equal(m.savingsRate.value, 13_985 / 20_000);
    assert.equal(m.savingsRateExFundSpending.value, (20_000 - 4_515) / 20_000);
  });

  it('the one-time toggle applies to the split too', () => {
    const without = periodSide(s, nov, { currency: 'EGP', includeOneTime: false }).metrics;
    assert.equal(without.expense.value, 5_315);
    assert.equal(without.expenseFromFunds.value, 1_500);
    const onceFromFund = { ...s, reservationMovements: [...s.reservationMovements, movement('m-s2', 'spend', -100, '2026-11-22', { sourceTransactionId: 'e-once' })] };
    assert.equal(periodSide(onceFromFund, nov, { currency: 'EGP', includeOneTime: false }).metrics.expenseFromFunds.value, 1_500);
    assert.equal(periodSide(onceFromFund, nov, { currency: 'EGP', includeOneTime: true }).metrics.expenseFromFunds.value, 1_600);
  });

  it('average daily spending over the tracked days measured so far (26 on 26 November)', () => {
    assert.equal(side.measured!.to, '2026-11-26');
    assert.equal(m.avgDailySpending.value, Math.round((6_015 / 26) * 100) / 100);
  });

  it('no income → both savings rates unavailable (never 0, never NaN)', () => {
    const noIncome = { ...s, transactions: s.transactions.filter((t) => t.type !== 'income') };
    const r = periodSide(noIncome, nov, { currency: 'EGP', includeOneTime: true }).metrics;
    assert.deepEqual(r.savingsRate, { value: null, quality: 'unavailable', reason: 'no_income' });
    assert.equal(r.savingsRateExFundSpending.reason, 'no_income');
  });

  it('read-only: a deep-frozen state is unchanged', () => {
    const frozen = deepFreeze(flowWorld());
    const before = JSON.stringify(frozen);
    comparePeriods(frozen, { current: resolve(frozen, 'month', NOW), currency: 'SAR', includeOneTime: true });
    assert.equal(JSON.stringify(frozen), before);
  });

  it('reporting currency: SAR figures are the EGP ones at the records\' own rates; nothing stored changes', () => {
    const sar = periodSide(s, nov, { currency: 'SAR', includeOneTime: true }).metrics;
    assert.equal(sar.income.value, 1_600);
    assert.equal(sar.expenseFromFunds.value, 120);
  });
});

describe('comparison Mode A: period vs period', () => {
  const s = flowWorld();
  const nov = resolve(s, 'month', NOW);

  it('in progress, default: previous cut to the same elapsed days (D10: 1–26 Oct)', () => {
    const c = comparePeriods(s, { current: nov, currency: 'EGP', includeOneTime: true });
    assert.equal(c.alignment, 'elapsed');
    assert.ok(c.notes.includes('aligned_elapsed'));
    assert.deepEqual([c.previous!.measured!.from, c.previous!.measured!.to], ['2026-10-01', '2026-10-26']);
    assert.equal(c.metrics.expense.previous.value, 3_000); // the 28 Oct dining is after the 26th
    assert.equal(c.metrics.expense.delta, 3_015);
    assert.equal(c.metrics.expense.tone, 'neutral');
    assert.equal(c.metrics.income.direction, 'flat');
    assert.equal(c.metrics.savingsRate.pp, Math.round((13_985 / 20_000 - 17_000 / 20_000) * 1e9) / 1e9);
    assertNoNaN(c);
  });

  it('in progress, option: against the whole previous month (labelled)', () => {
    const c = comparePeriods(s, { current: nov, alignment: 'full', currency: 'EGP', includeOneTime: true });
    assert.equal(c.alignment, 'full');
    assert.ok(c.notes.includes('current_in_progress'));
    assert.equal(c.metrics.expense.previous.value, 4_000);
  });

  it('a completed period is compared whole (no alignment)', () => {
    const c = comparePeriods(s, { current: resolve(s, 'lastMonth', NOW), currency: 'EGP', includeOneTime: true });
    assert.equal(c.alignment, null);
    assert.equal(c.previous!.metrics.income.value, 0);
    assert.equal(c.metrics.income.reason, 'zero_base');
  });

  it('categories: union of both sides, a real 0 where a tracked side spent nothing, biggest change first', () => {
    const c = comparePeriods(s, { current: nov, alignment: 'full', currency: 'EGP', includeOneTime: true });
    const byId = new Map(c.categories.map((x) => [x.categoryId, x.change]));
    assert.deepEqual([byId.get('cat-essentials-groceries')!.delta, byId.get('cat-essentials-groceries')!.pct], [300, 0.1]);
    assert.equal(byId.get('cat-lifestyle-dining')!.current.value, 0);
    assert.equal(byId.get('cat-lifestyle-dining')!.pct, -1);
    assert.equal(byId.get('cat-essentials-home-setup')!.reason, 'zero_base');
    assert.equal(byId.get(CATEGORY_IDS.fees)!.current.value, 15);
    assert.equal(c.categories[0].categoryId, 'cat-essentials-home-setup');
  });

  it('partial tracking: the previous side is clamped and labelled, with the earliest reliable date', () => {
    const t = flowWorld({ trackingStartDate: '2026-10-15' });
    const c = comparePeriods(t, { current: resolve(t, 'month', NOW), currency: 'EGP', includeOneTime: true });
    assert.ok(c.notes.includes('previous_partly_untracked'));
    assert.equal(c.earliestReliable, '2026-10-15');
    assert.equal(c.previous!.measured!.from, '2026-10-15');
    assert.equal(c.metrics.income.previous.value, 0); // the 1 Oct salary is before tracking
  });

  it('missing history: a previous period before tracking is unavailable — never zero — and nothing is computed from it', () => {
    const t = flowWorld({ trackingStartDate: '2026-11-01' });
    const c = comparePeriods(t, { current: resolve(t, 'month', NOW), currency: 'EGP', includeOneTime: true });
    assert.ok(c.notes.includes('previous_untracked'));
    assert.equal(c.earliestReliable, '2026-11-01');
    for (const change of Object.values(c.metrics)) {
      assert.equal(change.previous.value, null);
      assert.equal(change.previous.reason, 'before_tracking');
      assert.equal(change.delta, null);
    }
    assert.ok(c.categories.every((x) => x.change.previous.value === null));
  });

  it('since start has nothing to compare with', () => {
    const c = comparePeriods(s, { current: resolve(s, 'sinceStart', NOW), currency: 'EGP', includeOneTime: true });
    assert.ok(c.notes.includes('no_previous'));
    assert.equal(c.metrics.income.reason, 'unavailable');
  });

  it('memoized: the same inputs give the same object; a backdated insert recomputes', () => {
    const opts = { currency: 'EGP', includeOneTime: true };
    assert.equal(periodSide(s, nov, opts), periodSide(s, nov, opts));
    const backdated = { ...s, transactions: [...s.transactions, spend('late', 100, '2026-11-02')] };
    assert.equal(periodSide(backdated, nov, opts).metrics.expense.value, 6_115);
    assert.equal(periodSide(s, nov, opts).metrics.expense.value, 6_015);
  });

  it('pay-cycle periods compare the same way (current open cycle vs the previous one, aligned)', () => {
    const c = comparePeriods(s, { current: resolve(s, 'payCycle', NOW), currency: 'EGP', includeOneTime: true });
    assert.deepEqual([c.current.measured!.from, c.current.measured!.to], ['2026-11-01', '2026-11-26']);
    assert.deepEqual([c.previous!.measured!.from, c.previous!.measured!.to], ['2026-10-01', '2026-10-26']);
  });
});

// --- Mode B: date vs date -------------------------------------------------------------------------------------------

describe('comparison Mode B: positions and date vs date', () => {
  const SIX_MONTHS_AGO = '2026-05-26';
  // EGP only (so no rates matter) for the design example; a SAR account in the FX tests.
  function worth(): FinanceState {
    return {
      ...baseState({ trackingStartDate: '2026-01-01' }),
      accounts: [account('a-egp', 'EGP', 60_000, { openingDate: '2026-01-01' })],
      transactions: [salary('later', '2026-07-01', 24_250)],
    };
  }
  // The daily history as the app would have recorded it on that date (the ledger then had only what was dated before).
  function recordOn(state: FinanceState, date: string, store: DailySnapshotStore = emptyDailyStore()): DailySnapshotStore {
    const now = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 21);
    const then = { ...state, transactions: state.transactions.filter((t) => t.date <= date) };
    return syncDailyStore(store, then, now, snapshotForNow(then, now).id)!;
  }

  it('live (today): the valuation equals the selectors exactly, in every currency', () => {
    const s = flowWorld();
    const live = positionAt(s, null, toDateKey(NOW), NOW);
    assert.equal(live.source, 'live');
    for (const c of ['EGP', 'SAR', 'USD']) {
      const v = valuePosition(live.position!, live.prices!, c);
      assert.equal(v.netWorth, sel.netWorth(s, c), c);
      assert.equal(v.liquid, sel.liquidTotal(s, c));
      assert.equal(sel.holdingsTotal(s, c), Math.round((v.goldValue + v.currencyHoldings) * 100) / 100);
      assert.equal(v.liabilities, sel.liabilitiesTotal(s, c));
      assert.equal(v.totalAssets, sel.totalAssets(s, c));
      assert.equal(v.freeMoney, analytics.runway(s, c, NOW).unassigned.amount);
    }
  });

  it('INV-A4: reservations never add to total assets', () => {
    const s = flowWorld();
    const none = { ...s, reservationMovements: [] };
    const live = (st: FinanceState) => valuePosition(positionAt(st, null, toDateKey(NOW), NOW).position!, positionAt(st, null, toDateKey(NOW), NOW).prices!, 'EGP');
    assert.equal(live(s).totalAssets, live(none).totalAssets);
    assert.equal(live(s).reserved, 3_000 - 1_500 - 200);
    assert.equal(live(s).freeMoney, live(s).liquid - live(s).reserved);
  });

  it('design example: recorded six months ago vs today = +24,250 (+40.42 %), recorded on both sides', () => {
    const s = worth();
    const store = recordOn(s, SIX_MONTHS_AGO);
    const c = compareDates(s, store, { dateA: SIX_MONTHS_AGO, dateB: toDateKey(NOW), currency: 'EGP', method: 'historical', now: NOW });
    assert.equal(c.a.at.source, 'daily');
    assert.equal(c.a.at.ledgerDiverged, false);
    assert.equal(c.metrics.netWorth.previous.value, 60_000);
    assert.equal(c.metrics.netWorth.current.value, 84_250);
    assert.equal(c.metrics.netWorth.delta, 24_250);
    assert.equal(Math.round(c.metrics.netWorth.pct! * 10_000) / 100, 40.42);
    assert.equal(c.metrics.netWorth.quality, 'recorded');
    assert.equal(c.metrics.freeMoney.quality, 'recorded');
  });

  it('no snapshot for the date: a labelled ledger reconstruction; reservations / free money unavailable', () => {
    const s = worth();
    const hist = compareDates(s, emptyDailyStore(), { dateA: SIX_MONTHS_AGO, dateB: toDateKey(NOW), currency: 'EGP', method: 'historical', now: NOW });
    assert.equal(hist.a.at.source, 'ledger');
    assert.equal(hist.a.metrics.liquid.value, 60_000);
    assert.equal(hist.a.metrics.liquid.quality, 'estimated'); // past figures at today's prices
    assert.equal(hist.a.metrics.reserved.value, null);
    assert.equal(hist.a.metrics.freeMoney.reason, 'not_recorded');
    assert.equal(hist.metrics.freeMoney.delta, null);
    const constant = compareDates(s, emptyDailyStore(), { dateA: SIX_MONTHS_AGO, dateB: toDateKey(NOW), currency: 'EGP', method: 'constant', now: NOW });
    assert.equal(constant.a.metrics.liquid.quality, 'reconstructed');
    assert.equal(constant.a.metrics.netWorth.quality, 'estimated'); // holdings by purchase date are never better
  });

  it('before tracking and in the future: unavailable (with the reason)', () => {
    const s = worth();
    const c = compareDates(s, null, { dateA: '2025-12-31', dateB: '2026-12-01', currency: 'EGP', method: 'historical', now: NOW });
    assert.equal(c.a.metrics.netWorth.reason, 'before_tracking');
    assert.equal(c.b.metrics.netWorth.reason, 'future');
    assert.equal(c.metrics.netWorth.delta, null);
    assertNoNaN(c);
  });

  it('exchange-rate moves: historical shows them, constant rates remove them', () => {
    const s = { ...worth(), accounts: [account('a-sar', 'SAR', 1_000, { openingDate: '2026-01-01' })], transactions: [] };
    const store = recordOn(s, SIX_MONTHS_AGO); // 1 SAR = 12.5 EGP then
    const today = { ...s, settings: { ...s.settings, rates: { ...s.settings.rates, perUsd: { ...PER_USD, SAR: 50 / 14 } } } }; // 14 EGP now
    const hist = compareDates(today, store, { dateA: SIX_MONTHS_AGO, dateB: toDateKey(NOW), currency: 'EGP', method: 'historical', now: NOW });
    assert.deepEqual([hist.metrics.liquid.previous.value, hist.metrics.liquid.current.value], [12_500, 14_000]);
    const constant = compareDates(today, store, { dateA: SIX_MONTHS_AGO, dateB: toDateKey(NOW), currency: 'EGP', method: 'constant', now: NOW });
    assert.equal(constant.constantPrices!.source, 'live');
    assert.deepEqual([constant.metrics.liquid.previous.value, constant.metrics.liquid.delta], [14_000, 0]);
    assert.equal(constant.metrics.liquid.direction, 'flat');
  });

  it('gold-price moves the same way; reporting currency changes no native amount', () => {
    const s = { ...worth(), accounts: [], transactions: [], holdings: [{ id: 'g', type: 'gold' as const, name: 'g', weightGrams: 10, karat: 21 as const, purchaseCost: { amount: 50_000, currency: 'EGP' }, purchaseRateSnapshotId: RATES.id, purchaseDate: '2026-01-02', country: 'EG', updatedAt: T0 }] };
    const store = recordOn(s, SIX_MONTHS_AGO);
    const today = { ...s, settings: { ...s.settings, goldPrice21kEGP: 6_000 } };
    const hist = compareDates(today, store, { dateA: SIX_MONTHS_AGO, dateB: toDateKey(NOW), currency: 'EGP', method: 'historical', now: NOW });
    assert.deepEqual([hist.metrics.goldValue.previous.value, hist.metrics.goldValue.current.value], [52_500, 60_000]);
    const sar = compareDates(today, store, { dateA: SIX_MONTHS_AGO, dateB: toDateKey(NOW), currency: 'SAR', method: 'historical', now: NOW });
    assert.equal(sar.metrics.goldValue.previous.value, 4_200);
    assert.deepEqual(sar.a.at.position!.holdings, hist.a.at.position!.holdings);
  });

  it('D3: a past transaction edited after the day was recorded → the ledger wins for balances, and it is flagged', () => {
    const s = { ...worth(), transactions: [spend('old', 1_000, '2026-05-20')] };
    const store = recordOn(s, SIX_MONTHS_AGO);
    const edited = { ...s, transactions: [spend('old', 1_500, '2026-05-20')] };
    const p = positionAt(edited, store, SIX_MONTHS_AGO, NOW);
    assert.equal(p.ledgerDiverged, true);
    assert.equal(p.position!.accounts[0].balance, 58_500);
    assert.equal(positionAt(s, store, SIX_MONTHS_AGO, NOW).ledgerDiverged, false);
  });

  it('a record whose rate snapshot is missing: historical value unavailable, nothing invented', () => {
    const s = { ...worth(), accounts: [account('a-sar', 'SAR', 1_000, { openingDate: '2026-01-01' })], transactions: [] };
    const store = recordOn(s, SIX_MONTHS_AGO);
    const broken: DailySnapshotStore = { ...store, days: store.days.map((d) => ({ ...d, r: 'rs-missing' })) };
    const c = compareDates(s, broken, { dateA: SIX_MONTHS_AGO, dateB: toDateKey(NOW), currency: 'EGP', method: 'historical', now: NOW });
    assert.equal(c.a.metrics.liquid.reason, 'rates_missing');
    assert.equal(c.metrics.liquid.delta, null);
  });

  it('PriceSet values match holdingValue for 18k (24k × 0.75)', () => {
    const prices: PriceSet = { rates: RATES, gold24kEGP: 8_000, gold21kEGP: 7_000, source: 'live', date: '2026-11-26' };
    const position = positionAt({ ...baseState(), holdings: [{ id: 'g', type: 'gold', name: 'g', weightGrams: 2, karat: 18, purchaseCost: { amount: 1, currency: 'EGP' }, purchaseRateSnapshotId: RATES.id, country: 'EG', updatedAt: T0 }] }, null, toDateKey(NOW), NOW).position!;
    assert.equal(valuePosition(position, prices, 'EGP').goldValue, 12_000);
  });
});

// --- Time zones ------------------------------------------------------------------------------------------------------

describe('periods under other time zones (DST days included): only the local calendar date counts', () => {
  const ZONES = ['America/New_York', 'Pacific/Auckland', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Africa/Cairo', 'Asia/Riyadh'];
  const original = process.env.TZ;

  for (const zone of ZONES) {
    it(zone, () => {
      process.env.TZ = zone;
      try {
        const s = baseState({ trackingStartDate: '2020-01-01' });
        const local = (y: number, m: number, d: number, h: number, min = 0, sec = 0) => new Date(y, m - 1, d, h, min, sec);
        // Either side of local midnight.
        assert.deepEqual(range(resolveAnalyticsPeriod(s, 'month', local(2026, 11, 30, 23, 59, 59))), ['2026-11-01', '2026-11-30']);
        assert.deepEqual(range(resolveAnalyticsPeriod(s, 'month', local(2026, 12, 1, 0, 0, 1))), ['2026-12-01', '2026-12-31']);
        // DST-change months keep their calendar lengths; a week across a DST change is 7 days from Saturday.
        for (const [y, m, days] of [[2026, 3, 31], [2026, 4, 30], [2026, 9, 30], [2026, 10, 31], [2026, 11, 30]] as const) {
          assert.equal(coverageOf(s, resolveAnalyticsPeriod(s, 'month', local(y, m, 15, 12))).totalDays, days, `${zone} ${y}-${m}`);
        }
        const week = resolveAnalyticsPeriod(s, 'thisWeek', local(2026, 3, 8, 12));
        assert.deepEqual(range(week), ['2026-03-07', '2026-03-13']);
        assert.equal(fromDateKey(week.from).getDay(), 6);
        // The 20-day pay-cycle rule across a DST change.
        const cycles = payCycles({ ...s, transactions: [salary('a', '2026-03-01'), salary('b', '2026-03-21'), salary('c', '2026-10-20'), salary('d', '2026-11-08')] }, '2026-11-26');
        assert.deepEqual(cycles.map((c) => c.from), ['2026-03-01', '2026-03-21', '2026-10-20']);
        // D10 alignment on the 31st.
        const march = resolveAnalyticsPeriod(s, 'month', local(2027, 3, 31, 23, 30));
        assert.deepEqual(range(alignToElapsed(s, march, previousAnalyticsPeriod(s, march)!)), ['2027-02-01', '2027-02-28']);
        // A comparison on the 26th, late evening: 26 elapsed days on both sides.
        const w = flowWorld();
        const c = comparePeriods(w, { current: resolveAnalyticsPeriod(w, 'month', local(2026, 11, 26, 23, 45)), currency: 'EGP', includeOneTime: true });
        assert.deepEqual([c.previous!.measured!.to, c.current.measured!.to], ['2026-10-26', '2026-11-26']);
        assert.equal(c.metrics.expense.delta, 3_015);
      } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
      }
    });
  }
});
