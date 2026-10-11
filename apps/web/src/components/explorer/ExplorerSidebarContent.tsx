/**
 * Fork (chickenputty/t3code): what the left sidebar shows outside settings.
 * A Threads layout is upstream's thread list; every other layout is a card
 * view sized to the sidebar.
 */
import ThreadSidebar from "../Sidebar";
import { SidebarViewPanel } from "../views/SidebarViewPanel";
import { useActiveExplorerView } from "./useActiveExplorerView";

export function ExplorerSidebarContent() {
  const view = useActiveExplorerView();
  if (view.layout === "threads") return <ThreadSidebar />;
  // Keyed so search, selection and renaming start fresh in each view.
  return <SidebarViewPanel key={view.id} view={view} />;
}
