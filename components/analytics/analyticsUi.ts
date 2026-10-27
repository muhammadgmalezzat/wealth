import { formatDateAr } from '@/components/ui/formatDateAr';
import type { ColorToken } from '@/constants/theme';
import type { CategoryRow, FlowNode, FundProjection, Period, PeriodKind, SpendingFlow, DisplayCurrency } from '@/store/analytics';
import { monthOf } from '@/utils/dates';
import { formatMonthLabel, formatPercent } from '@/utils/formatters';

// Pure UI helpers for the Analytics tab (no React Native; unit-tested).

export const PERIOD_OPTIONS: { label: string; value: PeriodKind }[] = [
  { label: 'الشهر ده', value: 'month' },
  { label: '3 شهور', value: '3m' },
  { label: '6 شهور', value: '6m' },
  { label: 'السنة', value: 'year' },
  { label: 'من بداية التتبع', value: 'sinceStart' },
  { label: 'مخصص', value: 'custom' },
];

export const CURRENCY_OPTIONS: { label: string; value: DisplayCurrency }[] = [
  { label: 'ج.م', value: 'EGP' },
  { label: 'ر.س', value: 'SAR' },
];

// "أكتوبر ٢٠٢٦" · "أغسطس ٢٠٢٦ – أكتوبر ٢٠٢٦" · "١ أغسطس ٢٠٢٦ – ١٠ أغسطس ٢٠٢٦".
export function periodLabel(period: Pick<Period, 'kind' | 'from' | 'to'>): string {
  if (period.kind === 'custom') return `${formatDateAr(period.from)} – ${formatDateAr(period.to)}`;
  const from = formatMonthLabel(monthOf(period.from));
  const to = formatMonthLabel(monthOf(period.to));
  return from === to ? from : `${from} – ${to}`;
}

// Sankey / legend colours by what a node is (design tokens only).
export const FLOW_COLOR: Record<FlowNode['group'], ColorToken> = {
  income: 'primary600',
  balance: 'warning',
  essentials: 'primary700',
  lifestyle: 'gold',
  giving: 'primary500',
  funds: 'primary900',
  gold: 'goldText',
  surplus: 'borderStrong',
};

// Below this container width the Sankey doesn't fit its labels and becomes a stacked bar.
export const MIN_SANKEY_WIDTH = 300;

// 950 → "950" · 12,400 → "12k" · 1,250,000 → "1.3M" (axis labels and chart text).
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs < 1000) return `${sign}${Math.round(abs)}`;
  if (abs < 1_000_000) return `${sign}${abs < 10_000 ? (abs / 1000).toFixed(1).replace(/\.0$/, '') : Math.round(abs / 1000)}k`;
  return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

// "Oct" in Arabic, for chart axes.
export function monthShort(month: string): string {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString('ar-EG', { month: 'short' });
}

export interface ChangeText {
  text: string;
  color: ColorToken;
}

// "↑ 60%" (spending went up: amber) · "↓ 50%" (down: green) · "جديد" · "–". Empty without a comparison.
export function changeText(row: Pick<CategoryRow, 'direction' | 'changePct' | 'isNew'>): ChangeText | null {
  if (row.direction === null) return null;
  if (row.isNew) return { text: 'جديد', color: 'textSecondary' };
  if (row.direction === 'flat' || row.changePct === null) return { text: '–', color: 'textSecondary' };
  const pct = formatPercent(Math.abs(row.changePct));
  return row.direction === 'up' ? { text: `↑ ${pct}`, color: 'warning' } : { text: `↓ ${pct}`, color: 'primary700' };
}

// "شهر" · "شهرين" · "3 شهور" · "14 شهر".
export function monthsPhrase(n: number): string {
  if (n === 1) return 'شهر';
  if (n === 2) return 'شهرين';
  return n <= 10 ? `${n} شهور` : `${n} شهر`;
}

// How long money lasts: "أقل من شهر" · "3.5 شهر" · "4 شهور" · "أكتر من 10 سنين"; "—" when unknown.
export function runwayPhrase(months: number | null): string {
  if (months === null) return '—';
  if (months >= 120) return 'أكتر من 10 سنين';
  if (months < 1) return 'أقل من شهر';
  const rounded = Math.round(months * 10) / 10;
  return Number.isInteger(rounded) ? monthsPhrase(rounded) : `${rounded} شهر`;
}

// What the pace means for a fund.
export function projectionPhrase(fund: Pick<FundProjection, 'status' | 'projectedDate' | 'lateVsDue'>): string {
  if (fund.status === 'completed') return 'وصل للهدف';
  if (fund.status === 'stalled' || !fund.projectedDate) return 'مش هيخلص بالمعدل ده';
  const when = `هيخلص حوالي ${formatMonthLabel(monthOf(fund.projectedDate))}`;
  return fund.lateVsDue ? `${when}، بعد الموعد` : when;
}

export interface StackedSegment {
  node: FlowNode;
  // Share of the money that went out (0..1).
  pct: number;
}

// The narrow-screen alternative to the Sankey: where the money went, as one stacked bar —
// the three buckets, funds, gold and the surplus (not the categories).
export function stackedFlowSegments(flow: SpendingFlow): StackedSegment[] {
  const destinations = flow.nodes.filter((n) => n.kind === 'bucket' || n.kind === 'leaf');
  const total = destinations.reduce((t, n) => t + n.value, 0);
  return total > 0 ? destinations.map((node) => ({ node, pct: node.value / total })) : [];
}

// "مساعدة الأهل في الشهر" → "مساعدة الأهل في…" so labels fit beside a chart.
export function truncateLabel(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// A round axis step (1, 2, 2.5, 5 × 10ⁿ) so that `sections` steps cover `max`.
export function niceStep(max: number, sections: number): number {
  if (!(max > 0)) return 1;
  const raw = max / sections;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw - 1e-9);
  return step ?? 10 * magnitude;
}

// Axis for a chart whose values run from `min` (≤ 0 allowed) to `max`: the step, the sections above
// the axis, and the sections below it (0 when nothing is negative).
export function chartAxis(min: number, max: number, sections = 4): { step: number; above: number; below: number } {
  const step = niceStep(Math.max(max, -min, 1), min < 0 ? sections : sections);
  const above = Math.max(1, Math.ceil(Math.max(max, 0) / step - 1e-9));
  const below = min < 0 ? Math.ceil(-min / step - 1e-9) : 0;
  return { step, above, below };
}
