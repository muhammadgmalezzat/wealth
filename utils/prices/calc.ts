import type { RateTable } from '@/utils/rates';

// Live price math and response validation. Pure (no fetch, no React Native), unit-tested.

export const GRAMS_PER_TROY_OUNCE = 31.1034768;
// 21k market price is derived from 24k by purity here (18k = 24k × 0.75 is the app-wide rule).
export const KARAT_21_PURITY = 0.875;

// Anything outside these is a broken response, not a price. Deliberately wide: they only catch
// nonsense (0, negatives, a wrong unit, a currency swapped for another).
const RANGES = {
  EGP_PER_USD: [5, 1000],
  SAR_PER_USD: [2, 6],
  XAU_USD_PER_OUNCE: [200, 50_000],
} as const;
export const PREMIUM_PCT_RANGE = [-50, 100] as const;

const within = (value: unknown, [min, max]: readonly [number, number]): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// A table of the currencies the app tracks (units per USD). null unless EGP and SAR are sane.
export function fxFromUsdRates(usdRates: unknown): RateTable | null {
  if (!isRecord(usdRates)) return null;
  const { EGP, SAR } = usdRates;
  if (!within(EGP, RANGES.EGP_PER_USD) || !within(SAR, RANGES.SAR_PER_USD)) return null;
  return { base: 'USD', perUsd: { USD: 1, EGP, SAR } };
}

// https://open.er-api.com/v6/latest/USD → { result: 'success', base_code: 'USD', rates: {…} }
export function parseOpenErApi(json: unknown): RateTable | null {
  if (!isRecord(json) || json.result !== 'success' || json.base_code !== 'USD') return null;
  return fxFromUsdRates(json.rates);
}

// https://api.exchangerate.fun/latest?base=USD → { base: 'USD', rates: {…} }
export function parseExchangerateFun(json: unknown): RateTable | null {
  if (!isRecord(json) || json.base !== 'USD') return null;
  return fxFromUsdRates(json.rates);
}

// https://api.gold-api.com/price/XAU → { symbol: 'XAU', currency: 'USD', price } (USD per troy
// ounce). null unless it is gold, in USD, at a sane price.
export function parseGoldApi(json: unknown): number | null {
  if (!isRecord(json) || json.symbol !== 'XAU') return null;
  if (json.currency !== undefined && json.currency !== 'USD') return null;
  return within(json.price, RANGES.XAU_USD_PER_OUNCE) ? json.price : null;
}

export interface GoldPrices {
  goldPrice24kEGP: number;
  goldPrice21kEGP: number;
}

// EGP per gram from the world price: (USD per ounce ÷ grams per ounce) × USD_EGP, plus the
// user's local-market premium. 21k = 24k × 0.875.
export function goldPricesEGP(xauUsdPerOunce: number, usdEGP: number, localPremiumPct = 0): GoldPrices {
  const goldPrice24kEGP = (xauUsdPerOunce / GRAMS_PER_TROY_OUNCE) * usdEGP * (1 + localPremiumPct / 100);
  return { goldPrice24kEGP, goldPrice21kEGP: goldPrice24kEGP * KARAT_21_PURITY };
}

export function isValidPremiumPct(value: number): boolean {
  return within(value, PREMIUM_PCT_RANGE);
}
