// Phase 1a of docs/architecture/PROFESSIONAL_ANALYTICS_AND_COMPARISON_DESIGN.md: the daily snapshot history (data
// v10). Synthetic data only. Run with: npm run test:logic
/// <reference types="node" />
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import { create } from 'zustand';
import { persist, type StateStorage } from 'zustand/middleware';

import * as settingsUi from '@/components/settings/settingsUi';
import { createBackup, openBackup, parseBackup, serializeBackup, BackupError, backupPreview, type BackupFile } from '@/store/backup';
import {
  buildDailyRecord,
  dailySnapshotOn,
  dailyStoreBytes,
  emptyDailyStore,
  MAX_DAILY_STORE_BYTES,
  parseDailyStore,
  planDailyWrite,
  serializeDailyStore,
  summarizeDailyStore,
  resolveDailyRecord,
  SAME,
  syncDailyStore,
  validateDailyStore,
  type DailySnapshotStore,
} from '@/store/dailySnapshots';
import { DEFAULT_CATEGORIES } from '@/store/defaultCategories';
import { createPersistOptions, createWriteGuard, type HydrationFailure } from '@/store/hydration';
import { applyV8Steps, LATEST_V8_STEP } from '@/store/migrateV8';
import { applyV9Steps, LATEST_V9_STEP } from '@/store/migrateV9';
import { applyV10Steps, LATEST_V10_STEP, V10_STEPS } from '@/store/migrateV10';
import { CURRENT_VERSION, migratePersistedState } from '@/store/migrations';
import * as ops from '@/store/operations';
import { completeStoredPayload, migrateStoredPayload, type PersistMigrationSetup } from '@/store/persistMigration';
import { snapshotForNow } from '@/store/rateSnapshots';
import * as sel from '@/store/selectors';
import type { Account, FinanceState, Fund, GoldHolding, IncomeExpenseTransaction, Liability, ReservationMovement, Transaction } from '@/store/types';
import { shiftDate, toDateKey } from '@/utils/dates';
import { makeSnapshot } from '@/utils/rates';
import { exampleSeedV7, ORACLE_NOW, richV7 } from './legacy/fixtures.v7';
import { diffReports, reportV8 } from './legacy/report.v8';

const MIGRATION_CTX = { now: '2026-10-15T09:00:00.000Z', newId: () => 'migrated-device' };
const T0 = '2026-08-01T08:00:00.000Z';
// 26 Nov 2026, 21:00 local time.
const NOW = new Date(2026, 10, 26, 21, 0);
const nodeCrypto = { randomBytes: (n: number) => new Uint8Array(randomBytes(n)) };

// --- Synthetic fixtures -----------------------------------------------------------------------------------------

const PER_USD = { USD: 1, EGP: 50, SAR: 3.75 };
const RATE_SNAPSHOT = makeSnapshot({ base: 'USD', perUsd: PER_USD }, { takenAt: T0, source: 'manual' });

function baseState(): FinanceState {
  return {
    rateSnapshots: [RATE_SNAPSHOT],
    accounts: [],
    categories: DEFAULT_CATEGORIES,
    transactions: [],
    funds: [],
    reservationMovements: [],
    unresolvedMovements: [],
    holdings: [],
    liabilities: [],
    recurringRules: [],
    monthlyPlans: [],
    netWorthSnapshots: [],
    actionDismissals: [],
    monthlyReviews: [],
    receivables: [],
    settings: {
      rates: { base: 'USD', perUsd: PER_USD, updatedAt: T0, source: 'manual' },
      enabledCurrencies: ['EGP', 'SAR', 'USD'],
      v8Step: LATEST_V8_STEP,
      v9Step: LATEST_V9_STEP,
      v10Step: LATEST_V10_STEP,
      reportingCurrency: 'EGP',
      planCurrency: 'EGP',
      goldPrice24kEGP: 6000,
      goldPrice21kEGP: 5250,
      goldPriceUpdatedAt: T0,
      trackingStartDate: '2026-08-01',
      deviceId: 'test-device',
    },
    tombstones: [],
  };
}

const account = (id: string, currency: string, openingBalance: number, extra: Partial<Account> = {}): Account => ({
  id,
  name: id,
  type: 'bank',
  currency,
  openingBalance,
  country: currency === 'SAR' ? 'SA' : 'EG',
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});

const fund = (id: string, currency = 'EGP', extra: Partial<Fund> = {}): Fund => ({
  id,
  name: id,
  type: 'goal',
  targetAmount: 100_000,
  currency,
  priority: 1,
  linkedHoldingIds: [],
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});

let seq = 0;
const movement = (fundId: string, accountId: string, amount: number, kind: ReservationMovement['kind'] = 'reserve', date = '2026-09-01'): ReservationMovement => ({
  id: `m${++seq}`,
  fundId,
  accountId,
  amount,
  kind,
  date,
  rateSnapshotId: RATE_SNAPSHOT.id,
  updatedAt: T0,
});

const expense = (id: string, accountId: string, currency: string, amount: number, date: string, updatedAt = T0): Transaction => ({
  id,
  type: 'expense',
  amount,
  currency,
  accountId,
  categoryId: 'cat-essentials-groceries',
  date,
  rateSnapshotId: RATE_SNAPSHOT.id,
  createdAt: updatedAt,
  updatedAt,
});

const gold = (id: string, karat: GoldHolding['karat'], weightGrams: number): GoldHolding => ({
  id,
  type: 'gold',
  name: id,
  weightGrams,
  karat,
  purchaseCost: { amount: weightGrams * 5000, currency: 'EGP' },
  purchaseRateSnapshotId: RATE_SNAPSHOT.id,
  country: 'EG',
  updatedAt: T0,
});

const liability = (id: string, principal: number): Liability => ({ id, name: id, principal, currency: 'EGP', startDate: '2026-08-01', country: 'EG', updatedAt: T0 });

// A small but complete world: two currencies, reservations (one released back to 0), a legacy unresolved one, gold, a
// currency holding, a liability with a payment, an achieved goal.
function world(): FinanceState {
  const s = baseState();
  return {
    ...s,
    accounts: [account('a-egp', 'EGP', 20_000), account('a-sar', 'SAR', 3_000), account('a-old', 'EGP', 0, { archived: true })],
    funds: [fund('f-car'), fund('f-trip', 'SAR'), fund('f-done', 'EGP', { achievedAt: '2026-11-01T10:00:00.000Z' })],
    reservationMovements: [
      movement('f-car', 'a-egp', 5_000),
      movement('f-car', 'a-egp', 1_250.5),
      movement('f-trip', 'a-sar', 800),
      movement('f-done', 'a-egp', 300),
      movement('f-done', 'a-egp', -300, 'release'),
    ],
    unresolvedMovements: [{ id: 'u1', fundId: 'f-car', amount: 450, currency: 'USD', date: '2026-08-01', rateSnapshotId: RATE_SNAPSHOT.id, reason: 'ambiguous', updatedAt: T0 }],
    holdings: [
      gold('h-ring', 21, 12.5),
      { id: 'h-usd', type: 'currency', name: 'cash USD', currency: 'USD', quantity: 200, purchaseCost: { amount: 10_000, currency: 'EGP' }, purchaseRateSnapshotId: RATE_SNAPSHOT.id, country: 'EG', updatedAt: T0 },
    ],
    liabilities: [liability('l-loan', 9_000)],
    transactions: [
      expense('t1', 'a-egp', 'EGP', 1_234.56, '2026-11-20'),
      expense('t2', 'a-sar', 'SAR', 99.5, '2026-11-25', '2026-11-25T10:00:00.000Z'),
      { ...(expense('t3', 'a-egp', 'EGP', 1_000, '2026-11-02') as IncomeExpenseTransaction), liabilityId: 'l-loan' },
    ],
  };
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const rateIdFor = (state: FinanceState, now: Date) => snapshotForNow(state, now).id;
// The state with the snapshot of its current rates present (what ensureCurrentRateSnapshot does first).
function withCurrentRates(state: FinanceState, now: Date): FinanceState {
  const { patch } = ops.currentRateSnapshot(state, { now: () => now, newId: () => 'x' });
  return { ...state, ...patch };
}
const sync = (store: DailySnapshotStore, state: FinanceState, now: Date) => syncDailyStore(store, state, now, rateIdFor(state, now));

// --- v9 → v10 migration -------------------------------------------------------------------------------------------

describe('data v10: the v9 → v10 migration', () => {
  const ctx = MIGRATION_CTX;
  const sources: [string, () => ReturnType<typeof richV7>][] = [['rich', richV7], ['example seed', exampleSeedV7]];
  const asV9 = (s: FinanceState) => {
    const { v10Step: _s, ...settings } = s.settings;
    return { ...s, settings };
  };

  it('has one step, and the ledger value only gains the marker', () => {
    assert.deepEqual(V10_STEPS.map((s) => s.name), ['separateDailyHistory']);
    assert.equal(LATEST_V10_STEP, 1);
    assert.equal(CURRENT_VERSION, 10);
  });

  for (const [name, make] of sources) {
    it(`${name}: v9 → v10 adds the marker and changes nothing else; every v9 number is unchanged (oracle diff 0)`, () => {
      const v9 = applyV9Steps(applyV8Steps(make(), ctx), ctx);
      const v10 = migratePersistedState(v9, 9, ctx).state;
      assert.equal(v10.settings.v10Step, LATEST_V10_STEP);
      assert.deepEqual(asV9(v10), v9);
      assert.deepEqual(diffReports(reportV8(v9, ORACLE_NOW), reportV8(v10, ORACLE_NOW), 0), []);
    });

    it(`${name}: migrating twice is migrating once; a current state is the same object`, () => {
      const v10 = migratePersistedState(make(), 7, ctx).state;
      assert.equal(applyV10Steps(v10, ctx), v10);
      assert.equal(migratePersistedState(v10, 10, ctx).state, v10);
      assert.deepEqual(migratePersistedState(asV9(v10), 10, ctx).state, v10);
    });
  }

  it('older chains end at v10 (v1, v7, v8)', () => {
    for (const [p, v] of [[{ transactions: [], assets: [], goals: [] }, 1], [richV7(), 7], [applyV8Steps(richV7(), ctx), 8]] as const) {
      const s = migratePersistedState(p, v, ctx).state;
      assert.equal(s.settings.v10Step, LATEST_V10_STEP);
      assert.equal(s.settings.v9Step, LATEST_V9_STEP);
    }
  });

  it('fails closed on a ledger value that carries the daily history inline', () => {
    const v9 = asV9(world());
    assert.throws(() => migratePersistedState({ ...v9, dailySnapshots: [] }, 9, ctx));
    assert.throws(() => migratePersistedState({ ...v9, dailySnapshots: emptyDailyStore() }, 10, ctx));
  });

  describe('hydration (real zustand persist, fake storage)', () => {
    const KEY = '@test_v10';
    const PREFIX = '@test_v10_backup_v';
    const DAILY_KEY = '@test_daily';
    function hydrate(storedState: unknown, version: number, extra: [string, string][] = []) {
      const data = new Map<string, string>([[KEY, JSON.stringify({ state: storedState, version })], ...extra]);
      const writes: string[] = [];
      const guard = createWriteGuard();
      const failures: HydrationFailure[] = [];
      const base: StateStorage = {
        getItem: async (n) => data.get(n) ?? null,
        setItem: async (n, v) => {
          writes.push(n);
          data.set(n, v);
        },
        removeItem: async (n) => {
          data.delete(n);
        },
      };
      const setup: PersistMigrationSetup = { backupKeyPrefix: PREFIX, setItem: async (k, v) => {
          await base.setItem(k, v);
        }, now: () => ctx.now, newId: ctx.newId };
      const options = createPersistOptions<FinanceState, FinanceState>({
        name: KEY,
        version: CURRENT_VERSION,
        baseStorage: base,
        guard,
        skipHydration: true,
        log: () => {},
        migrate: async (p, v) => (await migrateStoredPayload(p, v, setup)).state,
        normalize: (p) => completeStoredPayload(p, setup) as FinanceState,
        partialize: (s) => s,
        onSuccess: () => {},
        onFailure: (f) => failures.push(f),
      });
      const store = create<FinanceState>()(persist(() => ({}) as FinanceState, options));
      return { store, data, writes, failures, raw: data.get(KEY)! };
    }

    it('a v9 payload: the untouched copy is written first, then the state is v10', async () => {
      const v9 = asV9(world());
      const h = hydrate(v9, 9);
      await h.store.persist.rehydrate();
      assert.equal(h.failures.length, 0);
      assert.equal(h.writes[0], `${PREFIX}9`);
      assert.deepEqual(JSON.parse(h.data.get(`${PREFIX}9`)!).state, JSON.parse(JSON.stringify(v9)));
      assert.equal(h.store.getState().settings.v10Step, LATEST_V10_STEP);
    });

    it('a v10 payload from an earlier v10 build (no marker) is completed after its untouched copy is kept', async () => {
      const stale = asV9(world());
      const h = hydrate(stale, 10);
      await h.store.persist.rehydrate();
      assert.equal(h.failures.length, 0);
      assert.deepEqual(JSON.parse(h.data.get(`${PREFIX}10_before_step_0`)!).state, JSON.parse(JSON.stringify(stale)));
      assert.equal(h.store.getState().settings.v10Step, LATEST_V10_STEP);
    });

    it('a corrupted or oversized daily history in storage never affects loading the ledger, and is never written', async () => {
      for (const bad of ['{not json', 'x'.repeat(4_000_000), JSON.stringify({ format: 99 })]) {
        const h = hydrate(world(), CURRENT_VERSION, [[DAILY_KEY, bad]]);
        await h.store.persist.rehydrate();
        assert.equal(h.failures.length, 0);
        assert.deepEqual(h.store.getState().accounts, world().accounts);
        assert.equal(h.data.get(DAILY_KEY), bad, 'the history key is untouched');
        assert.equal(h.writes.includes(DAILY_KEY), false);
        assert.equal(parseDailyStore(bad).ok, false);
      }
    });

    it('a payload newer than v10 is refused before anything runs', async () => {
      const h = hydrate(world(), CURRENT_VERSION + 1);
      await h.store.persist.rehydrate();
      assert.equal(h.failures[0]?.kind, 'unsupported_version');
      assert.deepEqual(h.writes, []);
    });
  });
});

// --- Recording ------------------------------------------------------------------------------------------------

describe('daily snapshots: what a record holds', () => {
  it('native balances, non-zero reservations, legacy unresolved, holdings, liabilities, achieved funds — equal to the selectors', () => {
    const state = withCurrentRates(world(), NOW);
    const snap = dailySnapshotOn(sync(emptyDailyStore(), state, NOW)!, '2026-11-26')!;
    assert.equal(snap.schemaVersion, 1);
    assert.equal(snap.date, '2026-11-26');
    assert.equal(snap.takenAt, NOW.toISOString());
    assert.deepEqual(
      snap.accounts,
      state.accounts
        .map((a) => ({ id: a.id, currency: a.currency, balance: sel.accountBalance(state, a.id) }))
        .sort((x, y) => (x.id < y.id ? -1 : 1))
    );
    assert.equal(snap.accounts.find((a) => a.id === 'a-egp')!.balance, 20_000 - 1_234.56 - 1_000);
    // f-done was released back to 0: not listed. Amounts in the ACCOUNT's currency, exactly reservation().
    assert.deepEqual(snap.reservations, [
      { fundId: 'f-car', accountId: 'a-egp', amount: sel.reservation(state, 'f-car', 'a-egp') },
      { fundId: 'f-trip', accountId: 'a-sar', amount: 800 },
    ]);
    assert.equal(snap.reservations[0].amount, 6_250.5);
    // Unresolved stays unresolved: never assigned to an account.
    assert.deepEqual(snap.unresolved, [{ fundId: 'f-car', currency: 'USD', amount: 450 }]);
    assert.deepEqual(snap.holdings, [
      { id: 'h-ring', type: 'gold', karat: 21, grams: 12.5 },
      { id: 'h-usd', type: 'currency', currency: 'USD', quantity: 200 },
    ]);
    assert.deepEqual(snap.liabilities, [{ id: 'l-loan', currency: 'EGP', remaining: 8_000 }]);
    assert.deepEqual(snap.achievedFundIds, ['f-done']);
    assert.deepEqual(snap.ledger, { transactions: 3, lastUpdatedAt: '2026-11-25T10:00:00.000Z' });
  });

  it('prices: a reference to the rate snapshot of the current rates (never a copy), gold prices with source and time', () => {
    const state = withCurrentRates({ ...world(), settings: { ...world().settings, priceSource: 'auto', localPremiumPct: 2.5, lastGoldUsdPerOunce: 2650.4 } }, NOW);
    const snap = dailySnapshotOn(sync(emptyDailyStore(), state, NOW)!, '2026-11-26')!;
    assert.equal(snap.rateSnapshotId, snapshotForNow(state, NOW).id);
    assert.ok(state.rateSnapshots.some((r) => r.id === snap.rateSnapshotId), 'the referenced snapshot is in the ledger');
    assert.equal(snap.fxUpdatedAt, T0);
    assert.deepEqual(snap.gold, { price24kEGP: 6000, price21kEGP: 5250, localPremiumPct: 2.5, source: 'auto', updatedAt: T0, usdPerOunce: 2650.4 });
    // Manual / missing price source is manual; missing world price is null.
    const manual = dailySnapshotOn(sync(emptyDailyStore(), withCurrentRates(world(), NOW), NOW)!, '2026-11-26')!;
    assert.equal(manual.gold.source, 'manual');
    assert.equal(manual.gold.usdPerOunce, null);
  });

  it('INV-A7: building and syncing never change the ledger (deep-frozen state)', () => {
    const state = deepFreeze(withCurrentRates(world(), NOW));
    const before = JSON.stringify(state);
    const store = deepFreeze(emptyDailyStore());
    sync(store, state, NOW);
    buildDailyRecord(state, NOW, rateIdFor(state, NOW));
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual(store, emptyDailyStore());
  });

  it('currentRateSnapshot only ever appends the current table (and nothing when it exists)', () => {
    const ctx = { now: () => NOW, newId: () => 'x' };
    const state = world();
    assert.deepEqual(ops.currentRateSnapshot(state, ctx).patch, {});
    const moved = { ...state, settings: { ...state.settings, rates: { ...state.settings.rates, perUsd: { ...PER_USD, EGP: 51 } } } };
    const { id, patch } = ops.currentRateSnapshot(moved, ctx);
    assert.deepEqual(Object.keys(patch), ['rateSnapshots']);
    assert.deepEqual(patch.rateSnapshots!.slice(0, -1), state.rateSnapshots);
    assert.equal(patch.rateSnapshots!.at(-1)!.id, id);
  });

  it('INV-A2: the reporting and plan currency change nothing in a record (native amounts only)', () => {
    const state = withCurrentRates(world(), NOW);
    const other = { ...state, settings: { ...state.settings, reportingCurrency: 'SAR', planCurrency: 'USD' } };
    assert.deepEqual(buildDailyRecord(other, NOW, rateIdFor(other, NOW)).record, buildDailyRecord(state, NOW, rateIdFor(state, NOW)).record);
  });

  it('is deterministic whatever the order of the collections', () => {
    const state = withCurrentRates(world(), NOW);
    const shuffled = { ...state, accounts: [...state.accounts].reverse(), holdings: [...state.holdings].reverse(), reservationMovements: [...state.reservationMovements].reverse() };
    const a = sync(emptyDailyStore(), state, NOW)!;
    const b = sync(emptyDailyStore(), shuffled, NOW)!;
    assert.deepEqual(dailySnapshotOn(a, '2026-11-26'), dailySnapshotOn(b, '2026-11-26'));
  });
});

describe('daily snapshots: one record per date (D2 a), never backfilled', () => {
  const state = withCurrentRates(world(), NOW);
  const later = new Date(2026, 10, 26, 23, 30);
  const tomorrow = new Date(2026, 10, 27, 8, 0);

  it('nothing changed → null (no write), even later the same day', () => {
    const store = sync(emptyDailyStore(), state, NOW)!;
    assert.equal(sync(store, state, later), null);
  });

  it('a change the same day replaces today\'s record in place (still one record); the last observation is kept', () => {
    const store = sync(emptyDailyStore(), state, NOW)!;
    const changed = { ...state, transactions: [...state.transactions, expense('t9', 'a-egp', 'EGP', 50, '2026-11-26', later.toISOString())] };
    const next = sync(store, changed, later)!;
    assert.equal(next.days.length, 1);
    assert.equal(next.days[0].t, later.toISOString());
    assert.equal(dailySnapshotOn(next, '2026-11-26')!.accounts.find((a) => a.id === 'a-egp')!.balance, 20_000 - 1_234.56 - 1_000 - 50);
  });

  it('the next day appends; a past record is never touched again', () => {
    const today = sync(emptyDailyStore(), state, NOW)!;
    const changed = { ...state, accounts: state.accounts.map((a) => (a.id === 'a-sar' ? { ...a, openingBalance: 9_999 } : a)) };
    const next = sync(today, changed, tomorrow)!;
    assert.deepEqual(next.days.map((d) => d.d), ['2026-11-26', '2026-11-27']);
    assert.deepEqual(next.days[0], today.days[0]);
    // Ids are interned once and only appended.
    assert.deepEqual(next.ids.slice(0, today.ids.length), today.ids);
  });

  it('days the app was not opened have no record: nothing is interpolated or carried forward', () => {
    const first = sync(emptyDailyStore(), state, NOW)!;
    const fiveDaysLater = new Date(2026, 11, 1, 9, 0);
    const next = sync(first, state, fiveDaysLater)!;
    assert.deepEqual(next.days.map((d) => d.d), ['2026-11-26', '2026-12-01']);
    for (let d = '2026-11-27'; d < '2026-12-01'; d = shiftDate(d, 1)) assert.equal(dailySnapshotOn(next, d), undefined);
  });

  it('a clock that went back never rewrites a later date', () => {
    const store = sync(emptyDailyStore(), state, tomorrow)!;
    const changed = { ...state, transactions: [] };
    assert.equal(sync(store, changed, NOW), null);
  });

  it('D3: editing the past changes the ledger fingerprint of today\'s record (later dates can flag the divergence)', () => {
    const store = sync(emptyDailyStore(), state, NOW)!;
    const edited = { ...state, transactions: state.transactions.map((t) => (t.id === 't1' ? { ...t, amount: 1_000, updatedAt: '2026-11-26T20:59:00.000Z' } : t)) };
    const next = sync(store, edited, later)!;
    assert.deepEqual(dailySnapshotOn(next, '2026-11-26')!.ledger, { transactions: 3, lastUpdatedAt: '2026-11-26T20:59:00.000Z' });
  });

  it('local date keys: a record made just before midnight belongs to that local day', () => {
    const lateNight = new Date(2026, 1, 28, 23, 59, 30);
    assert.equal(sync(emptyDailyStore(), withCurrentRates(world(), lateNight), lateNight)!.days[0].d, toDateKey(lateNight));
  });
});

describe('daily snapshots: «same as the previous record» (compact on disk, exact when read)', () => {
  it('an unchanged section is stored as SAME and resolves to exactly what was observed', () => {
    let state = withCurrentRates(world(), NOW);
    let store = sync(emptyDailyStore(), state, NOW)!;
    const expected = [dailySnapshotOn(store, '2026-11-26')!];
    for (let d = 1; d <= 6; d++) {
      const now = new Date(2026, 10, 26 + d, 9, 0);
      // Only one balance changes on odd days; reservations change on day 4.
      if (d % 2 === 1) state = { ...state, accounts: state.accounts.map((a) => (a.id === 'a-egp' ? { ...a, openingBalance: a.openingBalance + d } : a)) };
      if (d === 4) state = { ...state, reservationMovements: [...state.reservationMovements, movement('f-trip', 'a-sar', 10)] };
      store = sync(store, state, now)!;
      // Direct build of the same day (no compaction) = what reading the compact store gives.
      const direct = emptyDailyStore();
      expected.push(dailySnapshotOn(sync(direct, state, now)!, toDateKey(now))!);
    }
    assert.equal(store.days.length, 7);
    assert.equal(store.days[0].rv === SAME, false, 'the first record is always complete');
    assert.equal(store.days[1].rv, SAME);
    assert.equal(store.days[2].a, SAME);
    assert.notEqual(store.days[4].rv, SAME);
    store.days.forEach((r, i) => {
      const got = dailySnapshotOn(store, r.d)!;
      const want = expected[i];
      assert.deepEqual({ ...got, takenAt: '' }, { ...want, takenAt: '' }, r.d);
    });
    // And it survives a save/load.
    const back = parseDailyStore(serializeDailyStore(store));
    assert.ok(back.ok);
    assert.deepEqual(dailySnapshotOn(back.store, '2026-12-02'), dailySnapshotOn(store, '2026-12-02'));
  });

  it('replacing today\'s record re-compacts it against the day before', () => {
    const state = withCurrentRates(world(), NOW);
    const day1 = sync(emptyDailyStore(), state, NOW)!;
    const day2 = sync(day1, state, new Date(2026, 10, 27, 9))!;
    assert.equal(day2.days[1].a, SAME);
    const changed = { ...state, accounts: state.accounts.map((a) => (a.id === 'a-sar' ? { ...a, openingBalance: 1 } : a)) };
    const replaced = sync(day2, changed, new Date(2026, 10, 27, 22))!;
    assert.equal(replaced.days.length, 2);
    assert.notEqual(replaced.days[1].a, SAME);
    assert.equal(replaced.days[1].rv, SAME);
    assert.equal(dailySnapshotOn(replaced, '2026-11-27')!.accounts.find((a) => a.id === 'a-sar')!.balance, 1 - 99.5);
  });

  it('SAME in the first record is invalid (there is nothing before it)', () => {
    const good = sync(emptyDailyStore(), withCurrentRates(world(), NOW), NOW)!;
    assert.equal(validateDailyStore({ ...good, days: [{ ...good.days[0], rv: SAME }] }).ok, false);
    assert.equal(validateDailyStore({ ...good, days: [{ ...good.days[0], g: SAME }] }).ok, false);
  });
});

// --- Loading, validation, size ----------------------------------------------------------------------------------

describe('daily snapshots: loading never throws and never blocks anything', () => {
  const good = sync(emptyDailyStore(), withCurrentRates(world(), NOW), NOW)!;

  it('nothing stored → an empty history; a stored one round-trips', () => {
    assert.deepEqual(parseDailyStore(null), { ok: true, store: emptyDailyStore() });
    assert.deepEqual(parseDailyStore(''), { ok: true, store: emptyDailyStore() });
    const back = parseDailyStore(serializeDailyStore(good));
    assert.ok(back.ok);
    assert.deepEqual(back.store, good);
  });

  it('anything that is not a valid history is refused with a reason', () => {
    const bad: [string, unknown][] = [
      ['array', []],
      ['format', { ...good, format: 2 }],
      ['ids not strings', { ...good, ids: [1] }],
      ['duplicate ids', { ...good, ids: [...good.ids, good.ids[0]] }],
      ['index out of range', { ...good, ids: good.ids.slice(0, 1) }],
      ['record version', { ...good, days: [{ ...good.days[0], v: 2 }] }],
      ['bad date', { ...good, days: [{ ...good.days[0], d: '26/11/2026' }] }],
      ['amount as text', { ...good, days: [{ ...good.days[0], a: [[0, 'EGP', '100']] }] }],
      ['karat', { ...good, days: [{ ...good.days[0], h: [[0, 'g', 22, 1]] }] }],
      ['dates not increasing', { ...good, days: [good.days[0], good.days[0]] }],
      ['missing gold', { ...good, days: [{ ...good.days[0], g: undefined }] }],
    ];
    for (const [name, value] of bad) {
      const result = validateDailyStore(value);
      assert.equal(result.ok, false, name);
      assert.equal(!result.ok && result.problem, 'invalid', name);
      assert.equal(parseDailyStore(JSON.stringify(value)).ok, false, name);
    }
    assert.deepEqual(parseDailyStore('{not json'), { ok: false, problem: 'invalid', detail: 'not JSON' });
  });

  it('a value too large is not even parsed (oversized)', () => {
    const text = serializeDailyStore(good);
    const result = parseDailyStore(text, text.length - 1);
    assert.equal(!result.ok && result.problem, 'oversized');
  });

  it('fuzz: random text never throws', () => {
    const alphabet = '{}[]",:0123456789abcdefv.-ntrue';
    for (let i = 0; i < 2_000; i++) {
      let text = '';
      const length = Math.floor(Math.random() * 60);
      for (let j = 0; j < length; j++) text += alphabet[Math.floor(Math.random() * alphabet.length)];
      assert.doesNotThrow(() => parseDailyStore(text));
    }
  });

  it('a write past the size limit is refused (the history stays as it was, nothing else is affected)', () => {
    const state = withCurrentRates(world(), NOW);
    const plan = planDailyWrite(emptyDailyStore(), state, NOW, rateIdFor(state, NOW), 100);
    assert.equal(plan.kind, 'full');
    const ok = planDailyWrite(emptyDailyStore(), state, NOW, rateIdFor(state, NOW));
    assert.equal(ok.kind, 'write');
    assert.equal(ok.kind === 'write' && ok.text, serializeDailyStore(ok.kind === 'write' ? ok.store : emptyDailyStore()));
    assert.equal(planDailyWrite(ok.kind === 'write' ? ok.store : emptyDailyStore(), state, NOW, rateIdFor(state, NOW)).kind, 'none');
  });
});

// --- Backup / restore (the compatibility gate, §16.3) ----------------------------------------------------------------

describe('daily snapshots: backups carry the history; a damaged history never blocks a restore', () => {
  const EXPORT = new Date('2026-11-26T19:00:00.000Z');
  const state = withCurrentRates(world(), NOW);
  const daily = sync(sync(emptyDailyStore(), state, NOW)!, { ...state, transactions: [] }, new Date(2026, 10, 27, 9))!;

  it('round-trips the ledger and the history, plain and encrypted, at schema v10', async () => {
    for (const password of [undefined, 'pw-123']) {
      const file = await createBackup(state, { password, dailySnapshots: daily, now: EXPORT, crypto: { ...nodeCrypto, iterations: 1000 } });
      assert.equal(file.schemaVersion, 10);
      const opened = await openBackup(parseBackup(serializeBackup(file)), { password, now: NOW, newId: () => 'unused' });
      assert.deepEqual(opened.state, state);
      assert.deepEqual(opened.daily, { status: 'included', store: daily });
      assert.equal(backupPreview(opened).dailyDays, 2);
    }
  });

  it('a backup made without a history (or an older file) opens with none', async () => {
    const file = await createBackup(state, { now: EXPORT, crypto: nodeCrypto });
    const opened = await openBackup(parseBackup(serializeBackup(file)), { now: NOW, newId: () => 'unused' });
    assert.deepEqual(opened.daily, { status: 'none' });
    assert.equal(backupPreview(opened).dailyDays, null);
    const { v10Step: _s, ...settings } = state.settings;
    const v9file: BackupFile = { app: 'wealth', schemaVersion: 9, exportedAt: EXPORT.toISOString(), deviceId: 'old', encrypted: false, payload: { ...state, settings } };
    const old = await openBackup(parseBackup(serializeBackup(v9file)), { now: NOW, newId: () => 'unused' });
    assert.deepEqual(old.daily, { status: 'none' });
    assert.deepEqual(old.state, state);
  });

  it('a v10 file whose history is damaged still restores the ledger; the history is reported invalid and left out', async () => {
    const file = await createBackup(state, { dailySnapshots: { ...daily, days: [daily.days[1], daily.days[0]] }, now: EXPORT, crypto: nodeCrypto });
    const opened = await openBackup(parseBackup(serializeBackup(file)), { now: NOW, newId: () => 'unused' });
    assert.deepEqual(opened.state, state);
    assert.equal(opened.daily.status, 'invalid');
    assert.equal(backupPreview(opened).dailyDays, 'invalid');
  });

  it('a pre-v10 file that carries a history inline is not Wealth data (refused)', async () => {
    const { v10Step: _s, ...settings } = state.settings;
    const file: BackupFile = { app: 'wealth', schemaVersion: 9, exportedAt: EXPORT.toISOString(), deviceId: 'x', encrypted: false, payload: { ...state, settings, dailySnapshots: daily } };
    await assert.rejects(openBackup(parseBackup(serializeBackup(file)), { now: NOW, newId: () => 'unused' }), (e) => e instanceof BackupError && e.code === 'INVALID_FILE');
  });

  it('a v10 file is newer than a v9 app: refused there (UNSUPPORTED_VERSION), so it can never be restored without its history', () => {
    // What a v9 build's parseBackup does: schemaVersion > its CURRENT_VERSION (9).
    const v9AppRefuses = (schemaVersion: number) => schemaVersion > 9;
    assert.equal(v9AppRefuses(CURRENT_VERSION), true);
    assert.throws(
      () => parseBackup(JSON.stringify({ app: 'wealth', schemaVersion: CURRENT_VERSION + 1, exportedAt: 'x', encrypted: false, payload: {} })),
      (e) => e instanceof BackupError && e.code === 'UNSUPPORTED_VERSION'
    );
  });

  it('INV-A8 / gate 6: no money figure reads the history (the selectors take only the ledger)', () => {
    // The history is not part of FinanceState at all; a backup with and without one restores an identical ledger.
    assert.equal('dailySnapshots' in state, false);
    assert.equal(sel.netWorth(state, 'EGP'), sel.netWorth(withCurrentRates(world(), NOW), 'EGP'));
  });
});

// --- Settings copy ----------------------------------------------------------------------------------------------

describe('daily snapshots: Settings copy', () => {
  it('counts days like the rest of the app', () => {
    assert.deepEqual([1, 2, 3, 10, 11, 120].map(settingsUi.dayCountPhrase), ['يوم واحد', 'يومين', '3 أيام', '10 أيام', '11 يوم', '120 يوم']);
  });

  it('says what the history is doing, and that the rest of the data is fine when it is paused', () => {
    assert.equal(settingsUi.dailyLogLine('ready', { days: 0, firstDate: null }), 'هيبدأ يسجّل وضعك من النهارده.');
    assert.match(settingsUi.dailyLogLine('ready', { days: 3, firstDate: '2026-11-26' }), /^بيسجّل وضعك كل يوم · من .+ · 3 أيام$/);
    for (const s of ['unreadable', 'oversized', 'invalid', 'full'] as const) assert.match(settingsUi.dailyLogLine(s, { days: 0, firstDate: null }), /باقي بياناتك سليمة/);
    assert.equal(settingsUi.dailyLogBroken('invalid'), true);
    assert.equal(settingsUi.dailyLogBroken('full'), false);
    assert.deepEqual([null, 0, 5, 'invalid' as const].map(settingsUi.dailyPreviewLabel), ['مفيش', 'مفيش', '5 أيام', 'مش سليم']);
  });

  it('summarizes a history', () => {
    assert.deepEqual(summarizeDailyStore(emptyDailyStore()), { days: 0, firstDate: null, lastDate: null });
  });
});

// --- Storage size: several years of daily history + a large ledger -----------------------------------------------------

describe('daily snapshots: storage size (projected per year)', () => {
  // A heavy synthetic user: 14 accounts in 3 currencies, 25 funds reserved on up to 2 accounts each (≈ 40 non-zero
  // reservations every day), 3 legacy unresolved, 10 gold holdings + 2 currency holdings, 3 liabilities, 6 achieved
  // goals, and a 5-year ledger of 20,000 transactions. Balances and prices move every day, with decimals.
  const ACCOUNTS = 14;
  const FUNDS = 25;
  const YEARS = 3;
  const LEDGER = 20_000;
  const currencies = ['EGP', 'SAR', 'USD'];

  function heavyState(): FinanceState {
    const s = baseState();
    const accounts = Array.from({ length: ACCOUNTS }, (_, i) => account(`acct-${String(i).padStart(2, '0')}-${'x'.repeat(28)}`, currencies[i % 3], 10_000 + i * 1_234.56));
    const funds = Array.from({ length: FUNDS }, (_, i) => fund(`fund-${String(i).padStart(2, '0')}-${'y'.repeat(28)}`, currencies[i % 3], i < 6 ? { achievedAt: T0 } : {}));
    const reservationMovements: ReservationMovement[] = [];
    funds.forEach((f, i) => {
      const onAccounts = accounts.filter((a) => a.currency === f.currency).slice(0, i % 2 === 0 ? 2 : 1);
      for (const a of onAccounts) for (let k = 0; k < 6; k++) reservationMovements.push(movement(f.id, a.id, 100 + k * 17.25 + i));
    });
    return {
      ...s,
      accounts,
      funds,
      reservationMovements,
      unresolvedMovements: [0, 1, 2].map((i) => ({ id: `u${i}`, fundId: funds[i].id, amount: 300 + i, currency: currencies[i], date: '2026-08-01', rateSnapshotId: RATE_SNAPSHOT.id, reason: 'ambiguous' as const, updatedAt: T0 })),
      holdings: [
        ...Array.from({ length: 10 }, (_, i) => gold(`gold-${i}-${'z'.repeat(30)}`, ([18, 21, 24] as const)[i % 3], 5 + i * 1.75)),
        { id: `cur-usd-${'w'.repeat(30)}`, type: 'currency', name: 'usd', currency: 'USD', quantity: 450, purchaseCost: { amount: 20_000, currency: 'EGP' }, purchaseRateSnapshotId: RATE_SNAPSHOT.id, country: 'EG', updatedAt: T0 },
        { id: `cur-sar-${'w'.repeat(30)}`, type: 'currency', name: 'sar', currency: 'SAR', quantity: 1_200, purchaseCost: { amount: 15_000, currency: 'EGP' }, purchaseRateSnapshotId: RATE_SNAPSHOT.id, country: 'SA', updatedAt: T0 },
      ],
      liabilities: [0, 1, 2].map((i) => liability(`liab-${i}-${'v'.repeat(30)}`, 50_000 + i * 10_000)),
    };
  }

  function largeLedger(base: FinanceState): Transaction[] {
    const out: Transaction[] = [];
    for (let i = 0; i < LEDGER; i++) {
      const a = base.accounts[i % ACCOUNTS];
      const date = shiftDate('2021-12-01', Math.floor(i / 11));
      out.push({ ...expense(`tx-${i}-${'q'.repeat(28)}`, a.id, a.currency, 10 + (i % 997) * 1.37, date, `${date}T12:00:00.000Z`), id: `tx-${String(i).padStart(5, '0')}-${'q'.repeat(28)}` });
    }
    return out;
  }

  it('reports bytes per year, and stays within budget (≤ 600 KB per year, years of headroom under the cap)', (t) => {
    const base = heavyState();
    let store = emptyDailyStore();
    let state = base;
    const start = new Date(2026, 10, 26, 21, 0);
    const days = YEARS * 365;
    const yearEnds: number[] = [];
    for (let d = 0; d < days; d++) {
      const now = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, 21, 0);
      // Every account balance and the gold price move a little every day.
      state = {
        ...state,
        accounts: state.accounts.map((a, i) => ({ ...a, openingBalance: Math.round((a.openingBalance + ((d * 37 + i * 11) % 200) - 99.37) * 100) / 100 })),
        settings: { ...state.settings, goldPrice24kEGP: 6000 + ((d * 13) % 400) + 0.37, goldPrice21kEGP: 5250 + ((d * 11) % 350) + 0.21, goldPriceUpdatedAt: now.toISOString() },
      };
      if (d % 9 === 0) state = { ...state, reservationMovements: [...state.reservationMovements, movement(base.funds[6 + (d % 19)].id, base.accounts[(6 + (d % 19)) % 3].id, 25.5)] };
      const next = syncDailyStore(store, state, now, RATE_SNAPSHOT.id);
      if (next) store = next;
      if ((d + 1) % 365 === 0) yearEnds.push(dailyStoreBytes(serializeDailyStore(store)));
    }
    assert.equal(store.days.length, days);
    const total = dailyStoreBytes(serializeDailyStore(store));
    const perRecord = total / days;
    const perYear = Math.round(perRecord * 365);
    const yearsUnderCap = MAX_DAILY_STORE_BYTES / perYear;

    // The large ledger: how big the ledger value is, and that one record of it is the same size class and quick.
    const ledgerState = { ...state, transactions: largeLedger(base) };
    const ledgerBytes = JSON.stringify(ledgerState).length;
    const t0 = performance.now();
    const { record } = buildDailyRecord(ledgerState, start, RATE_SNAPSHOT.id, store.ids);
    const buildMs = performance.now() - t0;
    const recordBytes = JSON.stringify(record).length;
    // The same record without the large ledger (full, uncompacted): its size does not depend on the ledger.
    const smallBytes = JSON.stringify(buildDailyRecord(state, start, RATE_SNAPSHOT.id, store.ids).record).length;
    const fullBytes = JSON.stringify(resolveDailyRecord(store, store.days.length - 1)).length;

    const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
    const lines = [
      `daily history, heavy user (${ACCOUNTS} accounts, ${FUNDS} funds, 12 holdings, ${record.rv.length} reservations/day):`,
      `  per record ≈ ${Math.round(perRecord)} bytes · per year ≈ ${kb(perYear)} · after ${YEARS} years = ${kb(total)} (year ends: ${yearEnds.map(kb).join(', ')})`,
      `  cap ${kb(MAX_DAILY_STORE_BYTES)} ⇒ ≈ ${yearsUnderCap.toFixed(1)} years of history before recording pauses`,
      `  ledger value with ${LEDGER.toLocaleString('en-US')} transactions = ${kb(ledgerBytes)} (separate key; unchanged by the history)`,
      `  a full (uncompacted) record ≈ ${fullBytes} bytes; one built from that ledger: ${recordBytes} bytes, in ${buildMs.toFixed(1)} ms`,
    ];
    for (const line of lines) t.diagnostic(line);
    console.log(lines.join('\n'));

    assert.ok(perYear <= 600 * 1024, `per year ${perYear}`);
    assert.ok(yearsUnderCap >= 3, `only ${yearsUnderCap} years under the cap`);
    assert.ok(Math.abs(recordBytes - smallBytes) < smallBytes * 0.05, 'record size does not depend on the ledger size');
    assert.ok(buildMs < 2_000);
  });
});
