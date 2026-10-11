/**
 * Fork (chickenputty/t3code): the saved view the sidebar explorer shows,
 * falling back to the built-in Threads view when none is chosen or the chosen
 * one is gone.
 */
import type { SavedView } from "@t3tools/contracts";
import { useMemo } from "react";

import { useSavedViews } from "../views/useSavedViews";
import { resolveActiveExplorerView, useExplorerStore } from "./explorerStore";

export function useActiveExplorerView(): SavedView {
  const { views } = useSavedViews();
  const activeViewId = useExplorerStore((state) => state.activeViewId);
  return useMemo(() => resolveActiveExplorerView(views, activeViewId), [activeViewId, views]);
}
