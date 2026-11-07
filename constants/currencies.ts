import type { ExchangeRates } from '@/store/legacy/types.v7';
import type { CurrencyCode } from '@/store/types';

// The v7-shaped default rates the (private, v3-shaped) seed files are written with; the v7 → v8 step turns
// them into a rate table.
export const DEFAULT_RATES: ExchangeRates = {
  SAR_EGP: 12.57,
  USD_EGP: 50.0,
  lastUpdated: new Date().toISOString(),
};

export const CURRENCIES: readonly CurrencyCode[] = ['EGP', 'SAR', 'USD'];

// Short Arabic names for pickers and rows ("ر.س" / "ج.م" symbols come from formatMoney).
export const CURRENCY_NAMES_AR: Record<CurrencyCode, string> = {
  EGP: 'جنيه',
  SAR: 'ريال',
  USD: 'دولار',
};

export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  EGP: 'Egyptian Pound',
  SAR: 'Saudi Riyal',
  USD: 'US Dollar',
};
