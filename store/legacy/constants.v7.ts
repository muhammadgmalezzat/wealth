// FROZEN: the v7 values the migration chain used (constants/currencies.ts and constants/market.ts at
// data v7). Do not edit. The live constants move to the v8 registries.
import type { ExchangeRates } from './types.v7';

export const DEFAULT_RATES: ExchangeRates = {
  SAR_EGP: 12.57,
  USD_EGP: 50.0,
  lastUpdated: new Date().toISOString(),
};

export const GOLD_PRICE_24K = 6_500; // EGP per gram of 24k gold
export const GOLD_PRICE_21K = (GOLD_PRICE_24K * 21) / 24;
export const DEFAULT_TRACKING_START_DATE = '2026-08-05';
