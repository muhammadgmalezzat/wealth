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

export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}
