/**
 * Fork (chickenputty/t3code): the view dropdown beside the brand. Picking a
 * view shows it in the sidebar explorer in place; the built-in Threads view
 * (the native thread list) is always listed first.
 */
import type { SavedViewLayout } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  Columns3Icon,
  LayoutGridIcon,
  ListIcon,
  MessagesSquareIcon,
  PlusIcon,
  Table2Icon,
} from "lucide-react";
import { Fragment, useState } from "react";

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
import { useExplorerStore } from "~/components/explorer/explorerStore";
import { useActiveExplorerView } from "~/components/explorer/useActiveExplorerView";

import { useSavedViews } from "./useSavedViews";
import { VIEW_LAYOUT_LABELS } from "./viewEngine";

export const VIEW_LAYOUT_ICONS: Record<SavedViewLayout, typeof ListIcon> = {
  list: ListIcon,
  board: Columns3Icon,
  gallery: LayoutGridIcon,
  table: Table2Icon,
  threads: MessagesSquareIcon,
};

const LAYOUTS: readonly SavedViewLayout[] = ["list", "board", "gallery", "table"];

export function ViewSwitcher() {
  const { views, create, canSave } = useSavedViews();
  const current = useActiveExplorerView();
  const setActiveViewId = useExplorerStore((state) => state.setActiveViewId);
  const [open, setOpen] = useState(false);
  const CurrentIcon = VIEW_LAYOUT_ICONS[current.layout];

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
        <span className="truncate">{current.name}</span>
        <ChevronDownIcon className="size-3 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom" className="min-w-56">
        {views.map((view, index) => {
          const Icon = VIEW_LAYOUT_ICONS[view.layout];
          return (
            <Fragment key={view.id}>
              <MenuItem
                onClick={() => setActiveViewId(view.id)}
                data-active={view.id === current.id}
              >
                <Icon />
                <span className="min-w-0 flex-1 truncate">{view.name}</span>
                {view.id === current.id ? (
                  <span className="text-muted-foreground text-xs">Current</span>
                ) : null}
              </MenuItem>
              {/* The built-in Threads view leads the list on its own. */}
              {index === 0 && views.length > 1 ? <MenuSeparator /> : null}
            </Fragment>
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
                  <MenuItem key={layout} onClick={() => setActiveViewId(create(layout).id)}>
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
