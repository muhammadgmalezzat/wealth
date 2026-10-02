import type { CurrencyCode, ExchangeRates } from '@/store/types';

export const DEFAULT_RATES: ExchangeRates = {
  SAR_EGP: 12.57,
  USD_EGP: 50.0,
  lastUpdated: new Date().toISOString(),
};

export const CURRENCIES: readonly CurrencyCode[] = ['EGP', 'SAR', 'USD'];

export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  EGP: 'Egyptian Pound',
  SAR: 'Saudi Riyal',
  USD: 'US Dollar',
};
