import type { SavedView, SavedViewLayout } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import {
  usePrimarySettings,
  usePrimarySettingsAvailable,
  useUpdatePrimarySettings,
} from "~/hooks/useSettings";

import { createPendingSetting } from "./pendingSetting";
import { DEFAULT_SAVED_VIEWS, newSavedView, newSavedViewId } from "./viewEngine";

// A new view must exist before the page that opens it reads the list.
const pending = createPendingSetting<readonly SavedView[]>();

/**
 * The saved views on the primary server, or the defaults until the first
 * edit. Every write replaces the whole list; the server keeps it in
 * `settings.json` and other servers get a copy through shared settings.
 */
export function useSavedViews() {
  const stored = usePrimarySettings((settings) => settings.savedViews);
  const canSave = usePrimarySettingsAvailable();
  const updateSettings = useUpdatePrimarySettings();
  const optimistic = pending.usePending(stored);
  const views = optimistic ?? stored ?? DEFAULT_SAVED_VIEWS;

  const write = useCallback(
    (next: readonly SavedView[]) => {
      pending.set(next);
      updateSettings({ savedViews: [...next] });
    },
    [updateSettings],
  );

  const actions = useMemo(() => {
    // Always build on the newest list, including writes not yet echoed.
    const current = () => pending.read() ?? views;
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
