/**
 * Fork (chickenputty/t3code): the sidebar header's view menu (group by project,
 * topic emoji, sort, thread row height), and the header row each project group
 * opens with.
 */
import { SidebarThreadRowDensity } from "@t3tools/contracts";
import {
  AlarmClockIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  EyeIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  SIDEBAR_THREAD_ROW_DENSITY_LABELS,
  SIDEBAR_THREAD_SORT_DIRECTION_LABELS,
  SIDEBAR_THREAD_SORT_FIELDS,
  SIDEBAR_THREAD_SORT_LABELS,
  type SidebarThreadSortField,
} from "./sidebarArrangement";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import { useSidebarViewStore } from "./sidebarViewStore";

/** A submenu's current choice, right-aligned before its chevron. */
function MenuSubValue(props: { children: ReactNode }) {
  return (
    <span className="flex-1 ps-4 text-end text-muted-foreground text-xs">{props.children}</span>
  );
}

export function SidebarViewControls() {
  const groupByProject = useSidebarViewStore((state) => state.groupByProject);
  const toggleGroupByProject = useSidebarViewStore((state) => state.toggleGroupByProject);
  const sort = useSidebarViewStore((state) => state.sort);
  const setSortField = useSidebarViewStore((state) => state.setSortField);
  const setSortReversed = useSidebarViewStore((state) => state.setSortReversed);
  const rowDensity = useClientSettings((settings) => settings.sidebarThreadRowDensity);
  const showEmoji = useClientSettings((settings) => settings.sidebarThreadEmoji);
  const updateSettings = useUpdateClientSettings();
  const directionLabels =
    sort.field === "manual" ? null : SIDEBAR_THREAD_SORT_DIRECTION_LABELS[sort.field];
  const sortSummary =
    directionLabels === null
      ? SIDEBAR_THREAD_SORT_LABELS.manual
      : `${SIDEBAR_THREAD_SORT_LABELS[sort.field]}, ${directionLabels[sort.reversed ? 1 : 0].toLowerCase()}`;

  return (
    <Menu>
      <MenuTrigger
        render={
          <SidebarHeaderIconButton
            label="View options"
            // Lit while the list is regrouped or resorted, so a changed order never surprises.
            data-active={groupByProject || sort.field !== "manual"}
          />
        }
      >
        <SlidersHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" className="min-w-56">
        <MenuCheckboxItem
          variant="switch"
          checked={groupByProject}
          onCheckedChange={(checked) => {
            if (checked !== groupByProject) toggleGroupByProject();
          }}
        >
          Group by project
        </MenuCheckboxItem>
        <MenuCheckboxItem
          variant="switch"
          checked={showEmoji}
          onCheckedChange={(checked) => updateSettings({ sidebarThreadEmoji: checked })}
        >
          Topic emoji
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuSub>
          <MenuSubTrigger>
            Sort
            <MenuSubValue>{sortSummary}</MenuSubValue>
          </MenuSubTrigger>
          <MenuSubPopup className="min-w-44">
            <MenuGroup>
              <MenuRadioGroup
                value={sort.field}
                onValueChange={(value) => setSortField(value as SidebarThreadSortField)}
              >
                {SIDEBAR_THREAD_SORT_FIELDS.map((field) => (
                  <MenuRadioItem key={field} value={field}>
                    {SIDEBAR_THREAD_SORT_LABELS[field]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            {directionLabels === null ? (
              <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
                Drag threads to arrange them.
              </p>
            ) : (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuRadioGroup
                    value={sort.reversed ? "reversed" : "natural"}
                    onValueChange={(value) => setSortReversed(value === "reversed")}
                  >
                    <MenuRadioItem value="natural">{directionLabels[0]}</MenuRadioItem>
                    <MenuRadioItem value="reversed">{directionLabels[1]}</MenuRadioItem>
                  </MenuRadioGroup>
                </MenuGroup>
              </>
            )}
          </MenuSubPopup>
        </MenuSub>
        <MenuSub>
          <MenuSubTrigger>
            Thread rows
            <MenuSubValue>{SIDEBAR_THREAD_ROW_DENSITY_LABELS[rowDensity]}</MenuSubValue>
          </MenuSubTrigger>
          <MenuSubPopup className="min-w-40">
            <MenuRadioGroup
              value={rowDensity}
              onValueChange={(value) =>
                updateSettings({ sidebarThreadRowDensity: value as SidebarThreadRowDensity })
              }
            >
              {SidebarThreadRowDensity.literals.map((density) => (
                <MenuRadioItem key={density} value={density}>
                  {SIDEBAR_THREAD_ROW_DENSITY_LABELS[density]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
      </MenuPopup>
    </Menu>
  );
}

/** A grouped row's topic emoji, sized to the project icon it stands in for. */
export function ThreadTopicEmoji(props: { emoji: string }) {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center text-sm leading-none"
    >
      {props.emoji}
    </span>
  );
}

/** The card's status icons, alone: a slim row's whole status slot. */
export function SidebarStatusGlyph(props: {
  icon: "working" | "monitoring" | "approval" | "input" | "failed" | "woke" | "done";
}) {
  const className = "size-4 shrink-0";
  switch (props.icon) {
    case "working":
      return <CircleDashedIcon aria-hidden className={className} />;
    case "monitoring":
      return <EyeIcon aria-hidden className={className} />;
    case "approval":
      return <ShieldQuestionIcon aria-hidden className={className} />;
    case "input":
      return <MessageCircleQuestionIcon aria-hidden className={className} />;
    case "failed":
      return <CircleAlertIcon aria-hidden className={className} />;
    case "woke":
      return <AlarmClockIcon aria-hidden className={className} />;
    case "done":
      return <CircleCheckIcon aria-hidden className={className} />;
  }
}

/** Opens one project's group in the grouped active list; collapses it on click. */
export function SidebarProjectGroupHeader(props: {
  label: string;
  count: number;
  collapsed: boolean;
  icon: ReactNode;
  onToggle: () => void;
}) {
  return (
    <li className="mx-0.5 list-none" data-testid="sidebar-project-group-header">
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={!props.collapsed}
        className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">{props.icon}</span>
        <span className="min-w-0 truncate">{props.label}</span>
        <span className="shrink-0 tabular-nums text-sidebar-muted-foreground/60">
          {props.count}
        </span>
        <span aria-hidden className="h-px min-w-2 flex-1 bg-sidebar-border/60" />
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", props.collapsed && "-rotate-90")}
        />
      </button>
    </li>
  );
}
