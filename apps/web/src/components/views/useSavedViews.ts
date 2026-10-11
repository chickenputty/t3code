import type { SavedView, SavedViewLayout } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import type { ServerSettings } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  usePrimarySettings,
  usePrimarySettingsAvailable,
  useUpdatePrimarySettings,
} from "~/hooks/useSettings";
import { useSidebarViewStore } from "~/components/sidebar/sidebarViewStore";
import { primaryServerSettingsAtom } from "~/state/server";

import { createPendingSetting } from "./pendingSetting";
import { duplicateSavedView, removeSavedView, updateSavedView } from "./savedViewList";
import {
  DEFAULT_SAVED_VIEWS,
  newSavedView,
  newSavedViewId,
  withBuiltInThreadsView,
} from "./viewEngine";

// A new view must exist before the page that opens it reads the list.
const pending = createPendingSetting<readonly SavedView[]>();

/**
 * The saved views on the primary server, or the defaults until the first
 * edit, always led by the built-in Threads view (stored, or built from this
 * device's sidebar arrangement until it is first edited). Every write
 * replaces the whole stored list; the server keeps it in `settings.json` and
 * other servers get a copy through shared settings.
 */
export function useSavedViews() {
  const stored = usePrimarySettings((settings) => settings.savedViews);
  const canSave = usePrimarySettingsAvailable();
  const updateSettings = useUpdatePrimarySettings();
  const optimistic = pending.usePending(stored);
  const storedViews = optimistic ?? stored ?? DEFAULT_SAVED_VIEWS;
  const local = useSidebarViewStore(
    useShallow((state) => ({
      groupByProject: state.groupByProject,
      pinsStayGrouped: state.pinsStayGrouped,
      sort: state.sort,
      projectSort: state.projectSort,
    })),
  );
  const views = useMemo(() => withBuiltInThreadsView(storedViews, local), [local, storedViews]);

  const write = useCallback(
    (next: readonly SavedView[]) => {
      pending.set(next);
      void updateSettings({ savedViews: [...next] }).then((landed) => {
        // A refused or failed write never echoes back; stop showing it as saved.
        if (!landed && pending.read() === next) pending.set(null);
      });
    },
    [updateSettings],
  );

  const actions = useMemo(() => {
    // Always build on the newest list, including writes not yet echoed.
    const current = () => pending.read() ?? storedViews;
    return {
      update(id: string, patch: Partial<Omit<SavedView, "id">>) {
        write(updateSavedView(current(), id, patch, local));
      },
      create(layout: SavedViewLayout): SavedView {
        const view = newSavedView(layout, newSavedViewId());
        write([...current(), view]);
        return view;
      },
      duplicate(id: string): SavedView | null {
        const result = duplicateSavedView(current(), id, newSavedViewId(), local);
        if (!result) return null;
        write(result.list);
        return result.copy;
      },
      /** The built-in Threads view always exists; removing it does nothing. */
      remove(id: string) {
        const list = current();
        const next = removeSavedView(list, id);
        // Nothing to remove (the built-in view, or an id already gone): no settings write.
        if (next.length !== list.length) write(next);
      },
    };
  }, [local, storedViews, write]);

  return { views, canSave, ...actions };
}

/**
 * One primitive fact about the stored views (pending write included, built-in
 * Threads view not), for components that must not re-render on every view
 * edit. `select` should be stable.
 */
export function useSavedViewsValue<R extends string | number | boolean | null>(
  select: (stored: readonly SavedView[]) => R,
): R {
  const fromPending = pending.useSelect((list) => (list === null ? undefined : select(list)));
  const fromStored = useAtomValue(
    primaryServerSettingsAtom,
    useCallback(
      (settings: ServerSettings) => select(settings.savedViews ?? DEFAULT_SAVED_VIEWS),
      [select],
    ),
  );
  return fromPending === undefined ? fromStored : fromPending;
}
