import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';

import {
  emptyDailyStore,
  parseDailyStore,
  planDailyWrite,
  serializeDailyStore,
  type DailySnapshotStore,
  type DailyStoreProblem,
} from './dailySnapshots';
import { useFinanceStore } from './useFinanceStore';

// The daily snapshot history on the device (data v10; pure logic in store/dailySnapshots.ts). It has its OWN storage
// key and its own in-memory store, deliberately apart from the ledger:
// - the ledger (useFinanceStore) never reads this key, so a damaged, unreadable or oversized history can never stop
//   the ledger from loading;
// - when the stored history can't be used, recording PAUSES and the stored value is left exactly as it is (it may be
//   recoverable); only «ابدأ سجل جديد» moves it aside (to a quarantine key) and starts an empty one;
// - nothing is recorded unless the ledger itself hydrated successfully (the finance store's fail-closed rule).

export const DAILY_STORAGE_KEY = '@wealth_daily_snapshots';
const DAILY_BEFORE_RESTORE_KEY = '@wealth_daily_snapshots_backup_before_restore';
const DAILY_QUARANTINE_PREFIX = '@wealth_daily_snapshots_quarantine_';

// 'loading': not read yet · 'ready': recording · a DailyStoreProblem: the stored history can't be used (paused) ·
// 'full': the next write would pass the size limit (paused, nothing lost) · 'write_failed': the last write failed (the
// next change retries).
export type DailyStatus = 'loading' | 'ready' | DailyStoreProblem | 'full' | 'write_failed';

interface DailyState {
  status: DailyStatus;
  store: DailySnapshotStore | null;
  // Technical detail of the last problem (log and diagnostics; not user-facing prose).
  detail?: string;
}

export const useDailySnapshots = create<DailyState>(() => ({ status: 'loading', store: null }));

// expo-router renders web pages in Node (no `window`): never touch storage there.
const isServer = Platform.OS === 'web' && typeof window === 'undefined';

let loading: Promise<void> | undefined;
let writing: Promise<void> = Promise.resolve();

// Reads the stored history once. Never throws: a read error or a bad value becomes a paused status.
export function loadDailySnapshots(): Promise<void> {
  if (isServer) return Promise.resolve();
  loading ??= (async () => {
    let raw: string | null;
    try {
      raw = await AsyncStorage.getItem(DAILY_STORAGE_KEY);
    } catch (error) {
      // e.g. a value too large for Android's CursorWindow.
      useDailySnapshots.setState({ status: 'unreadable', store: null, detail: String(error) });
      return;
    }
    const loaded = parseDailyStore(raw);
    if (loaded.ok) useDailySnapshots.setState({ status: 'ready', store: loaded.store, detail: undefined });
    else {
      useDailySnapshots.setState({ status: loaded.problem, store: null, detail: loaded.detail });
      console.warn('[wealth] daily history not usable — left untouched, recording paused', loaded.problem, loaded.detail);
    }
  })();
  return loading;
}

// Upserts today's record when something changed. Writes are serialized; a no-op when the history isn't ready, the
// ledger isn't hydrated, or nothing changed. Never throws.
export function recordDailySnapshot(now: Date = new Date()): Promise<void> {
  writing = writing.then(async () => {
    const { status, store } = useDailySnapshots.getState();
    if (isServer || !store || (status !== 'ready' && status !== 'write_failed' && status !== 'full')) return;
    const finance = useFinanceStore.getState();
    if (!finance.hasHydrated) return;
    try {
      // The record points at the rate snapshot of the CURRENT rates; it is added to the ledger first if new.
      const rateSnapshotId = finance.ensureCurrentRateSnapshot();
      const plan = planDailyWrite(store, useFinanceStore.getState(), now, rateSnapshotId);
      if (plan.kind === 'none') {
        if (status !== 'ready') useDailySnapshots.setState({ status: 'ready', detail: undefined });
        return;
      }
      if (plan.kind === 'full') {
        useDailySnapshots.setState({ status: 'full', detail: `${plan.bytes} bytes` });
        return;
      }
      await AsyncStorage.setItem(DAILY_STORAGE_KEY, plan.text);
      useDailySnapshots.setState({ status: 'ready', store: plan.store, detail: undefined });
    } catch (error) {
      useDailySnapshots.setState({ status: 'write_failed', detail: String(error) });
    }
  });
  return writing;
}

// The history to put in a backup; undefined when it isn't loaded or usable (the backup then has none, and says so).
export function dailySnapshotsForBackup(): DailySnapshotStore | undefined {
  const { status, store } = useDailySnapshots.getState();
  return store && status !== 'loading' ? store : undefined;
}

// Restoring a backup replaces the history with the file's (empty for a file without one). The current stored value is
// copied first, byte for byte, so it can be recovered by hand.
export async function replaceDailySnapshots(next: DailySnapshotStore): Promise<void> {
  await writing;
  const current = await AsyncStorage.getItem(DAILY_STORAGE_KEY).catch(() => null);
  if (current) await AsyncStorage.setItem(DAILY_BEFORE_RESTORE_KEY, current);
  await AsyncStorage.setItem(DAILY_STORAGE_KEY, serializeDailyStore(next));
  useDailySnapshots.setState({ status: 'ready', store: next, detail: undefined });
}

// «ابدأ سجل جديد» (only offered, after a confirmation, while the history can't be used): moves the stored value aside,
// untouched, and starts an empty history. A value this device can't even read back can't be copied: it is removed
// (the confirmation says so), since it can never be used here anyway.
export async function startFreshDailySnapshots(now: Date = new Date()): Promise<void> {
  await writing;
  try {
    let current: string | null = null;
    try {
      current = await AsyncStorage.getItem(DAILY_STORAGE_KEY);
    } catch {
      await AsyncStorage.removeItem(DAILY_STORAGE_KEY);
    }
    if (current) await AsyncStorage.setItem(`${DAILY_QUARANTINE_PREFIX}${now.toISOString()}`, current);
    await AsyncStorage.setItem(DAILY_STORAGE_KEY, serializeDailyStore(emptyDailyStore()));
  } catch (error) {
    useDailySnapshots.setState({ detail: String(error) });
    return;
  }
  useDailySnapshots.setState({ status: 'ready', store: emptyDailyStore(), detail: undefined });
  await recordDailySnapshot(now);
}
