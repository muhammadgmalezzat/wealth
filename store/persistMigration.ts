import { applyV8Steps, LATEST_V8_STEP } from './migrateV8';
import { applyV9Steps, LATEST_V9_STEP } from './migrateV9';
import { applyV10Steps, LATEST_V10_STEP } from './migrateV10';
import { CURRENT_VERSION, migratePersistedState, type MigrationResult } from './migrations';

// What the store's zustand `persist` does with stored data before it becomes the app's state. Pure apart from the
// injected storage write, so the tests run THIS code (no React Native imports).

export interface PersistMigrationSetup {
  // Where the untouched copies go: `<prefix><version>` before a migration, `<prefix>8_before_step_<n>` /
  // `<prefix>9_before_step_<n>` / `<prefix>10_before_step_<n>` before a completion.
  backupKeyPrefix: string;
  setItem: (key: string, value: string) => Promise<void> | void;
  now: () => string;
  newId: () => string;
}

// `persist.migrate`: stored data at an older version. The untouched payload is written FIRST (awaited), so a failed
// or wrong migration never loses data; only then does the chain run (it throws on data it cannot trust, and the
// store fails closed).
export async function migrateStoredPayload(persisted: unknown, version: number, setup: PersistMigrationSetup): Promise<MigrationResult> {
  await setup.setItem(`${setup.backupKeyPrefix}${version}`, JSON.stringify({ state: persisted, version }));
  return migratePersistedState(persisted, version, { now: setup.now(), newId: setup.newId });
}

// `persist`'s normalize hook (runs on EVERY hydration): stored data at the current version from an earlier build that
// had fewer v8 / v9 / v10 sub-steps is completed. A complete payload comes back as the same object. Before completing,
// the untouched payload is copied (fire and forget, as before).
export function completeStoredPayload(persisted: unknown, setup: PersistMigrationSetup): unknown {
  const settings = (persisted as { settings?: { v8Step?: number; v9Step?: number; v10Step?: number } }).settings;
  const v8Done = settings?.v8Step ?? 0;
  const v9Done = settings?.v9Step ?? 0;
  const v10Done = settings?.v10Step ?? 0;
  if (v8Done >= LATEST_V8_STEP && v9Done >= LATEST_V9_STEP && v10Done >= LATEST_V10_STEP) return persisted;
  const key =
    v8Done < LATEST_V8_STEP
      ? `${setup.backupKeyPrefix}8_before_step_${v8Done}`
      : v9Done < LATEST_V9_STEP
        ? `${setup.backupKeyPrefix}9_before_step_${v9Done}`
        : `${setup.backupKeyPrefix}10_before_step_${v10Done}`;
  void setup.setItem(key, JSON.stringify({ state: persisted, version: CURRENT_VERSION }));
  const migration = { now: setup.now(), newId: setup.newId };
  return applyV10Steps(applyV9Steps(applyV8Steps(persisted, migration), migration), migration);
}
