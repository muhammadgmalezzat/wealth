import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// The v8 currency engine: one rate table against USD, conversion A → USD → B, immutable content-addressed
// snapshots. No state and no React Native imports. See docs/architecture/CURRENCY_AND_FUNDS_DESIGN.md §B1.
//
// Conversion returns an UNROUNDED number; the caller rounds once, at the boundary (utils/money.ts).

// Units of each currency per 1 USD. perUsd.USD is always 1.
export interface RateTable {
  base: 'USD';
  perUsd: Record<string, number>;
}

export type RateSource = 'manual' | 'open.er-api' | 'exchangerate.fun' | 'migrated';
// 'estimated': rebuilt by the v7 → v8 migration for a record that had no snapshot of its own.
export type RateQuality = 'recorded' | 'estimated';

// Immutable, append-only and deduplicated. The id is derived from the content, so the same table
// always has the same id: the migration is idempotent and two devices never disagree on an id.
export interface RateSnapshot extends RateTable {
  id: string;
  takenAt: string;
  source: RateSource;
  quality: RateQuality;
}

// The CURRENT table: what current valuations use. Mutable (a manual edit or a live fetch).
export interface CurrentRates extends RateTable {
  updatedAt: string;
  source: RateSource;
}

export class RateMissingError extends Error {
  override name = 'RateMissingError';
  readonly currency: string;

  constructor(currency: string) {
    super(`No exchange rate for "${currency}"`);
    this.currency = currency;
  }
}

const rateOf = (table: RateTable, currency: string): number => {
  const rate = table.perUsd[currency];
  if (!(typeof rate === 'number' && Number.isFinite(rate) && rate > 0)) throw new RateMissingError(currency);
  return rate;
};

export const hasRate = (table: RateTable, currency: string): boolean => {
  const rate = table.perUsd[currency];
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
};

// `amount` of `from` in `to` through USD. The same currency comes back untouched (no rate, no float noise).
export function convert(amount: number, from: string, to: string, table: RateTable): number {
  if (from === to) return amount;
  return (amount / rateOf(table, from)) * rateOf(table, to);
}

// How many `to` one unit of `from` is worth.
export const rateBetween = (from: string, to: string, table: RateTable): number => convert(1, from, to, table);

// A table from the v7 EGP-pivot rates: `egpPer[c]` is how many EGP one unit of c is worth (EGP = 1).
// perUsd[c] = egpPer.USD / egpPer[c], so every pairwise rate A → B = egpPer[A] / egpPer[B] is exactly
// what v7 used. `override` replaces one currency's EGP rate first (a record's own, possibly typed, rate).
export function tableFromEgpRates(egpPer: Record<string, number>, override?: { currency: string; egpPerUnit: number }): RateTable {
  const egp: Record<string, number> = { ...egpPer, EGP: 1 };
  if (override) egp[override.currency] = override.egpPerUnit;
  const usd = egp.USD;
  const perUsd: Record<string, number> = {};
  for (const [currency, rate] of Object.entries(egp)) perUsd[currency] = usd / rate;
  perUsd.USD = 1;
  return { base: 'USD', perUsd };
}

// A stable text for a table: currencies sorted, numbers in their shortest exact form.
function canonical(table: RateTable, quality: RateQuality): string {
  const rows = Object.keys(table.perUsd)
    .sort()
    .map((c) => `${c}=${table.perUsd[c]}`);
  return `${quality}|${rows.join(',')}`;
}

// First 16 hex characters of the SHA-256 of the canonical text (the text is ASCII).
export function snapshotId(table: RateTable, quality: RateQuality = 'recorded'): string {
  const text = canonical(table, quality);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return `rs-${bytesToHex(sha256(bytes)).slice(0, 16)}`;
}

export function makeSnapshot(
  table: RateTable,
  meta: { takenAt: string; source: RateSource; quality?: RateQuality }
): RateSnapshot {
  const quality = meta.quality ?? 'recorded';
  return {
    id: snapshotId(table, quality),
    base: 'USD',
    perUsd: { ...table.perUsd },
    takenAt: meta.takenAt,
    source: meta.source,
    quality,
  };
}

export function sameTable(a: RateTable, b: RateTable): boolean {
  const keys = Object.keys(a.perUsd);
  return keys.length === Object.keys(b.perUsd).length && keys.every((k) => a.perUsd[k] === b.perUsd[k]);
}

// The snapshot to attach to a record written now: the one with the current table's id if it exists,
// otherwise a new one (the caller appends it). Pure: `existing` is never changed.
export function snapshotForWrite(
  existing: readonly RateSnapshot[],
  current: RateTable,
  meta: { takenAt: string; source: RateSource }
): { snapshot: RateSnapshot; isNew: boolean } {
  const id = snapshotId(current, 'recorded');
  const found = existing.find((s) => s.id === id);
  return found ? { snapshot: found, isNew: false } : { snapshot: makeSnapshot(current, meta), isNew: true };
}

// Lookup by id, with a cached index per array (snapshot lists are append-only and read constantly).
const indexCache = new WeakMap<readonly RateSnapshot[], Map<string, RateSnapshot>>();
export function snapshotById(snapshots: readonly RateSnapshot[], id: string): RateSnapshot | undefined {
  let index = indexCache.get(snapshots);
  if (!index) {
    index = new Map(snapshots.map((s) => [s.id, s]));
    indexCache.set(snapshots, index);
  }
  return index.get(id);
}
