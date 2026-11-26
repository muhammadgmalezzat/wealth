// Memoization for pure analytics selectors. The store replaces a collection's array whenever it changes (zustand
// patches), so array identity is a complete cache key: an edit, a backdated insert or a delete makes a new array and
// the cached value is never reused for it. Caches are WeakMaps keyed on the FIRST reference, so they disappear with
// the state they were computed from.
//
// `refs`: every collection (or settings object) the computation reads; `key`: the scalar inputs (period, currency…).

export type MemoCache<T> = WeakMap<object, Map<string, { refs: readonly object[]; value: T }>>;

// Small per first-ref map, so a long session flipping through periods can't grow without bound.
const MAX_ENTRIES = 64;

export function memoOn<T>(cache: MemoCache<T>, refs: readonly object[], key: string, compute: () => T): T {
  let byKey = cache.get(refs[0]);
  if (!byKey) {
    byKey = new Map();
    cache.set(refs[0], byKey);
  }
  const hit = byKey.get(key);
  if (hit && hit.refs.length === refs.length && hit.refs.every((r, i) => r === refs[i])) return hit.value;
  const value = compute();
  if (byKey.size >= MAX_ENTRIES) byKey.delete(byKey.keys().next().value as string);
  byKey.set(key, { refs, value });
  return value;
}

export const createMemoCache = <T>(): MemoCache<T> => new WeakMap();
