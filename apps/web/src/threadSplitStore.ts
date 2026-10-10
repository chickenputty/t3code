/**
 * Split view: a second server thread shown beside the routed one.
 *
 * The routed thread stays the primary (left) pane and keeps owning the URL,
 * so sidebar clicks, history and deep links behave exactly as without a split.
 * The store only remembers which thread sits in the secondary (right) pane,
 * which pane last had the user's attention, and the divider position.
 */
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type ThreadSplitPane = "primary" | "secondary";

export const THREAD_SPLIT_MIN_RATIO = 0.25;
export const THREAD_SPLIT_MAX_RATIO = 0.75;
const THREAD_SPLIT_DEFAULT_RATIO = 0.5;

export function clampThreadSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return THREAD_SPLIT_DEFAULT_RATIO;
  return Math.min(THREAD_SPLIT_MAX_RATIO, Math.max(THREAD_SPLIT_MIN_RATIO, ratio));
}

/**
 * The thread to show in the secondary pane, or null for a single pane. A
 * split of a thread with itself is no split: that happens when the user
 * navigates the primary pane onto the thread already shown on the right.
 */
export function resolveThreadSplitSecondary(input: {
  readonly routeThreadKey: string | null;
  readonly secondaryThreadKey: string | null;
}): ScopedThreadRef | null {
  if (input.secondaryThreadKey === null) return null;
  if (input.secondaryThreadKey === input.routeThreadKey) return null;
  return parseScopedThreadKey(input.secondaryThreadKey);
}

/**
 * The split item a thread's right-click menu offers. The routed thread cannot
 * split with itself, and phones have no room for a second pane.
 */
export function resolveSidebarSplitViewAction(input: {
  readonly threadKey: string;
  readonly routeThreadKey: string | null;
  readonly secondaryThreadKey: string | null;
  readonly isMobile: boolean;
}): "open" | "close" | null {
  if (input.threadKey === input.secondaryThreadKey) return "close";
  if (input.isMobile || input.threadKey === input.routeThreadKey) return null;
  return "open";
}

interface ThreadSplitState {
  secondaryThreadKey: string | null;
  focusedPane: ThreadSplitPane;
  ratio: number;
  openSplit: (threadRef: ScopedThreadRef) => void;
  closeSplit: () => void;
  focusPane: (pane: ThreadSplitPane) => void;
  setRatio: (ratio: number) => void;
}

export const useThreadSplitStore = create<ThreadSplitState>()(
  persist(
    (set) => ({
      secondaryThreadKey: null,
      focusedPane: "primary",
      ratio: THREAD_SPLIT_DEFAULT_RATIO,
      // The pane that just opened is where the user is about to look.
      openSplit: (threadRef) =>
        set({ secondaryThreadKey: scopedThreadKey(threadRef), focusedPane: "secondary" }),
      closeSplit: () => set({ secondaryThreadKey: null, focusedPane: "primary" }),
      focusPane: (pane) =>
        set((state) => (state.focusedPane === pane ? state : { focusedPane: pane })),
      setRatio: (ratio) => set({ ratio: clampThreadSplitRatio(ratio) }),
    }),
    {
      name: "t3code:thread-split:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      partialize: ({ secondaryThreadKey, ratio }) => ({ secondaryThreadKey, ratio }),
    },
  ),
);
