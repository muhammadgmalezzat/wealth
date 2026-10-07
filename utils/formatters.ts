import type { CurrencyCode } from '@/store/types';
import { fromDateKey, shiftDate, toDateKey } from '@/utils/dates';

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  EGP: 'ج.م',
  SAR: 'ر.س',
  USD: '$',
};

export function currencySymbol(currency: CurrencyCode): string {
  return CURRENCY_SYMBOLS[currency];
}

export function formatCurrency(
  amount: number,
  currency: CurrencyCode
): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  // Float noise like -0.0000001 would otherwise print as "-0".
  const value = Math.abs(amount) < 0.005 ? 0 : amount;
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${symbol} ${formatted}`;
}

// Accepts a 'YYYY-MM-DD' date key (parsed as a local date) or a full ISO timestamp.
export function formatDate(isoString: string): string {
  const date = isoString.length === 10 ? fromDateKey(isoString) : new Date(isoString);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "النهارده" / "امبارح" / "الثلاثاء ٣ أكتوبر"
export function formatDayLabel(dateKey: string, now: Date = new Date()): string {
  const today = toDateKey(now);
  if (dateKey === today) return 'النهارده';
  if (dateKey === shiftDate(today, -1)) return 'امبارح';
  return fromDateKey(dateKey).toLocaleDateString('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

// 'YYYY-MM' → "أكتوبر ٢٠٢٦"
export function formatMonthLabel(month: string): string {
  return fromDateKey(`${month}-01`).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
}

// 0.123 → "12.3%", with showSign "+12.3%" / "−4%". Isolated left-to-right (like formatMoney) so
// Arabic text around it can't move the sign or the % sign.
export function formatPercent(ratio: number, showSign = false): string {
  const pct = Math.round(ratio * 1000) / 10;
  const sign = pct < 0 ? '−' : showSign && pct > 0 ? '+' : '';
  return `⁦‎${sign}${Math.abs(pct)}%⁩`;
}

// "مستحق واحد" / "مستحقين" / "3 مستحقات" / "11 مستحق" (+ "محتاج مراجعة" agreeing with it).
export function dueCountPhrase(n: number): string {
  if (n === 1) return 'مستحق واحد محتاج مراجعة';
  if (n === 2) return 'مستحقين محتاجين مراجعة';
  if (n >= 3 && n <= 10) return `${n} مستحقات محتاجة مراجعة`;
  return `${n} مستحق محتاج مراجعة`;
}

// "خلال يوم" / "خلال يومين" / "خلال 3 أيام" / "خلال 14 يوم".
export function withinDaysPhrase(days: number): string {
  if (days <= 1) return 'خلال يوم';
  if (days === 2) return 'خلال يومين';
  if (days <= 10) return `خلال ${days} أيام`;
  return `خلال ${days} يوم`;
}

// "النهارده" · "منذ يوم" · "منذ يومين" · "منذ 5 أيام" · "منذ 14 يوم".
export function daysAgoPhrase(days: number): string {
  if (days <= 0) return 'النهارده';
  if (days === 1) return 'منذ يوم';
  if (days === 2) return 'منذ يومين';
  if (days <= 10) return `منذ ${days} أيام`;
  return `منذ ${days} يوم`;
}

// "كمان حاجة واحدة" · "كمان حاجتين" · "كمان 3 حاجات" · "كمان 11 حاجة".
export function moreThingsPhrase(n: number): string {
  if (n === 1) return 'كمان حاجة واحدة';
  if (n === 2) return 'كمان حاجتين';
  if (n <= 10) return `كمان ${n} حاجات`;
  return `كمان ${n} حاجة`;
}

export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}
