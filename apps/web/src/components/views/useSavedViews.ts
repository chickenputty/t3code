import type { SavedView, SavedViewLayout } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";

import { DEFAULT_SAVED_VIEWS, newSavedView, newSavedViewId } from "./viewEngine";

/**
 * The saved views on the primary server, or the defaults until the first
 * edit. Every write replaces the whole list; the server keeps it in
 * `settings.json` and other servers get a copy through shared settings.
 */
export function useSavedViews() {
  const stored = usePrimarySettings((settings) => settings.savedViews);
  const updateSettings = useUpdatePrimarySettings();
  const views = stored ?? DEFAULT_SAVED_VIEWS;

  const write = useCallback(
    (next: readonly SavedView[]) => updateSettings({ savedViews: [...next] }),
    [updateSettings],
  );

  const actions = useMemo(
    () => ({
      update(id: string, patch: Partial<Omit<SavedView, "id">>) {
        write(views.map((view) => (view.id === id ? { ...view, ...patch } : view)));
      },
      create(layout: SavedViewLayout): SavedView {
        const view = newSavedView(layout, newSavedViewId());
        write([...views, view]);
        return view;
      },
      duplicate(id: string): SavedView | null {
        const source = views.find((view) => view.id === id);
        if (!source) return null;
        const copy = { ...source, id: newSavedViewId(), name: `${source.name} copy` };
        const index = views.indexOf(source);
        write([...views.slice(0, index + 1), copy, ...views.slice(index + 1)]);
        return copy;
      },
      remove(id: string) {
        write(views.filter((view) => view.id !== id));
      },
      move(id: string, offset: -1 | 1) {
        const index = views.findIndex((view) => view.id === id);
        const target = index + offset;
        if (index === -1 || target < 0 || target >= views.length) return;
        const next = [...views];
        [next[index], next[target]] = [next[target]!, next[index]!];
        write(next);
      },
    }),
    [views, write],
  );

  return { views, ...actions };
}
