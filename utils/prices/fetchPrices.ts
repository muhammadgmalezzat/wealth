import type { FxSource, PriceFetchError, RatesSnapshot, Settings } from '@/store/types';

import { parseExchangerateFun, parseGoldApi, parseOpenErApi } from './calc';

// Live prices from free, key-less APIs, called straight from the app. Nothing here throws:
// every failure ends up as an `error` code in the result. No React Native imports (only the
// standard fetch, which tests replace), so it runs in Node tests.

export const FX_PRIMARY_URL = 'https://open.er-api.com/v6/latest/USD';
export const FX_FALLBACK_URL = 'https://api.exchangerate.fun/latest?base=USD';
export const GOLD_URL = 'https://api.gold-api.com/price/XAU';
// open.er-api.com's free tier asks for this link wherever its rates are shown.
export const FX_ATTRIBUTION_URL = 'https://www.exchangerate-api.com';

export const FETCH_TIMEOUT_MS = 10_000;
// Auto mode refetches when the last successful fetch is older than this…
export const AUTO_FETCH_INTERVAL_MS = 6 * 60 * 60 * 1000;
// …and after a failed attempt waits this long before trying again on its own.
export const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;
// "Fetched successfully recently" for the Next Best Action price rule.
export const FRESH_FETCH_MS = 24 * 60 * 60 * 1000;

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export interface PriceFetchResult {
  // null when neither FX source gave usable rates.
  fx: RatesSnapshot | null;
  fxSource?: FxSource;
  // USD per troy ounce; null when the gold source failed.
  xauUsd: number | null;
  // 'network': nothing could be reached · 'fx' / 'gold': that part failed or was invalid.
  error?: PriceFetchError;
}

type Attempt<T> = { value: T | null; reached: boolean };

// One GET with a timeout, parsed and validated. `reached` tells a bad answer from no answer.
async function getValid<T>(url: string, parse: (json: unknown) => T | null, fetchImpl: FetchLike, timeoutMs: number): Promise<Attempt<T>> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error('timeout'));
      }, timeoutMs);
    });
    const response = await Promise.race([fetchImpl(url, { signal: controller?.signal }), timeout]);
    if (!response.ok) return { value: null, reached: true };
    const json = await Promise.race([response.json(), timeout]);
    return { value: parse(json), reached: true };
  } catch {
    return { value: null, reached: false };
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

// FX from the primary source, the fallback only when that fails or is invalid; gold in parallel.
export async function fetchLivePrices({ fetchImpl = fetch as FetchLike, timeoutMs = FETCH_TIMEOUT_MS }: FetchOptions = {}): Promise<PriceFetchResult> {
  const fxAttempt = async (): Promise<Attempt<RatesSnapshot> & { source?: FxSource }> => {
    const primary = await getValid(FX_PRIMARY_URL, parseOpenErApi, fetchImpl, timeoutMs);
    if (primary.value) return { ...primary, source: 'open.er-api' };
    const fallback = await getValid(FX_FALLBACK_URL, parseExchangerateFun, fetchImpl, timeoutMs);
    return { value: fallback.value, reached: primary.reached || fallback.reached, ...(fallback.value ? { source: 'exchangerate.fun' as const } : {}) };
  };
  const [fx, gold] = await Promise.all([fxAttempt(), getValid(GOLD_URL, parseGoldApi, fetchImpl, timeoutMs)]);

  const error: PriceFetchError | undefined = fx.value
    ? gold.value === null
      ? 'gold'
      : undefined
    : !fx.reached && !gold.reached
      ? 'network'
      : 'fx';
  return {
    fx: fx.value,
    ...(fx.source ? { fxSource: fx.source } : {}),
    xauUsd: gold.value,
    ...(error ? { error } : {}),
  };
}

type PriceSettings = Pick<Settings, 'priceSource' | 'lastPriceFetchAt' | 'lastPriceFetchError'>;

// Missing = 'manual': data saved before the setting existed (existing installs, older backups)
// has prices the user typed, which must not be overwritten. Fresh installs are set to 'auto'
// explicitly on first launch (ensurePriceSource).
export function priceSourceOf(settings: Pick<Settings, 'priceSource'>): 'auto' | 'manual' {
  return settings.priceSource === 'auto' ? 'auto' : 'manual';
}

// Whether auto mode should fetch now: never in manual mode; otherwise when there has been no
// successful fetch for 6 hours, and not within 15 minutes of the last attempt (`lastAttemptAt`,
// ms, kept in memory by the caller) so failures don't cause a request on every foreground.
export function shouldAutoFetch(settings: PriceSettings, now: Date, lastAttemptAt?: number): boolean {
  if (priceSourceOf(settings) !== 'auto') return false;
  if (lastAttemptAt !== undefined && now.getTime() - lastAttemptAt < RETRY_AFTER_FAILURE_MS) return false;
  const last = settings.lastPriceFetchAt ? Date.parse(settings.lastPriceFetchAt) : NaN;
  return Number.isNaN(last) || now.getTime() - last >= AUTO_FETCH_INTERVAL_MS;
}

// Auto mode fetched everything without an error in the last 24 hours.
export function pricesFetchedRecently(settings: PriceSettings, now: Date): boolean {
  if (priceSourceOf(settings) !== 'auto' || settings.lastPriceFetchError) return false;
  const last = settings.lastPriceFetchAt ? Date.parse(settings.lastPriceFetchAt) : NaN;
  return !Number.isNaN(last) && now.getTime() - last < FRESH_FETCH_MS;
}
