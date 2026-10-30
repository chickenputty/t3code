/**
 * Fork (chickenputty/t3code): the explorer sidebar remembers one width per
 * view. The built-in Threads view keeps upstream's storage key so existing
 * widths survive; every other view gets its own key. Values use the same
 * format as the resizable sidebar primitive (a JSON number).
 */
import { Schema } from "effect";
import type { SavedView, SavedViewLayout } from "@t3tools/contracts";

import { getLocalStorageItem } from "~/hooks/useLocalStorage";
import {
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
  clampThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
} from "../threadSidebarWidth";
import { BUILT_IN_THREADS_VIEW_ID } from "../views/viewEngine";

export function explorerWidthStorageKey(viewId: string): string {
  return viewId === BUILT_IN_THREADS_VIEW_ID
    ? THREAD_SIDEBAR_WIDTH_STORAGE_KEY
    : `t3code:fork:explorer:width:${viewId}`;
}

function defaultExplorerWidth(layout: SavedViewLayout): number {
  switch (layout) {
    case "gallery":
      return 520;
    case "table":
      return 720;
    case "board":
      return 880;
    default:
      return 256;
  }
}

function readStoredWidth(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    return getLocalStorageItem(key, Schema.Finite);
  } catch {
    return null;
  }
}

export function readExplorerWidth(
  view: Pick<SavedView, "id" | "layout">,
  viewportWidth: number,
  minimumWidth: number,
): number {
  const width =
    readStoredWidth(explorerWidthStorageKey(view.id)) ?? defaultExplorerWidth(view.layout);
  return clampThreadSidebarWidth(
    width,
    minimumWidth,
    resolveThreadSidebarMaximumWidth(viewportWidth, minimumWidth),
  );
}
