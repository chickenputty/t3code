/**
 * Fork (chickenputty/t3code): what the left sidebar shows outside settings.
 * A Threads layout is upstream's thread list; every other layout is a card
 * view sized to the sidebar.
 */
import { memo } from "react";

import ThreadSidebar from "../Sidebar";
import { SidebarViewPanel } from "../views/SidebarViewPanel";
import { useActiveExplorerView, useActiveExplorerViewIdentity } from "./useActiveExplorerView";

// Takes no props: a saved view edit re-renders it only through its own subscriptions.
const MemoThreadSidebar = memo(ThreadSidebar);

export function ExplorerSidebarContent() {
  const { id, layout } = useActiveExplorerViewIdentity();
  if (layout === "threads") return <MemoThreadSidebar />;
  // Keyed so search, selection and renaming start fresh in each view.
  return <ActiveViewPanel key={id} />;
}

function ActiveViewPanel() {
  const view = useActiveExplorerView();
  return <SidebarViewPanel view={view} />;
}
