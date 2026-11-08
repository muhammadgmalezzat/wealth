import type { RateSnapshot, RateTable } from './rates';
import { convert, RateMissingError, snapshotById } from './rates';

// Conversion rule (see "Currency" in docs/TECHNICAL.md): amounts that already happened are converted
// with the rate snapshot of their own moment and never move when settings rates change; only CURRENT
// valuations (balances, gold, net worth) and amounts being entered now use today's table.
//
// Everything here is the v8 engine (utils/rates.ts: one table against USD, A → USD → B). Results are
// unrounded; callers round at the boundary (utils/money.ts).

// --- Current valuations: today's table ---------------------------------------------------------

// How many EGP one unit of `currency` is worth at the given rates.
export const rateToEGP = (currency: string, rates: RateTable): number => convert(1, currency, 'EGP', rates);

export const toEGP = (amount: number, currency: string, rates: RateTable): number =>
  convert(amount, currency, 'EGP', rates);

export const fromEGP = (amountEGP: number, targetCurrency: string, rates: RateTable): number =>
  convert(amountEGP, 'EGP', targetCurrency, rates);

// `amount` from one currency to another at `rates`. The same currency comes back untouched (no rate
// is involved, so not even float noise).
export const convertCurrency = (amount: number, from: string, to: string, rates: RateTable): number =>
  convert(amount, from, to, rates);

// --- Past amounts: the record's own snapshot ---------------------------------------------------

export class RateSnapshotMissingError extends RateMissingError {
  override name = 'RateSnapshotMissingError';
  readonly snapshotId: string;

  constructor(snapshotId: string) {
    super(`snapshot ${snapshotId}`);
    this.snapshotId = snapshotId;
  }
}

// The snapshot a record points at; a dangling id is corrupt data, never silently today's rates.
export function requireSnapshot(snapshots: readonly RateSnapshot[], snapshotId: string): RateSnapshot {
  const snapshot = snapshotById(snapshots, snapshotId);
  if (!snapshot) throw new RateSnapshotMissingError(snapshotId);
  return snapshot;
}

// An amount that already happened, in another currency, as it was worth then. Same currency:
// unchanged, and no snapshot is read.
export function projectAmount(
  snapshots: readonly RateSnapshot[],
  snapshotId: string,
  amount: number,
  from: string,
  to: string
): number {
  return from === to ? amount : convert(amount, from, to, requireSnapshot(snapshots, snapshotId));
}
