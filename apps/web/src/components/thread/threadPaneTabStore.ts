/**
 * Fork (chickenputty/t3code): which tab each chat pane shows under its header.
 * The choice belongs to the pane, not the thread, so it stays put while the
 * user moves between threads, and it survives a reload.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useChatPane } from "~/components/chat/ChatPaneContext";
import { resolveStorage } from "~/lib/storage";
import type { ThreadSplitPane } from "~/threadSplitStore";

export const THREAD_PANE_TABS = ["chat", "overview", "files", "activity", "usage"] as const;
export type ThreadPaneTab = (typeof THREAD_PANE_TABS)[number];

export const THREAD_PANE_TAB_LABELS: Record<ThreadPaneTab, string> = {
  chat: "Chat",
  overview: "Overview",
  files: "Files",
  activity: "Activity",
  usage: "Usage",
};

type ThreadPaneTabs = Record<ThreadSplitPane, ThreadPaneTab>;

const DEFAULT_TABS: ThreadPaneTabs = { primary: "chat", secondary: "chat" };

/** One pane's tab from persisted state; anything unknown (a newer build's tab) reads as chat. */
export function readThreadPaneTab(raw: unknown, pane: ThreadSplitPane): ThreadPaneTab {
  if (typeof raw !== "object" || raw === null) return "chat";
  const tabs = (raw as { tabs?: unknown }).tabs;
  if (typeof tabs !== "object" || tabs === null) return "chat";
  const value = (tabs as Record<string, unknown>)[pane];
  return THREAD_PANE_TABS.find((tab) => tab === value) ?? "chat";
}

interface ThreadPaneTabState {
  readonly tabs: ThreadPaneTabs;
  readonly setTab: (pane: ThreadSplitPane, tab: ThreadPaneTab) => void;
}

export const useThreadPaneTabStore = create<ThreadPaneTabState>()(
  persist(
    (set) => ({
      tabs: DEFAULT_TABS,
      setTab: (pane, tab) =>
        set((state) =>
          state.tabs[pane] === tab ? state : { tabs: { ...state.tabs, [pane]: tab } },
        ),
    }),
    {
      name: "t3code:fork:thread-pane-tab:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      partialize: ({ tabs }) => ({ tabs }),
      merge: (persisted, current) => ({
        ...current,
        tabs: {
          primary: readThreadPaneTab(persisted, "primary"),
          secondary: readThreadPaneTab(persisted, "secondary"),
        },
      }),
    },
  ),
);

/**
 * The tab this ChatView's pane shows. A pane without tabs (a draft, the empty
 * hero composer) always shows chat, whatever it remembers for later.
 */
export function useShownThreadPaneTab(enabled: boolean): ThreadPaneTab {
  const { paneId } = useChatPane();
  const tab = useThreadPaneTabStore((state) => state.tabs[paneId]);
  return enabled ? tab : "chat";
}
