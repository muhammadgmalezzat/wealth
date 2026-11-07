import type { ExchangeRates } from '@/store/legacy/types.v7';
import type { CurrencyCode } from '@/store/types';

import { CURRENCY_REGISTRY } from './currencyRegistry';

// The v7-shaped default rates the (private, v3-shaped) seed files are written with; the v7 → v8 step turns
// them into a rate table.
export const DEFAULT_RATES: ExchangeRates = {
  SAR_EGP: 12.57,
  USD_EGP: 50.0,
  lastUpdated: new Date().toISOString(),
};

// The currencies a new install starts with (settings.enabledCurrencies).
export const DEFAULT_ENABLED_CURRENCIES: readonly CurrencyCode[] = ['EGP', 'SAR', 'USD'];

// Short Arabic name for pickers and rows ("ر.س" / "ج.م" symbols come from formatMoney). An unknown code
// shows as itself, so data from a newer registry never crashes a screen.
export const currencyNameAr = (code: CurrencyCode): string => CURRENCY_REGISTRY[code]?.nameAr ?? code;

export const currencyLabel = (code: CurrencyCode): string => CURRENCY_REGISTRY[code]?.nameEn ?? code;
