/**
 * Fork (chickenputty/t3code): which saved view the sidebar explorer shows on
 * this device. Kept in its own storage key, like the sidebar arrangement.
 */
import type { SavedView } from "@t3tools/contracts";
import { create } from "zustand";

import { BUILT_IN_THREADS_VIEW_ID } from "../views/viewEngine";

const STORAGE_KEY = "t3code:fork:explorer:v1";

interface ExplorerState {
  readonly activeViewId: string | null;
  /** Bumped by `showView`; the sidebar opens itself when it changes. */
  readonly revealRequest: number;
  readonly setActiveViewId: (id: string | null) => void;
  /** Picks a view from outside the sidebar (switcher, palette, deep link) and opens the sidebar. */
  readonly showView: (id: string) => void;
}

function readActiveViewId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const id = (parsed as { activeViewId?: unknown } | null)?.activeViewId;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

export const useExplorerStore = create<ExplorerState>((set) => ({
  activeViewId: readActiveViewId(),
  revealRequest: 0,
  setActiveViewId: (id) =>
    set((state) => (state.activeViewId === id ? state : { activeViewId: id })),
  showView: (id) => set((state) => ({ activeViewId: id, revealRequest: state.revealRequest + 1 })),
}));

useExplorerStore.subscribe((state, previous) => {
  if (typeof window === "undefined" || state.activeViewId === previous.activeViewId) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeViewId: state.activeViewId }));
  } catch {
    // Storage can be full or disabled; the choice still holds for this session.
  }
});

/** Unknown or null ids fall back to the built-in Threads view, which `views` always contains. */
export function resolveActiveExplorerView(
  views: readonly SavedView[],
  activeViewId: string | null,
): SavedView {
  const found = views.find((view) => view.id === activeViewId);
  if (found) return found;
  const builtIn = views.find((view) => view.id === BUILT_IN_THREADS_VIEW_ID);
  if (!builtIn) throw new Error("Explorer views must include the built-in Threads view.");
  return builtIn;
}
