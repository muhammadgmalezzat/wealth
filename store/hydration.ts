import { createJSONStorage, type PersistOptions, type StateStorage } from 'zustand/middleware';

// Fail-closed hydration. Pure (no React Native imports) so it runs in Node tests against the real
// zustand `persist`.
//
// Rule: if the stored payload cannot be loaded — unreadable, newer than this build understands, or
// its migration throws — NOTHING is written to storage. The stored payload stays byte-for-byte what
// it was, the app shows an error screen instead of data, and the user can export the raw JSON or
// retry. Without this, zustand's `.catch` leaves the in-memory seed in place and the very next
// `setState` (the rehydrate callback itself calls one) persists the seed over the real data.

export type HydrationFailureKind = 'unsupported_version' | 'migration_failed' | 'unreadable';

export interface HydrationFailure {
  kind: HydrationFailureKind;
  // Technical detail for the log and the error screen (not user-facing prose).
  message: string;
  storedVersion?: number;
  supportedVersion?: number;
}

// The stored data was written by a newer build than this one.
export class UnsupportedVersionError extends Error {
  override name = 'UnsupportedVersionError';
  readonly storedVersion: number;
  readonly supportedVersion: number;

  constructor(storedVersion: number, supportedVersion: number) {
    super(`Stored data is version ${storedVersion}, newer than the supported version ${supportedVersion}`);
    this.storedVersion = storedVersion;
    this.supportedVersion = supportedVersion;
  }
}

// A migration step threw.
export class MigrationFailedError extends Error {
  override name = 'MigrationFailedError';
  readonly storedVersion: number;

  constructor(storedVersion: number, reason: unknown) {
    super(`Migration from version ${storedVersion} failed: ${describeError(reason)}`);
    this.storedVersion = storedVersion;
  }
}

// The stored text is not a payload this app can interpret at all.
export class StoredDataUnreadableError extends Error {
  override name = 'StoredDataUnreadableError';
}

export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function classifyHydrationError(error: unknown): HydrationFailure {
  if (error instanceof UnsupportedVersionError) {
    return {
      kind: 'unsupported_version',
      message: error.message,
      storedVersion: error.storedVersion,
      supportedVersion: error.supportedVersion,
    };
  }
  if (error instanceof MigrationFailedError) {
    return { kind: 'migration_failed', message: error.message, storedVersion: error.storedVersion };
  }
  return { kind: 'unreadable', message: describeError(error) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// What the stored text must look like before zustand sees it:
//  - null / '' → nothing stored (fresh install);
//  - the pre-Zustand bare state JSON → wrapped as version 0 so `migrate` upgrades it;
//  - `{ state: {...}, version: <integer ≥ 0> }` → as is.
// Anything else (not JSON, not an object, no state object, no integer version) throws, so it is
// refused instead of being treated as "current" data.
export function normalizeStoredPayload(raw: string | null): string | null {
  if (!raw) return raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StoredDataUnreadableError(`Stored data is not valid JSON (${describeError(error)})`);
  }
  if (!isRecord(parsed)) throw new StoredDataUnreadableError('Stored data is not a JSON object');
  if (!('state' in parsed)) return JSON.stringify({ state: parsed, version: 0 });
  if (!isRecord(parsed.state)) throw new StoredDataUnreadableError('Stored data has no state object');
  if (typeof parsed.version !== 'number' || !Number.isInteger(parsed.version) || parsed.version < 0) {
    throw new StoredDataUnreadableError('Stored data has no valid version');
  }
  return raw;
}

// Wraps a migration so that data newer than `supportedVersion` is refused (before anything else
// runs, so not even a pre-migration copy is written) and any thrown error becomes a typed one.
export function guardedMigrate<P>(
  supportedVersion: number,
  migrate: (persisted: unknown, version: number) => P | Promise<P>
): (persisted: unknown, version: number) => Promise<P> {
  return async (persisted, version) => {
    if (version > supportedVersion) throw new UnsupportedVersionError(version, supportedVersion);
    try {
      return await migrate(persisted, version);
    } catch (error) {
      throw new MigrationFailedError(version, error);
    }
  };
}

// Blocks every storage write once hydration has failed. Defense in depth: whatever else still calls
// `setState` (a runner, a stale callback) cannot reach the stored payload.
export interface WriteGuard {
  failure(): HydrationFailure | null;
  blockedWrites(): number;
  block(failure: HydrationFailure): void;
  // Allows writes again; used by "حاول تاني" right before re-reading the storage.
  reset(): void;
  wrap(base: StateStorage): StateStorage;
}

export function createWriteGuard(): WriteGuard {
  let failure: HydrationFailure | null = null;
  let blocked = 0;
  return {
    failure: () => failure,
    blockedWrites: () => blocked,
    block: (next) => {
      failure = next;
    },
    reset: () => {
      failure = null;
      blocked = 0;
    },
    wrap: (base) => ({
      getItem: (name) => base.getItem(name),
      setItem: (name, value) => {
        if (failure) {
          blocked += 1;
          return;
        }
        return base.setItem(name, value);
      },
      removeItem: (name) => {
        if (failure) {
          blocked += 1;
          return;
        }
        return base.removeItem(name);
      },
    }),
  };
}

export interface PersistSetup<S, P> {
  name: string;
  // The version this build writes and understands.
  version: number;
  baseStorage: StateStorage;
  guard: WriteGuard;
  migrate: (persisted: unknown, version: number) => P | Promise<P>;
  // Completes a payload that is already at the current version but was stored by an earlier build with
  // less in it (data v8 grew over several builds): runs on EVERY hydration, must return the state
  // unchanged when it is complete, and must be idempotent. If it throws, hydration fails closed.
  normalize?: (persisted: unknown) => unknown;
  partialize: (state: S) => P;
  // Hydration finished normally (including "nothing stored yet").
  onSuccess: () => void;
  // Hydration failed; the guard is already blocking writes when this runs.
  onFailure: (failure: HydrationFailure) => void;
  skipHydration?: boolean;
  log?: (failure: HydrationFailure, error: unknown) => void;
}

// The zustand persist options shared by the app store and the tests.
export function createPersistOptions<S, P>(setup: PersistSetup<S, P>): PersistOptions<S, P> {
  const guarded = setup.guard.wrap(setup.baseStorage);
  const storage: StateStorage = {
    getItem: async (name) => normalizeStoredPayload(await guarded.getItem(name)),
    setItem: guarded.setItem,
    removeItem: guarded.removeItem,
  };
  const log =
    setup.log ??
    ((failure: HydrationFailure, error: unknown) =>
      console.error('[wealth] hydration failed — stored data left untouched', failure, error));

  const fail = (error: unknown) => {
    const failure = classifyHydrationError(error);
    // Block first: from here on nothing can write, whatever the callbacks below do.
    setup.guard.block(failure);
    log(failure, error);
    setup.onFailure(failure);
  };

  return {
    name: setup.name,
    version: setup.version,
    storage: createJSONStorage<P>(() => storage),
    ...(setup.skipHydration ? { skipHydration: true } : {}),
    partialize: setup.partialize,
    ...(setup.normalize
      ? {
          merge: (persisted: unknown, current: S) => {
            if (typeof persisted !== 'object' || persisted === null) return current;
            try {
              return { ...current, ...(setup.normalize!(persisted) as object) };
            } catch (error) {
              throw new MigrationFailedError(setup.version, error);
            }
          },
        }
      : {}),
    migrate: guardedMigrate(setup.version, setup.migrate) as PersistOptions<S, P>['migrate'],
    onRehydrateStorage: () => (_state, error) => {
      if (error !== undefined) {
        fail(error);
        return;
      }
      try {
        setup.onSuccess();
      } catch (callbackError) {
        fail(callbackError);
      }
    },
  };
}
