// Pure UI helpers for the Settings screen (no React Native; unit-tested).
import type { FxSource, PriceFetchError, PriceSource, Settings } from '@/store/types';
import { daysAgoPhrase, timeAgoPhrase } from '@/utils/formatters';
import { parseAmount } from '@/utils/parseAmount';

// "النهارده" · "منذ يوم" · "منذ يومين" · "منذ 5 أيام" · "منذ 14 يوم"; null days = never backed up.
export function backupAgeLabel(days: number | null): string {
  return days === null ? 'لسه مفيش نسخة' : daysAgoPhrase(days);
}

// "فرق السوق المحلي %" as typed: like parseAmount (Arabic digits too) but 0 and a leading
// minus ("-" or "−") are fine. null when it isn't a number.
export function parsePremiumPct(input: string): number | null {
  const text = input.trim().replace(/%$/, '').trim();
  const negative = /^[-−]/.test(text);
  const value = parseAmount(negative ? text.slice(1) : text, { allowZero: true });
  return value === null ? null : negative ? -value : value;
}

export const PRICE_SOURCE_OPTIONS: { label: string; value: PriceSource }[] = [
  { label: 'تلقائي', value: 'auto' },
  { label: 'يدوي', value: 'manual' },
];

export const FX_SOURCE_LABELS: Record<FxSource, string> = {
  'open.er-api': 'ExchangeRate-API',
  'exchangerate.fun': 'exchangerate.fun',
};

// What went wrong on the last live price fetch. The saved prices are always kept.
export function priceErrorMessage(error: PriceFetchError): string {
  if (error === 'network') return 'مفيش اتصال بالإنترنت أو الخدمة مش بترد. الأسعار المحفوظة زي ما هي.';
  if (error === 'gold') return 'أسعار العملات اتحدثت، بس سعر الذهب متحدّثش. سعر الذهب المحفوظ زي ما هو.';
  return 'خدمة أسعار العملات رجّعت بيانات مش سليمة. الأسعار المحفوظة زي ما هي.';
}

// "ExchangeRate-API · آخر تحديث منذ ساعتين" / "لسه متحدّثتش" before the first fetch.
export function priceStatusLine(settings: Pick<Settings, 'fxSource' | 'lastPriceFetchAt'>, now: Date = new Date()): string {
  if (!settings.lastPriceFetchAt) return 'لسه الأسعار متحدّثتش تلقائي.';
  const age = `آخر تحديث ${timeAgoPhrase(settings.lastPriceFetchAt, now)}`;
  return settings.fxSource ? `المصدر: ${FX_SOURCE_LABELS[settings.fxSource]} · ${age}` : age;
}

// Same sentence as Home's backup nudge, so both say the same thing.
export const BACKUP_NUDGE = 'يفضل تعمل نسخة احتياطية عشان بياناتك تفضل آمنة.';
