// Fork: the saved view the sidebar explorer shows, falling back to the built-in Threads view.
import type { SavedView, SavedViewLayout } from "@t3tools/contracts";

import {
  DEFAULT_SIDEBAR_PROJECT_SORT,
  MANUAL_SIDEBAR_THREAD_SORT,
} from "~/components/sidebar/sidebarArrangement";

import { useSavedViews, useSavedViewsValue } from "../views/useSavedViews";
import { type LocalThreadsArrangement, withBuiltInThreadsView } from "../views/viewEngine";
import { resolveActiveExplorerView, useExplorerStore } from "./explorerStore";

export function useActiveExplorerView(): SavedView {
  const { views } = useSavedViews();
  const activeViewId = useExplorerStore((state) => state.activeViewId);
  return resolveActiveExplorerView(views, activeViewId);
}

export interface ExplorerViewIdentity {
  readonly id: string;
  readonly layout: SavedViewLayout;
  readonly name: string;
}

// Only the built-in view's id, layout and fixed name are read; its arrangement is not.
const ANY_ARRANGEMENT: LocalThreadsArrangement = {
  groupByProject: false,
  pinsStayGrouped: false,
  sort: MANUAL_SIDEBAR_THREAD_SORT,
  projectSort: DEFAULT_SIDEBAR_PROJECT_SORT,
};

/**
 * The active view's id, layout and name alone: re-renders only when one of
 * them changes, not on every edit to a saved view.
 */
export function useActiveExplorerViewIdentity(): ExplorerViewIdentity {
  const activeViewId = useExplorerStore((state) => state.activeViewId);
  const key = useSavedViewsValue((stored: readonly SavedView[]) => {
    const view = resolveActiveExplorerView(
      withBuiltInThreadsView(stored, ANY_ARRANGEMENT),
      activeViewId,
    );
    return JSON.stringify([view.id, view.layout, view.name]);
  });
  const [id, layout, name] = JSON.parse(key) as [string, SavedViewLayout, string];
  return { id, layout, name };
}
