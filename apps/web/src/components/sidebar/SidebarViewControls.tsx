/**
 * Fork (chickenputty/t3code): the sidebar header's group-by-project toggle and
 * sort menu, and the header row each project group opens with.
 */
import {
  AlarmClockIcon,
  ArrowUpDownIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  EyeIcon,
  ListTreeIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  SIDEBAR_THREAD_SORT_DIRECTION_LABELS,
  SIDEBAR_THREAD_SORT_FIELDS,
  SIDEBAR_THREAD_SORT_LABELS,
  type SidebarThreadSortField,
} from "./sidebarArrangement";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import { useSidebarViewStore } from "./sidebarViewStore";

export function SidebarViewControls() {
  const groupByProject = useSidebarViewStore((state) => state.groupByProject);
  const toggleGroupByProject = useSidebarViewStore((state) => state.toggleGroupByProject);
  const sort = useSidebarViewStore((state) => state.sort);
  const setSortField = useSidebarViewStore((state) => state.setSortField);
  const setSortReversed = useSidebarViewStore((state) => state.setSortReversed);
  const directionLabels =
    sort.field === "manual" ? null : SIDEBAR_THREAD_SORT_DIRECTION_LABELS[sort.field];
  const sortLabel =
    directionLabels === null
      ? "Sort threads"
      : `Sort threads: ${SIDEBAR_THREAD_SORT_LABELS[sort.field]}, ${directionLabels[sort.reversed ? 1 : 0].toLowerCase()}`;

  return (
    <>
      <SidebarHeaderIconButton
        label={groupByProject ? "Stop grouping by project" : "Group by project"}
        aria-pressed={groupByProject}
        // A pressed button reads like a selected row: the menu button's own active style.
        data-active={groupByProject}
        onClick={toggleGroupByProject}
      >
        <ListTreeIcon />
      </SidebarHeaderIconButton>
      <Menu>
        <MenuTrigger
          render={
            <SidebarHeaderIconButton label={sortLabel} data-active={sort.field !== "manual"} />
          }
        >
          <ArrowUpDownIcon />
        </MenuTrigger>
        <MenuPopup align="end" side="bottom" className="min-w-44">
          <MenuGroup>
            <MenuGroupLabel>Sort active threads</MenuGroupLabel>
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
        </MenuPopup>
      </Menu>
    </>
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
