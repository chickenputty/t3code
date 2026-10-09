import { useEffect, useSyncExternalStore } from "react";

// Key order can differ once the server has decoded and re-encoded a value.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/**
 * The value this client last wrote to a whole-value server setting, until the
 * server echoes it back. Server settings are not patched locally, so without
 * it a second quick edit would start from the stale value and drop the first.
 */
export function createPendingSetting<T>() {
  let pending: T | null = null;
  const listeners = new Set<() => void>();
  const set = (next: T | null) => {
    pending = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const read = () => pending;
  return {
    set,
    read,
    /** The pending value while one is in flight; cleared when `stored` matches it. */
    usePending(stored: T | null): T | null {
      const value = useSyncExternalStore(subscribe, read);
      useEffect(() => {
        if (pending !== null && canonical(pending) === canonical(stored)) set(null);
      }, [stored]);
      return value;
    },
  };
}
