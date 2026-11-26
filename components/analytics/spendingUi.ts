import { formatDateAr } from '@/components/ui/formatDateAr';
import { formatMoney } from '@/components/ui/formatMoney';
import type { SpendBar } from '@/store/spending';
import { formatPercent } from '@/utils/formatters';

// Pure copy for the «الإنفاق» tab (Phase 3; no React Native, unit-tested). Egyptian colloquial like the app.

export const trendTitle = (unit: 'day' | 'week'): string => (unit === 'day' ? 'المصروف يوم بيوم' : 'المصروف أسبوع بأسبوع');

// "المتوسط: ج.م 231.35 في اليوم" (the reference line); null without bars.
export function averageLabel(unit: 'day' | 'week', average: number | null, currency: string): string | null {
  if (average === null) return null;
  return `المتوسط: ${formatMoney(average, currency)} في ${unit === 'day' ? 'اليوم' : 'الأسبوع'}`;
}

// A bar's tooltip: "٢٢ نوفمبر ٢٠٢٦: ج.م 700" / "٢٢ – ٢٨ نوفمبر ٢٠٢٦: …".
export function barTitle(bar: SpendBar, currency: string): string {
  const when = bar.from === bar.to ? formatDateAr(bar.from) : `${formatDateAr(bar.from)} – ${formatDateAr(bar.to)}`;
  return `${when}: ${formatMoney(bar.amount, currency)}`;
}

// "لمرة واحدة: ج.م 700 (11.6% من مصروف الفترة)" — the old note's numbers; or that there is none.
export function oneTimeLine(amount: number, ofTotal: number | null, currency: string): string {
  if (amount < 0.005 || ofTotal === null) return 'مفيش مصاريف لمرة واحدة في الفترة دي.';
  return `لمرة واحدة: ${formatMoney(amount, currency)} (${formatPercent(ofTotal)} من مصروف الفترة)`;
}

// "ج.م 1,500 من صناديق · ج.م 4,515 من فلوسك الحرة".
export function sourcesLine(fromFunds: number | null, fromFree: number | null, currency: string): string | null {
  if (fromFunds === null || fromFree === null) return null;
  return `${formatMoney(fromFunds, currency)} من صناديق · ${formatMoney(fromFree, currency)} من فلوسك الحرة`;
}
