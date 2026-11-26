import { daysBetween, fromDateKey, monthOf, shiftDate, shiftMonth, toDateKey } from '@/utils/dates';
import { monthEnd, monthStart } from './analytics';
import { CATEGORY_IDS } from './defaultCategories';
import { createMemoCache, memoOn } from './memo';
import type { FinanceState, IncomeExpenseTransaction } from './types';

// The analytics period system (Phase 1b of docs/architecture/PROFESSIONAL_ANALYTICS_AND_COMPARISON_DESIGN.md §7.1).
// Pure, no React Native. Dates are local 'YYYY-MM-DD' keys throughout, so nothing depends on the time of day or the
// time zone beyond the local calendar date of `now`.
//
// The existing Analytics tab keeps its own `resolvePeriod` / `previousPeriod` (store/analytics.ts) until Phase 2
// switches it over; nothing here changes them.

type State = FinanceState;

export type PeriodPreset =
  | 'thisWeek'
  | 'lastWeek'
  | 'month' // this calendar month (the default)
  | 'lastMonth'
  | '3m'
  | '6m'
  | '12m'
  | 'thisYear'
  | 'lastYear'
  | 'sinceStart'
  | 'payCycle'
  | 'custom';

export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  'thisWeek',
  'lastWeek',
  'month',
  'lastMonth',
  '3m',
  '6m',
  '12m',
  'thisYear',
  'lastYear',
  'sinceStart',
  'payCycle',
  'custom',
];

export const DEFAULT_PERIOD_PRESET: PeriodPreset = 'month';

// D6: only the preset kind is remembered, never custom dates (so 'custom' is not rememberable).
export const isRememberablePreset = (value: unknown): value is Exclude<PeriodPreset, 'custom'> =>
  typeof value === 'string' && value !== 'custom' && (PERIOD_PRESETS as readonly string[]).includes(value);

// The remembered preset, or the default.
export const preferredPreset = (state: Pick<State, 'settings'>): PeriodPreset =>
  isRememberablePreset(state.settings.analyticsPeriod) ? state.settings.analyticsPeriod : DEFAULT_PERIOD_PRESET;

// Why a period is not what its preset nominally says.
export type PeriodNote =
  | 'clamped_to_tracking' // it would start before trackingStartDate: starts there instead
  | 'before_tracking' // it ends before trackingStartDate: nothing was tracked in it
  | 'in_progress' // it isn't over yet
  | 'no_salary' // payCycle without any salary receipt: the calendar month instead
  | 'cycle_override' // payCycle started by the manual cycle-start preference
  | 'multiple_salaries'; // payCycle opened by two or more salary receipts close together

export interface PayCycleInfo {
  // The salary receipts that opened it (their dates; one per receipt transaction).
  receipts: string[];
  // True when the manual cycle-start preference opened it.
  override: boolean;
}

export interface AnalyticsPeriod {
  preset: PeriodPreset;
  // Inclusive local date keys of what is measured (from ≥ trackingStartDate unless before_tracking).
  from: string;
  to: string;
  // What the preset nominally covers (before clamping to the tracking start). For an open pay cycle nominalTo = today.
  nominalFrom: string;
  nominalTo: string;
  // to ≥ today: the period isn't over (its flows so far run to today).
  inProgress: boolean;
  // The local date the period was resolved on.
  today: string;
  cycle?: PayCycleInfo;
  notes: PeriodNote[];
}

export interface Coverage {
  // The first tracked day of the period, or null when it ends before tracking started.
  trackedFrom: string | null;
  // Days of the period from its start to min(to, today), inclusive (0 when it hasn't started).
  elapsedDays: number;
  // Days the period nominally covers.
  totalDays: number;
  // Fully tracked and over.
  complete: boolean;
}

const daysIncl = (from: string, to: string) => (to < from ? 0 : daysBetween(from, to) + 1);
const minKey = (a: string, b: string) => (a < b ? a : b);
const maxKey = (a: string, b: string) => (a > b ? a : b);

// D5: weeks start on Saturday. getDay(): Sunday 0 … Saturday 6, so days since Saturday = (getDay() + 1) % 7.
export function weekStart(date: string): string {
  return shiftDate(date, -((fromDateKey(date).getDay() + 1) % 7));
}

const yearStart = (date: string) => `${date.slice(0, 4)}-01-01`;
const yearEnd = (date: string) => `${date.slice(0, 4)}-12-31`;

// Builds a period from its nominal range: clamped to tracking, in-progress and coverage notes added.
export function makePeriod(
  state: Pick<State, 'settings'>,
  preset: PeriodPreset,
  nominalFrom: string,
  nominalTo: string,
  today: string,
  extra: { cycle?: PayCycleInfo; notes?: PeriodNote[] } = {}
): AnalyticsPeriod {
  const start = state.settings.trackingStartDate;
  const notes: PeriodNote[] = [...(extra.notes ?? [])];
  let from = nominalFrom;
  if (nominalTo < start) notes.push('before_tracking');
  else if (nominalFrom < start) {
    from = start;
    notes.push('clamped_to_tracking');
  }
  const inProgress = nominalTo >= today;
  if (inProgress) notes.push('in_progress');
  return {
    preset,
    from,
    to: nominalTo,
    nominalFrom,
    nominalTo,
    inProgress,
    today,
    ...(extra.cycle ? { cycle: extra.cycle } : {}),
    notes,
  };
}

export function coverageOf(state: Pick<State, 'settings'>, period: AnalyticsPeriod): Coverage {
  const start = state.settings.trackingStartDate;
  const trackedFrom = period.nominalTo < start ? null : maxKey(period.nominalFrom, start);
  const elapsedEnd = minKey(period.nominalTo, period.today);
  return {
    trackedFrom,
    elapsedDays: daysIncl(period.nominalFrom, elapsedEnd),
    totalDays: daysIncl(period.nominalFrom, period.nominalTo),
    complete: trackedFrom === period.nominalFrom && !period.inProgress,
  };
}

// --- Pay cycle (D1) --------------------------------------------------------------------------------------------

// Two receipts closer than this to the current cycle's start belong to the same cycle (e.g. two late salaries
// collected in one week).
export const MIN_CYCLE_DAYS = 20;

export interface PayCycle {
  from: string;
  // The day before the next cycle starts; null for the last (open) cycle.
  to: string | null;
  info: PayCycleInfo;
}

// Salary receipts: incomes in «راتب» and collections of a salary receivable (whatever their category), on their
// receipt date. Memoized on the transactions and receivables.
export const salaryReceipts = (state: Pick<State, 'transactions' | 'receivables'>): IncomeExpenseTransaction[] =>
  memoOn(salaryReceiptsCache, [state.transactions, state.receivables], '', () => {
    const salaryReceivables = new Set(state.receivables.filter((r) => r.kind === 'salary').map((r) => r.id));
    return state.transactions
      .filter(
        (tx): tx is IncomeExpenseTransaction =>
          tx.type === 'income' && (tx.categoryId === CATEGORY_IDS.salary || (!!tx.receivableId && salaryReceivables.has(tx.receivableId)))
      )
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  });
const salaryReceiptsCache = createMemoCache<IncomeExpenseTransaction[]>();

// Every pay cycle, oldest first, from the receipts and the manual cycle-start preference (`override`, a date key not
// after `today`). The override opens a cycle on its date and absorbs any detected receipt less than MIN_CYCLE_DAYS
// from it (either side), so it always wins in its own window. Future-dated receipts are ignored.
export function payCycles(state: Pick<State, 'transactions' | 'receivables' | 'settings'>, today: string): PayCycle[] {
  const override = state.settings.payCycleStartOverride;
  const validOverride = override && override <= today ? override : undefined;
  const near = (a: string, b: string) => Math.abs(daysBetween(a, b)) < MIN_CYCLE_DAYS;
  const receipts = salaryReceipts(state)
    .map((tx) => tx.date)
    .filter((d) => d <= today);

  // Starts: [date, receipts that opened it, override?]
  const starts: { from: string; receipts: string[]; override: boolean }[] = [];
  const detected = validOverride ? receipts.filter((d) => !near(d, validOverride)) : receipts;
  const absorbed = validOverride ? receipts.filter((d) => near(d, validOverride)) : [];
  const anchors = [...detected.map((d) => ({ d, override: false })), ...(validOverride ? [{ d: validOverride, override: true }] : [])].sort(
    (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.override ? -1 : 1)
  );
  for (const anchor of anchors) {
    const current = starts[starts.length - 1];
    if (current && !anchor.override && daysBetween(current.from, anchor.d) < MIN_CYCLE_DAYS) {
      current.receipts.push(anchor.d);
      continue;
    }
    starts.push({ from: anchor.d, receipts: anchor.override ? absorbed.filter((d) => d >= anchor.d) : [anchor.d], override: anchor.override });
  }
  return starts.map((s, i) => ({
    from: s.from,
    to: i + 1 < starts.length ? shiftDate(starts[i + 1].from, -1) : null,
    info: { receipts: s.receipts, override: s.override },
  }));
}

function cyclePeriod(state: Pick<State, 'settings'>, cycle: PayCycle, today: string): AnalyticsPeriod {
  const notes: PeriodNote[] = [];
  if (cycle.info.override) notes.push('cycle_override');
  if (cycle.info.receipts.length >= 2) notes.push('multiple_salaries');
  return makePeriod(state, 'payCycle', cycle.from, cycle.to ?? today, today, { cycle: cycle.info, notes });
}

// --- Resolving a preset ------------------------------------------------------------------------------------------

type PeriodState = Pick<State, 'settings' | 'transactions' | 'receivables'>;

export function resolveAnalyticsPeriod(
  state: PeriodState,
  preset: PeriodPreset,
  now: Date,
  custom?: { from: string; to: string }
): AnalyticsPeriod {
  const today = toDateKey(now);
  const month = monthOf(today);
  const make = (from: string, to: string) => makePeriod(state, preset, from, to, today);
  switch (preset) {
    case 'thisWeek': {
      const from = weekStart(today);
      return make(from, shiftDate(from, 6));
    }
    case 'lastWeek': {
      const from = shiftDate(weekStart(today), -7);
      return make(from, shiftDate(from, 6));
    }
    case 'month':
      return make(monthStart(month), monthEnd(month));
    case 'lastMonth': {
      const last = shiftMonth(month, -1);
      return make(monthStart(last), monthEnd(last));
    }
    case '3m':
    case '6m':
    case '12m': {
      const n = preset === '3m' ? 3 : preset === '6m' ? 6 : 12;
      return make(monthStart(shiftMonth(month, -(n - 1))), monthEnd(month));
    }
    case 'thisYear':
      return make(yearStart(today), yearEnd(today));
    case 'lastYear': {
      const last = `${Number(today.slice(0, 4)) - 1}-06-01`;
      return make(yearStart(last), yearEnd(last));
    }
    case 'sinceStart':
      return make(state.settings.trackingStartDate, today);
    case 'payCycle': {
      const cycles = payCycles(state, today);
      const current = cycles[cycles.length - 1];
      if (!current) return makePeriod(state, 'payCycle', monthStart(month), monthEnd(month), today, { notes: ['no_salary'] });
      return cyclePeriod(state, current, today);
    }
    case 'custom': {
      const a = custom?.from ?? state.settings.trackingStartDate;
      const b = custom?.to ?? today;
      return make(minKey(a, b), maxKey(a, b));
    }
  }
}

// The period a preset is compared with by default ("الفترة اللي فاتت"): the same span right before it. null when
// there is nothing comparable (since-start; a first pay cycle). It may itself be partly or wholly before tracking:
// its notes and coverage say so (it is never silently dropped or zero-filled).
export function previousAnalyticsPeriod(state: PeriodState, period: AnalyticsPeriod): AnalyticsPeriod | null {
  const { today } = period;
  const make = (from: string, to: string) => makePeriod(state, period.preset, from, to, today);
  const nf = period.nominalFrom;
  switch (period.preset) {
    case 'thisWeek':
    case 'lastWeek':
      return make(shiftDate(nf, -7), shiftDate(nf, -1));
    case 'month':
    case 'lastMonth': {
      const m = shiftMonth(monthOf(nf), -1);
      return make(monthStart(m), monthEnd(m));
    }
    case '3m':
    case '6m':
    case '12m': {
      const n = period.preset === '3m' ? 3 : period.preset === '6m' ? 6 : 12;
      const endMonth = shiftMonth(monthOf(nf), -1);
      return make(monthStart(shiftMonth(endMonth, -(n - 1))), monthEnd(endMonth));
    }
    case 'thisYear':
    case 'lastYear': {
      const y = `${Number(nf.slice(0, 4)) - 1}-06-01`;
      return make(yearStart(y), yearEnd(y));
    }
    case 'sinceStart':
      return null;
    case 'payCycle': {
      if (period.notes.includes('no_salary')) {
        const m = shiftMonth(monthOf(nf), -1);
        return makePeriod(state, 'payCycle', monthStart(m), monthEnd(m), today, { notes: ['no_salary'] });
      }
      const cycles = payCycles(state, today);
      const index = cycles.findIndex((c) => c.from === nf);
      return index > 0 ? cyclePeriod(state, cycles[index - 1], today) : null;
    }
    case 'custom': {
      const length = daysIncl(nf, period.nominalTo);
      const to = shiftDate(nf, -1);
      return make(shiftDate(to, -(length - 1)), to);
    }
  }
}

// D10: the previous period cut to the same number of elapsed days as `current` (which is in progress): "1–26
// November" against "1–26 October". Never past the previous period's own end (31 March → end of February). Returns
// the previous period unchanged when `current` is over.
export function alignToElapsed(state: Pick<State, 'settings'>, current: AnalyticsPeriod, previous: AnalyticsPeriod): AnalyticsPeriod {
  if (!current.inProgress) return previous;
  const elapsed = Math.max(1, daysIncl(current.nominalFrom, current.today));
  const nominalTo = minKey(shiftDate(previous.nominalFrom, elapsed - 1), previous.nominalTo);
  const kept = previous.notes.filter((n) => n !== 'in_progress' && n !== 'before_tracking' && n !== 'clamped_to_tracking');
  return makePeriod(state, previous.preset, previous.nominalFrom, nominalTo, previous.today, {
    ...(previous.cycle ? { cycle: previous.cycle } : {}),
    notes: kept,
  });
}

// The current period's measured range for flows: up to today when it is in progress.
export const measuredTo = (period: AnalyticsPeriod): string => (period.inProgress ? minKey(period.to, period.today) : period.to);

// A preset (and custom range) as the period sheet drafts it, optionally with a DRAFT manual cycle start (undefined =
// the saved preference, null = automatic): what the sheet previews before anything is saved.
export function resolvePeriodChoice(
  state: PeriodState,
  choice: { preset: PeriodPreset; custom?: { from: string; to: string }; payCycleStart?: string | null },
  now: Date
): AnalyticsPeriod {
  if (choice.payCycleStart === undefined) return resolveAnalyticsPeriod(state, choice.preset, now, choice.custom);
  const { payCycleStartOverride: _saved, ...settings } = state.settings;
  const draft = choice.payCycleStart === null ? settings : { ...settings, payCycleStartOverride: choice.payCycleStart };
  return resolveAnalyticsPeriod({ ...state, settings: draft }, choice.preset, now, choice.custom);
}
