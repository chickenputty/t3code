/**
 * Fork (chickenputty/t3code): the view dropdown beside the brand. "Threads"
 * is today's sidebar and chat; every other entry is a saved view that takes
 * the whole window below the top bar.
 */
import type { SavedViewLayout } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  Columns3Icon,
  LayoutGridIcon,
  ListIcon,
  MessagesSquareIcon,
  PlusIcon,
  Table2Icon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useNavigateToMainApp } from "~/components/sidebar/mainAppLocation";
import { useSidebar } from "~/components/ui/sidebar";

import { useSavedViews } from "./useSavedViews";
import { VIEW_LAYOUT_LABELS } from "./viewEngine";

export const VIEW_LAYOUT_ICONS: Record<SavedViewLayout, typeof ListIcon> = {
  list: ListIcon,
  board: Columns3Icon,
  gallery: LayoutGridIcon,
  table: Table2Icon,
};

const LAYOUTS: readonly SavedViewLayout[] = ["list", "board", "gallery", "table"];

export function ViewSwitcher({ currentViewId }: { readonly currentViewId: string | null }) {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const { views, create, canSave } = useSavedViews();
  const { isMobile, setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const current = currentViewId === null ? null : views.find((view) => view.id === currentViewId);
  const CurrentIcon = current ? VIEW_LAYOUT_ICONS[current.layout] : MessagesSquareIcon;

  const openView = (viewId: string) => {
    // The switcher also sits in the mobile sidebar sheet; a view replaces it.
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/views/$viewId", params: { viewId } });
  };

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button
            variant="ghost-muted"
            size="xs"
            aria-label="Switch view"
            className="relative z-10 max-w-48 shrink-0"
          />
        }
      >
        <CurrentIcon />
        <span className="truncate">{current?.name ?? "Threads"}</span>
        <ChevronDownIcon className="size-3 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom" className="min-w-56">
        <MenuItem
          onClick={() => {
            if (currentViewId !== null) void navigateToMainApp();
          }}
          data-active={currentViewId === null}
        >
          <MessagesSquareIcon />
          Threads
        </MenuItem>
        <MenuSeparator />
        {views.map((view) => {
          const Icon = VIEW_LAYOUT_ICONS[view.layout];
          return (
            <MenuItem key={view.id} onClick={() => openView(view.id)}>
              <Icon />
              <span className="min-w-0 flex-1 truncate">{view.name}</span>
              {view.id === currentViewId ? (
                <span className="text-muted-foreground text-xs">Current</span>
              ) : null}
            </MenuItem>
          );
        })}
        {canSave ? <MenuSeparator /> : null}
        {canSave ? (
          <MenuSub>
            <MenuSubTrigger>
              <PlusIcon />
              New view
            </MenuSubTrigger>
            <MenuSubPopup className="min-w-40">
              {LAYOUTS.map((layout) => {
                const Icon = VIEW_LAYOUT_ICONS[layout];
                return (
                  <MenuItem key={layout} onClick={() => openView(create(layout).id)}>
                    <Icon />
                    {VIEW_LAYOUT_LABELS[layout]}
                  </MenuItem>
                );
              })}
            </MenuSubPopup>
          </MenuSub>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
