import { dayCountPhrase } from '@/components/settings/settingsUi';
import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import type { ColorToken } from '@/constants/theme';
import type { Change, ComparisonNote, FlowMetricId, Quality, ValueReason } from '@/store/comparison';
import type { CashflowChart, FlowBucket } from '@/store/cashflowCharts';
import type { PointMetricId } from '@/store/history';
import type { AnalyticsPeriod, PeriodPreset } from '@/store/periods';
import { daysBetween } from '@/utils/dates';
import { formatMonthLabel, formatPercent } from '@/utils/formatters';

import { monthShort } from './analyticsUi';

// Pure UI copy for the Overview tab and the Compare screen (no React Native; unit-tested). Egyptian colloquial like
// the rest of the app (D7); Western digits in amounts and labels, dates as formatDateAr gives them (D8).

export const PRESET_LABELS: Record<PeriodPreset, string> = {
  thisWeek: 'الأسبوع ده',
  lastWeek: 'الأسبوع اللي فات',
  month: 'الشهر ده',
  lastMonth: 'الشهر اللي فات',
  '3m': 'آخر 3 شهور',
  '6m': 'آخر 6 شهور',
  '12m': 'آخر 12 شهر',
  thisYear: 'السنة دي',
  lastYear: 'السنة اللي فاتت',
  sinceStart: 'من بداية التتبع',
  payCycle: 'دورة الراتب',
  custom: 'فترة مخصصة',
};

// The order the period sheet offers them in.
export const PRESET_ORDER: PeriodPreset[] = ['month', 'lastMonth', 'thisWeek', 'lastWeek', '3m', '6m', '12m', 'thisYear', 'lastYear', 'payCycle', 'sinceStart', 'custom'];

const range = (from: string, to: string) => (from === to ? formatDateAr(from) : `${formatDateAr(from)} – ${formatDateAr(to)}`);

// The pill: "الشهر ده ▾"; a custom range shows its dates.
export function pillLabel(period: AnalyticsPeriod): string {
  return `${period.preset === 'custom' ? range(period.from, period.to) : PRESET_LABELS[period.preset]} ▾`;
}

// The pill of a period that is "the one before" another.
export const previousPillLabel = (): string => 'الفترة اللي فاتت ▾';

// The line under the pill: the dates measured, "لسه شغال", pay-cycle details.
export function periodLine(period: AnalyticsPeriod): string {
  const parts = [range(period.from, period.inProgress ? period.today : period.to)];
  if (period.preset === 'payCycle') {
    if (period.notes.includes('no_salary')) parts.push('لسه مفيش راتب متسجّل، فده الشهر ده');
    else {
      parts.push(dayCountPhrase(daysBetween(period.from, period.inProgress ? period.today : period.to) + 1));
      if (period.notes.includes('multiple_salaries')) parts.push(`الدورة دي فيها ${period.cycle!.receipts.length === 2 ? 'راتبين' : `${period.cycle!.receipts.length} رواتب`}`);
      if (period.notes.includes('cycle_override')) parts.push('بداية اخترتها بنفسك');
    }
  }
  if (period.inProgress) parts.push('لسه شغال');
  // Each part isolated (FSI … PDI) so Arabic-Indic date digits next to Western ones can't move the separators.
  return parts.map((p) => `⁨${p}⁩`).join(' · ');
}

// --- Changes ------------------------------------------------------------------------------------------------------

export interface ChangeLine {
  text: string;
  color: ColorToken;
}

const TONE_COLOR: Record<Change['tone'], ColorToken> = { good: 'primary700', attention: 'warning', neutral: 'textSecondary' };

// "+4.2 نقطة"; small values keep their digits ("+0.04 نقطة"), never "0".
export function pointsPhrase(pp: number): string {
  const points = pp * 100;
  const abs = Math.abs(points);
  const sign = points < 0 ? '−' : '+';
  if (abs === 0) return '0 نقطة';
  if (abs < 0.01) return 'أقل من 0.01 نقطة';
  const text = abs >= 1 ? (Math.round(abs * 10) / 10).toString() : (Math.round(abs * 100) / 100).toString();
  return `⁦${sign}${text}⁩ نقطة`;
}

// Why there is no comparison, in a few words.
export function reasonText(reason: ValueReason | undefined, context: { trackingStart?: string; dailySince?: string | null } = {}): string {
  switch (reason) {
    case 'before_tracking':
      return context.trackingStart ? `البيانات بتبدأ من ${formatDateAr(context.trackingStart)}` : 'قبل بداية التتبع';
    case 'no_previous':
      return 'مفيش فترة قبلها للمقارنة';
    case 'no_income':
      return 'مفيش دخل في الفترة';
    case 'no_days':
      return 'مفيش أيام متسجّلة';
    case 'not_recorded':
      return context.dailySince ? `مفيش تسجيل لليوم ده (السجل اليومي من ${formatDateAr(context.dailySince)})` : 'مفيش تسجيل لليوم ده';
    case 'future':
      return 'تاريخ لسه مجاش';
    case 'rates_missing':
      return 'أسعار اليوم ده مش موجودة';
    default:
      return 'مفيش مقارنة';
  }
}

// Why the PREVIOUS side has no value, in words that say so.
function previousReasonText(reason: ValueReason | undefined, context: { trackingStart?: string; dailySince?: string | null }): string {
  if (reason === 'no_income') return 'مفيش دخل في الفترة اللي فاتت';
  if (reason === 'no_days') return 'مفيش أيام متسجّلة في الفترة اللي فاتت';
  return reasonText(reason, context);
}

// The comparison line of a card: arrow and colour follow the direction ("مستقر" under the threshold), but the
// absolute change is ALWAYS shown with its real value (decision 3), and a percentage only when it is valid.
export function changeLine(change: Change, currency: string, context: { trackingStart?: string; dailySince?: string | null } = {}): ChangeLine {
  if (change.delta === null) {
    // Say which side is missing: a reason about the PREVIOUS side must not read as if it were about this period.
    if (change.previous.value === null) return { text: previousReasonText(change.previous.reason, context), color: 'textMuted' };
    return { text: reasonText(change.current.reason, context), color: 'textMuted' };
  }
  const arrow = change.direction === 'up' ? '↑' : change.direction === 'down' ? '↓' : null;
  const color = change.direction === 'flat' ? 'textSecondary' : TONE_COLOR[change.tone];
  if (change.kind === 'ratio') {
    const points = pointsPhrase(change.pp ?? change.delta);
    return { text: arrow ? `${arrow} ${points}` : `مستقر · ${points}`, color };
  }
  const amount = formatMoney(change.delta, currency, true);
  if (change.reason === 'zero_base') return { text: `جديد · ${amount}`, color };
  if (change.reason === 'sign_flip') {
    return { text: `${(change.previous.value ?? 0) < 0 ? 'اتحوّل من سالب لموجب' : 'اتحوّل من موجب لسالب'} · ${amount}`, color };
  }
  const pct = change.pct !== null && Math.abs(change.pct) >= 0.001 ? formatPercent(Math.abs(change.pct)) : null;
  if (!arrow) return { text: pct ? `مستقر · ${amount} (${pct})` : `مستقر · ${amount}`, color };
  return { text: pct ? `${arrow} ${pct} · ${amount}` : `${arrow} ${amount}`, color };
}

// "عن الفترة اللي فاتت" / "عن 26 أكتوبر" / "لحد نفس اليوم من الفترة اللي فاتت".
export function comparedToLabel(aligned: boolean, previousEndDate: string | null, pointMetric: boolean): string {
  if (pointMetric) return previousEndDate ? `عن ${formatDateAr(previousEndDate)}` : 'عن الفترة اللي فاتت';
  return aligned ? 'لحد نفس اليوم من الفترة اللي فاتت' : 'عن الفترة اللي فاتت';
}

// --- Quality -------------------------------------------------------------------------------------------------------

// A short label for a figure that isn't simply recorded (null for recorded ones: no chip).
export function qualityLabel(quality: Quality, ledgerDiverged = false): string | null {
  if (quality === 'recorded') return ledgerDiverged ? 'اتعدّل بعد التسجيل' : null;
  if (quality === 'reconstructed') return 'محسوب من المعاملات';
  if (quality === 'estimated') return 'تقديري';
  return 'مش متاح';
}

// What the notes of a comparison mean for the reader (only the ones worth saying).
export function noteTexts(notes: ComparisonNote[], earliestReliable?: string): string[] {
  const out: string[] = [];
  if (notes.includes('previous_untracked') && earliestReliable) {
    out.push(`البيانات المتاحة بتبدأ من ${formatDateAr(earliestReliable)}. مفيش بيانات كفاية لمقارنة دقيقة بالفترة اللي قبلها.`);
  } else if (notes.includes('previous_partly_untracked') && earliestReliable) {
    out.push(`الفترة اللي فاتت متسجّلة من ${formatDateAr(earliestReliable)} بس، فالمقارنة مش كاملة.`);
  }
  if (notes.includes('current_partly_untracked')) out.push('الفترة دي متسجّلة من بداية التتبع بس.');
  if (notes.includes('current_in_progress')) out.push('الفترة دي لسه شغالة وبتتقارن بالفترة اللي فاتت كلها.');
  return out;
}

// --- Labels ----------------------------------------------------------------------------------------------------------

export const FLOW_LABELS: Record<FlowMetricId, string> = {
  income: 'الدخل',
  expense: 'المصروف',
  net: 'الصافي',
  savingsRate: 'معدل التحويش',
  savingsRateExFundSpending: 'معدل التحويش من غير مصاريف الصناديق',
  avgDailySpending: 'متوسط المصروف في اليوم',
  expenseFromFunds: 'مصروف من صناديق',
  expenseFromFreeMoney: 'مصروف من فلوسك الحرة',
  fundContributions: 'اتحوّش للصناديق',
};

export const POINT_LABELS: Record<PointMetricId, string> = {
  netWorth: 'صافي الثروة',
  totalAssets: 'إجمالي الأصول',
  liquid: 'السيولة (فلوس في حسابات)',
  reserved: 'محجوز للصناديق',
  freeMoney: 'الفلوس الحرة',
  nonLiquid: 'غير سائل (ذهب وعملات)',
  goldValue: 'الذهب',
  currencyHoldings: 'عملات محتفظ بيها',
  liabilities: 'الالتزامات',
};

// "38.6%" for a rate; "—" when there is none.
export const rateText = (value: number | null): string => (value === null ? '—' : formatPercent(value));

// --- Charts (Phase 2b) ----------------------------------------------------------------------------------------------

// The x label of a bar: the month ("نوفمبر") or the week's first measured day ("٢٢ نوفمبر").
export function bucketLabel(bucket: Pick<FlowBucket, 'unit' | 'key' | 'from'>): string {
  return bucket.unit === 'month' ? monthShort(bucket.key) : formatDateAr(bucket.from, { year: false });
}

// The tooltip header: "نوفمبر ٢٠٢٦" / "٢٢ – ٢٨ نوفمبر ٢٠٢٦", the measured days when cut short, "لسه شغال".
export function bucketTitle(bucket: Pick<FlowBucket, 'unit' | 'key' | 'from' | 'to' | 'partial' | 'inProgress'>): string {
  const head = bucket.unit === 'month' && !bucket.partial ? formatMonthLabel(bucket.key) : range(bucket.from, bucket.to);
  return bucket.inProgress ? `${head} · لسه شغال` : head;
}

// "متوسط الشهر: دخل ج.م 20,000 · مصروف ج.م 6,000 (من 5 شهور كاملة)"; null without a complete bucket.
export function averagesLine(chart: Pick<CashflowChart, 'unit' | 'averageIncome' | 'averageExpense' | 'completeCount'>, currency: string): string | null {
  if (chart.averageIncome === null || chart.averageExpense === null) return null;
  const unit = chart.unit === 'month' ? 'الشهر' : 'الأسبوع';
  const count = chart.unit === 'month' ? monthsCount(chart.completeCount) : weeksCount(chart.completeCount);
  return `متوسط ${unit}: دخل ${formatMoney(chart.averageIncome, currency)} · مصروف ${formatMoney(chart.averageExpense, currency)} (من ${count} كاملة)`;
}

// "شهور بفايض: 4 · شهور بعجز: 1".
export function balanceCountLine(chart: Pick<CashflowChart, 'unit' | 'positive' | 'negative' | 'completeCount'>): string | null {
  if (chart.completeCount === 0) return null;
  const unit = chart.unit === 'month' ? 'شهور' : 'أسابيع';
  return `${unit} بفايض: ${chart.positive} · ${unit} بعجز: ${chart.negative}`;
}

const monthsCount = (n: number) => (n === 1 ? 'شهر' : n === 2 ? 'شهرين' : n <= 10 ? `${n} شهور` : `${n} شهر`);
const weeksCount = (n: number) => (n === 1 ? 'أسبوع' : n === 2 ? 'أسبوعين' : n <= 10 ? `${n} أسابيع` : `${n} أسبوع`);

// A footprint share from its tenths of a percent: "34.5%" (the shares add up to exactly 100%).
export const shareText = (tenths: number): string => `\u2066${tenths / 10}%\u2069`;

// «باقي الفئات» with how many it groups.
export const restLabel = (count: number): string => `باقي الفئات (${count})`;
