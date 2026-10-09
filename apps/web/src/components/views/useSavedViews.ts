import type { SavedView, SavedViewLayout } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  usePrimarySettings,
  usePrimarySettingsAvailable,
  useUpdatePrimarySettings,
} from "~/hooks/useSettings";

import { DEFAULT_SAVED_VIEWS, newSavedView, newSavedViewId } from "./viewEngine";

/**
 * The list this client last wrote, until the server echoes it back. Server
 * settings are not patched locally, so without it a second quick edit would
 * start from the stale list and drop the first, and a new view would not
 * exist yet when the page opens it.
 */
let pending: readonly SavedView[] | null = null;
const listeners = new Set<() => void>();
function setPending(next: readonly SavedView[] | null) {
  pending = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const readPending = () => pending;

// Key order can differ once the server has decoded and re-encoded the list.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

function sameViews(left: readonly SavedView[] | null, right: readonly SavedView[] | null) {
  return canonical(left) === canonical(right);
}

/**
 * The saved views on the primary server, or the defaults until the first
 * edit. Every write replaces the whole list; the server keeps it in
 * `settings.json` and other servers get a copy through shared settings.
 */
export function useSavedViews() {
  const stored = usePrimarySettings((settings) => settings.savedViews);
  const canSave = usePrimarySettingsAvailable();
  const updateSettings = useUpdatePrimarySettings();
  const optimistic = useSyncExternalStore(subscribe, readPending);
  const views = optimistic ?? stored ?? DEFAULT_SAVED_VIEWS;

  // The echo arrived: the server value is current again.
  useEffect(() => {
    if (pending !== null && sameViews(pending, stored)) setPending(null);
  }, [stored]);

  const write = useCallback(
    (next: readonly SavedView[]) => {
      setPending(next);
      updateSettings({ savedViews: [...next] });
    },
    [updateSettings],
  );

  const actions = useMemo(() => {
    // Always build on the newest list, including writes not yet echoed.
    const current = () => pending ?? views;
    return {
      update(id: string, patch: Partial<Omit<SavedView, "id">>) {
        write(current().map((view) => (view.id === id ? { ...view, ...patch } : view)));
      },
      create(layout: SavedViewLayout): SavedView {
        const view = newSavedView(layout, newSavedViewId());
        write([...current(), view]);
        return view;
      },
      duplicate(id: string): SavedView | null {
        const list = current();
        const source = list.find((view) => view.id === id);
        if (!source) return null;
        const copy = { ...source, id: newSavedViewId(), name: `${source.name} copy` };
        const index = list.indexOf(source);
        write([...list.slice(0, index + 1), copy, ...list.slice(index + 1)]);
        return copy;
      },
      remove(id: string) {
        write(current().filter((view) => view.id !== id));
      },
    };
  }, [views, write]);

  return { views, canSave, ...actions };
}
