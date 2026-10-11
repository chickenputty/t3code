/**
 * Fork (chickenputty/t3code): the Chat | Overview | Files | Activity | Usage
 * strip under a chat's header. Drafts have no strip.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useChatPane } from "~/components/chat/ChatPaneContext";
import { cn } from "~/lib/utils";

import {
  THREAD_PANE_TAB_LABELS,
  THREAD_PANE_TABS,
  useShownThreadPaneTab,
  useThreadPaneTabStore,
} from "./threadPaneTabStore";

export function ThreadPaneTabStrip({
  threadRef,
  enabled,
}: {
  threadRef: ScopedThreadRef | null;
  enabled: boolean;
}) {
  const { paneId } = useChatPane();
  const tab = useShownThreadPaneTab(enabled);
  const setTab = useThreadPaneTabStore((state) => state.setTab);
  if (!enabled || threadRef === null) return null;
  return (
    <div
      role="tablist"
      aria-label="Thread"
      className="flex shrink-0 gap-1 overflow-x-auto border-border/70 border-b pr-(--workspace-gutter-end) pl-(--workspace-gutter-start)"
    >
      {THREAD_PANE_TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => setTab(paneId, id)}
          className={cn(
            "-mb-px border-b-2 px-2.5 py-1.5 text-xs outline-none focus-visible:text-foreground",
            tab === id
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {THREAD_PANE_TAB_LABELS[id]}
        </button>
      ))}
    </div>
  );
}
