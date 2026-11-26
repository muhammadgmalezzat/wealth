// Pure UI helpers for the Settings screen (no React Native; unit-tested).
import { formatDateAr } from '@/components/ui/formatDateAr';
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
// «استيراد البيانات الافتتاحية» replaces ALL data with the seed. In production the seed is the synthetic example
// (store/seed.local.ts is development-only), so importing it would put sample data over real data: the entry point
// exists in development builds only. Settings hides it and the store action refuses it when this is false.
export const canImportOpeningData = (isDev: boolean): boolean => isDev;

export const BACKUP_NUDGE = 'يفضل تعمل نسخة احتياطية عشان بياناتك تفضل آمنة.';

// --- Daily history (data v10, store/useDailySnapshots.ts) ---------------------------------------------------------

// "يوم واحد" · "يومين" · "3 أيام" · "11 يوم".
export function dayCountPhrase(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوم`;
}

export type DailyLogStatus = 'loading' | 'ready' | 'unreadable' | 'oversized' | 'invalid' | 'full' | 'write_failed';

// Paused states: the stored history can't be used (left untouched) and «ابدأ سجل جديد» is offered.
export const dailyLogBroken = (status: DailyLogStatus): boolean => status === 'unreadable' || status === 'oversized' || status === 'invalid';

// The Settings line under «السجل اليومي». Every problem says the rest of the data is fine (it is: the ledger never
// depends on the history).
export function dailyLogLine(status: DailyLogStatus, summary: { days: number; firstDate: string | null }): string {
  if (status === 'loading') return 'بيتحمّل…';
  if (dailyLogBroken(status)) return 'السجل اليومي مش سليم، فالتسجيل واقف. باقي بياناتك سليمة.';
  if (status === 'full') return 'السجل اليومي وصل للحد الأقصى، فالتسجيل واقف. باقي بياناتك سليمة.';
  if (status === 'write_failed') return 'آخر تسجيل ما اتحفظش، وهيتحاول تاني.';
  if (summary.days === 0 || !summary.firstDate) return 'هيبدأ يسجّل وضعك من النهارده.';
  return `بيسجّل وضعك كل يوم · من ${formatDateAr(summary.firstDate)} · ${dayCountPhrase(summary.days)}`;
}

// The restore preview row: what the file carries.
export function dailyPreviewLabel(days: number | null | 'invalid'): string {
  if (days === 'invalid') return 'مش سليم';
  if (days === null || days === 0) return 'مفيش';
  return dayCountPhrase(days);
}
