/* eslint-disable @typescript-eslint/no-explicit-any -- the steps read states of several intermediate shapes; each checks what it needs. */
import { isKnownCurrency } from '@/constants/currencyRegistry';
import { roundMoney } from '@/utils/money';
import { makeSnapshot, snapshotId, tableFromEgpRates, type RateQuality, type RateSnapshot, type RateTable } from '@/utils/rates';

import type { MigrationContext } from './migrations';
import type { FinanceState } from './types';

// v7 → v8 (docs/architecture/CURRENCY_AND_FUNDS_DESIGN.md §F), as ORDERED, IDEMPOTENT sub-steps.
//
// Data v8 was built over several commits, and a device can hold a v8 payload from any of them. So the
// migration is not "v7 → v8 once": `settings.v8Step` records how many sub-steps a state has had, every
// sub-step also checks the shape it needs (it does nothing to data already in the new shape), and
// `applyV8Steps` runs the remaining ones on ANY of: a v7 state, a v8 state from an older step, or a
// current one. So migrating twice is migrating once, and a payload stored at version 8 by an earlier build
// is completed on hydration (see createPersistOptions `normalize`).
//
// Nothing here may change a native amount beyond rounding it to its currency's decimals (step 4).

type Draft = Record<string, any>;

// v7 read a missing holding location as Egypt, and subtracted every liability from Egypt's net worth.
// The migration makes both explicit so every v7 number stays the same. (`EG` / `SA` already are ISO
// 3166-1 codes.)
const V7_DEFAULT_COUNTRY = 'EG';

// --- 1. locations become ISO country codes -------------------------------------------------------------

function breakdownV8(b: Draft): Draft {
  return { EG: { ...b.EG, liabilitiesEGP: b.liabilitiesEGP }, SA: { ...b.SA, liabilitiesEGP: 0 } };
}

function stepCountries(s: Draft): Draft {
  return {
    ...s,
    accounts: s.accounts.map(({ location, ...a }: Draft) => ('country' in a ? a : { ...a, country: location })),
    holdings: s.holdings.map(({ location, ...h }: Draft) => ('country' in h ? h : { ...h, country: location ?? V7_DEFAULT_COUNTRY })),
    liabilities: s.liabilities.map((l: Draft) => ('country' in l ? l : { ...l, country: V7_DEFAULT_COUNTRY })),
    // The v7 breakdown had Egypt and Saudi side by side and ONE liabilities total (Egypt's).
    netWorthSnapshots: s.netWorthSnapshots.map((n: Draft) =>
      n.breakdown && typeof n.breakdown.liabilitiesEGP === 'number' ? { ...n, breakdown: breakdownV8(n.breakdown) } : n
    ),
  };
}

// --- 2. rates become a USD table; records point at immutable snapshots ---------------------------------

// Collects the snapshots the records need, deduplicated by content (same table → same id).
class SnapshotBook {
  private readonly byId: Map<string, RateSnapshot>;

  constructor(existing: RateSnapshot[]) {
    this.byId = new Map(existing.map((snap) => [snap.id, snap]));
  }

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
const egpPer = (rates: Draft): Record<string, number> => ({
  SAR: rates.SAR_EGP,
  USD: rates.USD_EGP,
});

// A record's own table. v7 converted a past amount as: source leg at the record's own `rateToEGP`, target
// leg at the rates of its snapshot (today's rates when it had none). Taking the snapshot's EGP rates,
// replacing the record's currency by its own `rateToEGP`, and re-basing on USD reproduces every pairwise
// rate exactly. A record with no snapshot is marked 'estimated': it is frozen at the rates of the migration
// (v7 let it drift with today's rates).
function recordTable(
  snapshot: Draft | undefined,
  current: Draft,
  own?: { currency: string; rateToEGP: number }
): { table: RateTable; quality: RateQuality } {
  const table = tableFromEgpRates(
    egpPer(snapshot ?? current),
    own && own.currency !== 'EGP' ? { currency: own.currency, egpPerUnit: own.rateToEGP } : undefined
  );
  return { table, quality: snapshot ? 'recorded' : 'estimated' };
}

function stepRates(s: Draft): Draft {
  const { exchangeRates, ...settingsRest } = s.settings;
  // Already a table: nothing to convert (every record then has its rateSnapshotId).
  if (!exchangeRates) return s;

  const book = new SnapshotBook(s.rateSnapshots ?? []);
  const currencyOf = new Map<string, string>(s.accounts.map((a: Draft) => [a.id, a.currency]));

  const transactions = s.transactions.map((tx: Draft) => {
    if ('rateSnapshotId' in tx) return tx;
    const { rateToEGP, ratesSnapshot, ...rest } = tx;
    // The currency rateToEGP is about: the transaction's own, or the source account's for transfers.
    const currency = tx.type === 'transfer' ? (currencyOf.get(tx.fromAccountId) ?? 'EGP') : tx.currency;
    const { table, quality } = recordTable(ratesSnapshot, exchangeRates, { currency, rateToEGP });
    return { ...rest, rateSnapshotId: book.add(table, quality, tx.createdAt) };
  });
  const fundMovements = s.fundMovements.map((m: Draft) => {
    if ('rateSnapshotId' in m) return m;
    const { ratesSnapshot, ...rest } = m;
    const { table, quality } = recordTable(ratesSnapshot, exchangeRates);
    return { ...rest, rateSnapshotId: book.add(table, quality, m.updatedAt) };
  });
  const netWorthSnapshots = s.netWorthSnapshots.map((n: Draft) => {
    if ('rateSnapshotId' in n) return n;
    const { ratesSnapshot, ...rest } = n;
    const { table, quality } = recordTable(ratesSnapshot, exchangeRates);
    return { ...rest, rateSnapshotId: book.add(table, quality, n.takenAt) };
  });

  return {
    ...s,
    rateSnapshots: book.list(),
    transactions,
    fundMovements,
    netWorthSnapshots,
    settings: {
      ...settingsRest,
      rates: {
        ...tableFromEgpRates(egpPer(exchangeRates)),
        updatedAt: exchangeRates.lastUpdated,
        source: settingsRest.priceSource === 'auto' && settingsRest.fxSource ? settingsRest.fxSource : 'manual',
      },
    },
  };
}

// --- 3. the currencies the app offers ------------------------------------------------------------------

function stepCurrencies(s: Draft): Draft {
  if (Array.isArray(s.settings.enabledCurrencies)) return s;
  // v7 offered exactly these three; the user changes the list in Settings (later).
  return { ...s, settings: { ...s.settings, enabledCurrencies: ['EGP', 'SAR', 'USD'] } };
}

// --- 4. stored amounts rounded to their currency's decimals (INV-7) ------------------------------------

// A currency the registry doesn't know is left alone.
const money = (amount: number, currency: string): number =>
  typeof amount === 'number' && isKnownCurrency(currency) ? roundMoney(amount, currency) : amount;

function stepRounding(s: Draft): Draft {
  const currencyOf = new Map<string, string>(s.accounts.map((a: Draft) => [a.id, a.currency]));
  const fundCurrency = new Map<string, string>(s.funds.map((f: Draft) => [f.id, f.currency]));
  const egp = (x: number) => money(x, 'EGP');
  return {
    ...s,
    accounts: s.accounts.map((a: Draft) => ({ ...a, openingBalance: money(a.openingBalance, a.currency) })),
    transactions: s.transactions.map((tx: Draft) =>
      tx.type === 'transfer'
        ? {
            ...tx,
            amount: money(tx.amount, currencyOf.get(tx.fromAccountId) ?? ''),
            toAmount: money(tx.toAmount, currencyOf.get(tx.toAccountId) ?? ''),
          }
        : { ...tx, amount: money(tx.amount, tx.currency) }
    ),
    fundMovements: s.fundMovements.map((m: Draft) => ({ ...m, amount: money(m.amount, m.currency ?? fundCurrency.get(m.fundId) ?? '') })),
    funds: s.funds.map((f: Draft) => ({
      ...f,
      targetAmount: money(f.targetAmount, f.currency),
      ...(f.monthlyContribution !== undefined ? { monthlyContribution: money(f.monthlyContribution, f.currency) } : {}),
    })),
    holdings: s.holdings.map((h: Draft) => ({
      ...h,
      purchaseCostEGP: egp(h.purchaseCostEGP),
      ...(h.type === 'currency' ? { quantity: money(h.quantity, h.currency) } : {}),
    })),
    liabilities: s.liabilities.map((l: Draft) => ({
      ...l,
      principal: money(l.principal, l.currency),
      ...(l.monthlyPayment !== undefined ? { monthlyPayment: money(l.monthlyPayment, l.currency) } : {}),
    })),
    recurringRules: s.recurringRules.map((r: Draft) => ({
      ...r,
      amount: money(r.amount, r.currency),
      ...(r.toAmount !== undefined ? { toAmount: money(r.toAmount, currencyOf.get(r.toAccountId) ?? '') } : {}),
    })),
    monthlyPlans: s.monthlyPlans.map((p: Draft) => ({
      ...p,
      expectedIncome: money(p.expectedIncome, p.currency),
      lines: p.lines.map((l: Draft) => ({ ...l, limit: money(l.limit, p.currency) })),
      fundContributions: p.fundContributions.map((c: Draft) => ({ ...c, amount: money(c.amount, p.currency) })),
    })),
    netWorthSnapshots: s.netWorthSnapshots.map((n: Draft) => ({
      ...n,
      netWorthEGP: egp(n.netWorthEGP),
      liquidEGP: egp(n.liquidEGP),
      holdingsEGP: egp(n.holdingsEGP),
      ...(n.breakdown
        ? {
            breakdown: Object.fromEntries(
              Object.entries(n.breakdown as Record<string, Draft>).map(([country, part]) => [
                country,
                Object.fromEntries(Object.entries(part).map(([key, value]) => [key, egp(value as number)])),
              ])
            ),
          }
        : {}),
    })),
  };
}

// --- the runner -----------------------------------------------------------------------------------------

// In order; a step's position + 1 is its number in `settings.v8Step`. Only ever append.
export const V8_STEPS: { name: string; run: (state: Draft) => Draft }[] = [
  { name: 'countries', run: stepCountries },
  { name: 'rates', run: stepRates },
  { name: 'currencies', run: stepCurrencies },
  { name: 'rounding', run: stepRounding },
];

export const LATEST_V8_STEP = V8_STEPS.length;

// Runs the steps a state hasn't had yet (the first `upTo` of them at most; tests use that to build the
// intermediate shapes older builds stored). Accepts a v7 state or a v8 state from any earlier step; a
// state already at `upTo` comes back unchanged. Throws if a step cannot run (the store then refuses the
// data and leaves it untouched: store/hydration.ts).
export function applyV8Steps(input: unknown, _ctx: MigrationContext, upTo: number = LATEST_V8_STEP): FinanceState {
  const start: Draft = input as Draft;
  const done = typeof start.settings?.v8Step === 'number' ? start.settings.v8Step : 0;
  if (done >= upTo) return start as FinanceState;
  let state = start;
  for (let i = done; i < upTo; i++) state = V8_STEPS[i].run(state);
  return { ...state, settings: { ...state.settings, v8Step: upTo } } as FinanceState;
}

// v7 → v8 in one go.
export function migrateV7toV8(v7: unknown, ctx: MigrationContext): FinanceState {
  return applyV8Steps(v7, ctx);
}
