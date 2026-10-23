/**
 * Fork (chickenputty/t3code): the body of a chat pane's non-chat tab. It
 * covers the timeline (which stays mounted underneath) and leaves room at the
 * bottom for the composer overlay, so the composer stays live on every tab.
 * Nothing mounts while the Chat tab is shown.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Spinner } from "~/components/ui/spinner";
import { buildInspectorModel, type InspectorModel } from "~/components/views/inspectorModel";
import { useMinuteClock, useViewRow } from "~/components/views/useViewRows";
import { useThreadCategories } from "~/components/views/useThreadCategories";
import { type ViewBulkAction, useViewThreadOps } from "~/components/views/useViewThreadOps";
import type { ViewRow } from "~/components/views/viewEngine";
import { useThreadProjection } from "~/state/entities";

import { ThreadActivityTab } from "./ThreadActivityTab";
import { ThreadFilesTab } from "./ThreadFilesTab";
import { ThreadOverviewTab } from "./ThreadOverviewTab";
import { ThreadRulePinsSection } from "./ThreadRulePinsSection";
import { type ThreadPaneTab, useShownThreadPaneTab } from "./threadPaneTabStore";
import { ThreadUsageTab } from "./ThreadUsageTab";

export function ThreadPaneTabBody({
  threadRef,
  enabled,
  bottomInset,
}: {
  threadRef: ScopedThreadRef | null;
  enabled: boolean;
  /** The height the timeline reserves for the composer overlay. */
  bottomInset: number;
}) {
  const tab = useShownThreadPaneTab(enabled);
  if (tab === "chat" || threadRef === null) return null;
  return (
    <div
      role="tabpanel"
      className="absolute inset-0 z-10 overflow-y-auto bg-background scrollbar-gutter-both"
      style={{ paddingBottom: bottomInset }}
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-4">
        <PaneTabContent tab={tab} threadRef={threadRef} />
      </div>
    </div>
  );
}

function PaneTabContent({
  tab,
  threadRef,
}: {
  tab: Exclude<ThreadPaneTab, "chat">;
  threadRef: ScopedThreadRef;
}) {
  const thread = useThreadProjection(threadRef);
  const model = thread ? buildInspectorModel(thread.projection) : null;
  const nowMs = useMinuteClock();
  if (tab === "overview") return <PaneOverview threadRef={threadRef} model={model} />;
  if (model === null) return <PaneLoading />;
  if (tab === "files") return <ThreadFilesTab model={model} />;
  if (tab === "activity") return <ThreadActivityTab model={model} nowMs={nowMs} />;
  return <ThreadUsageTab model={model} />;
}

/**
 * The Overview needs the thread's view row, built the same way saved views
 * build theirs, for this thread alone. A thread missing from the live shells
 * (archived) is looked up in its environment's archived feed, so its Overview
 * still offers Unarchive.
 */
function PaneOverview({
  threadRef,
  model,
}: {
  threadRef: ScopedThreadRef;
  model: InspectorModel | null;
}) {
  const categories = useThreadCategories();
  const { row, nowMs, archivedLoading } = useViewRow(threadRef, categories);
  const ops = useViewThreadOps();
  const onAction = (target: ViewRow, action: ViewBulkAction) => void ops.runBulk([target], action);
  if (row === null) {
    return archivedLoading ? (
      <PaneLoading />
    ) : (
      <p className="text-muted-foreground text-sm">This thread is not loaded.</p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <ThreadRulePinsSection threadRef={threadRef} />
      <ThreadOverviewTab row={row} model={model} nowMs={nowMs} onAction={onAction} />
    </div>
  );
}

function PaneLoading() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm">
      <Spinner className="size-4" />
      Loading conversation…
    </div>
  );
}
