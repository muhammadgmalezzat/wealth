import { makeSnapshot, snapshotId, tableFromEgpRates, type RateQuality, type RateSnapshot, type RateTable } from '@/utils/rates';

import type { MigrationContext } from './migrations';
import type {
  Account as AccountV7,
  FinanceState as FinanceStateV7,
  FundMovement as FundMovementV7,
  NetWorthBreakdown as NetWorthBreakdownV7,
  NetWorthSnapshot as NetWorthSnapshotV7,
  RatesSnapshot as RatesSnapshotV7,
  Transaction as TransactionV7,
} from './legacy/types.v7';
import type { FinanceState, FundMovement, Holding, NetWorthBreakdown, NetWorthSnapshot, Transaction } from './types';

// v7 → v8 (docs/architecture/CURRENCY_AND_FUNDS_DESIGN.md §F). Pure and deterministic; reads a v7 state
// (frozen types) and returns a v8 one. Built up step by step during Phase B; each step below is one
// dimension of the change. Nothing here may change a native amount.

// --- F4: locations become ISO country codes ---------------------------------------------------------

// v7 read a missing holding location as Egypt, and subtracted every liability from Egypt's net worth.
// The migration makes both explicit so every v7 number stays the same. (`EG` / `SA` already are ISO
// 3166-1 codes.)
const V7_DEFAULT_COUNTRY = 'EG';

function breakdownV8(b: NetWorthBreakdownV7): NetWorthBreakdown {
  return {
    EG: { ...b.EG, liabilitiesEGP: b.liabilitiesEGP },
    SA: { ...b.SA, liabilitiesEGP: 0 },
  };
}

// --- F2: rates become a USD table, and every record points at an immutable snapshot -----------------

// Collects the snapshots the records need, deduplicated by content (same table → same id).
class SnapshotBook {
  private readonly byId = new Map<string, RateSnapshot>();

  // The id for `table`; `takenAt` is the earliest time any record using it was made.
  add(table: RateTable, quality: RateQuality, takenAt: string): string {
    const id = snapshotId(table, quality);
    const existing = this.byId.get(id);
    if (!existing) this.byId.set(id, makeSnapshot(table, { takenAt, source: 'migrated', quality }));
    else if (takenAt < existing.takenAt) this.byId.set(id, { ...existing, takenAt });
    return id;
  }

  list(): RateSnapshot[] {
    return [...this.byId.values()].sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : a.id < b.id ? -1 : 1));
  }
}

// v7 rates are "EGP per unit"; this is that map for a snapshot.
const egpPer = (rates: { SAR_EGP: number; USD_EGP: number }): Record<string, number> => ({
  SAR: rates.SAR_EGP,
  USD: rates.USD_EGP,
});

// A record's own table. v7 converted a past amount as: source leg at the record's own `rateToEGP`, target
// leg at the rates of its snapshot (today's rates when it had none). Taking the snapshot's EGP rates,
// replacing the record's currency by its own `rateToEGP`, and re-basing on USD reproduces every pairwise
// rate exactly. A record with no snapshot is marked 'estimated': it is frozen at the rates of the migration
// (v7 let it drift with today's rates).
function recordTable(
  snapshot: RatesSnapshotV7 | undefined,
  current: RatesSnapshotV7,
  own?: { currency: string; rateToEGP: number }
): { table: RateTable; quality: RateQuality } {
  const table = tableFromEgpRates(
    egpPer(snapshot ?? current),
    own && own.currency !== 'EGP' ? { currency: own.currency, egpPerUnit: own.rateToEGP } : undefined
  );
  return { table, quality: snapshot ? 'recorded' : 'estimated' };
}

function migrateTransactions(
  v7: FinanceStateV7,
  book: SnapshotBook,
  current: RatesSnapshotV7
): Transaction[] {
  const currencyOf = new Map(v7.accounts.map((a: AccountV7) => [a.id, a.currency]));
  return v7.transactions.map((tx: TransactionV7) => {
    const { rateToEGP, ratesSnapshot, ...rest } = tx;
    // The currency rateToEGP is about: the transaction's own, or the source account's for transfers.
    const currency = tx.type === 'transfer' ? (currencyOf.get(tx.fromAccountId) ?? 'EGP') : tx.currency;
    const { table, quality } = recordTable(ratesSnapshot, current, { currency, rateToEGP });
    return { ...rest, rateSnapshotId: book.add(table, quality, tx.createdAt) } as Transaction;
  });
}

function migrateMovements(v7: FinanceStateV7, book: SnapshotBook, current: RatesSnapshotV7): FundMovement[] {
  return v7.fundMovements.map((m: FundMovementV7) => {
    const { ratesSnapshot, ...rest } = m;
    const { table, quality } = recordTable(ratesSnapshot, current);
    return { ...rest, rateSnapshotId: book.add(table, quality, m.updatedAt) };
  });
}

function migrateNetWorth(v7: FinanceStateV7, book: SnapshotBook, current: RatesSnapshotV7): NetWorthSnapshot[] {
  return v7.netWorthSnapshots.map((s: NetWorthSnapshotV7) => {
    const { breakdown, ratesSnapshot, ...rest } = s;
    const { table, quality } = recordTable(ratesSnapshot, current);
    return {
      ...rest,
      ...(breakdown ? { breakdown: breakdownV8(breakdown) } : {}),
      rateSnapshotId: book.add(table, quality, s.takenAt),
    };
  });
}

export function migrateV7toV8(v7: FinanceStateV7, _ctx: MigrationContext): FinanceState {
  // F4 — countries
  const accounts = v7.accounts.map(({ location, ...rest }) => ({ ...rest, country: location }));
  const holdings = v7.holdings.map(({ location, ...rest }) => ({
    ...rest,
    country: location ?? V7_DEFAULT_COUNTRY,
  })) as Holding[];
  const liabilities = v7.liabilities.map((l) => ({ ...l, country: V7_DEFAULT_COUNTRY }));

  // F2 — rates
  const { exchangeRates, ...settingsRest } = v7.settings;
  const book = new SnapshotBook();
  const transactions = migrateTransactions(v7, book, exchangeRates);
  const fundMovements = migrateMovements(v7, book, exchangeRates);
  const netWorthSnapshots = migrateNetWorth(v7, book, exchangeRates);
  const settings = {
    ...settingsRest,
    rates: {
      ...tableFromEgpRates(egpPer(exchangeRates)),
      updatedAt: exchangeRates.lastUpdated,
      source: settingsRest.priceSource === 'auto' && settingsRest.fxSource ? settingsRest.fxSource : ('manual' as const),
    },
  };

  return {
    ...v7,
    rateSnapshots: book.list(),
    accounts,
    holdings,
    liabilities,
    transactions,
    fundMovements,
    netWorthSnapshots,
    settings,
  };
}
