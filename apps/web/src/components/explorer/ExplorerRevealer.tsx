// Fork: opens the sidebar when a view is picked from outside it (the command palette sits above
// the sidebar provider). Mount inside `SidebarProvider`.
import { useEffect } from "react";

import { useSidebar } from "../ui/sidebar";
import { useExplorerStore } from "./explorerStore";

export function ExplorerRevealer() {
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the explorer store's reveal requests while mounted
  useEffect(
    () =>
      // Only a new request opens it; a later viewport change does not.
      useExplorerStore.subscribe((state, previous) => {
        if (state.revealRequest === previous.revealRequest) return;
        if (isMobile) setOpenMobile(true);
        else setOpen(true);
      }),
    [isMobile, setOpen, setOpenMobile],
  );
  return null;
}
