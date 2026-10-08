/**
 * Fork (chickenputty/t3code): the sidebar header's view menu (group by project
 * and its indent, pins stay grouped, project icons and their style, topic emoji,
 * sort, thread row height), and the header row each project group opens with.
 */
import {
  SidebarProjectIconStyle,
  SidebarThreadIndent,
  SidebarThreadRowDensity,
} from "@t3tools/contracts";
import {
  AlarmClockIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  EyeIcon,
  FolderIcon,
  FolderOpenIcon,
  HeadingIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
  TextSearchIcon,
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
  SIDEBAR_PROJECT_ICON_STYLE_LABELS,
  SIDEBAR_THREAD_INDENT_LABELS,
  SIDEBAR_THREAD_ROW_DENSITY_LABELS,
  SIDEBAR_THREAD_SORT_DIRECTION_LABELS,
  SIDEBAR_THREAD_SORT_FIELDS,
  SIDEBAR_THREAD_SORT_LABELS,
  type SidebarThreadSortField,
} from "./sidebarArrangement";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
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
  const pinsStayGrouped = useSidebarViewStore((state) => state.pinsStayGrouped);
  const togglePinsStayGrouped = useSidebarViewStore((state) => state.togglePinsStayGrouped);
  const sort = useSidebarViewStore((state) => state.sort);
  const setSortField = useSidebarViewStore((state) => state.setSortField);
  const setSortReversed = useSidebarViewStore((state) => state.setSortReversed);
  const rowDensity = useClientSettings((settings) => settings.sidebarThreadRowDensity);
  const showEmoji = useClientSettings((settings) => settings.sidebarThreadEmoji);
  const showProjectIcons = useClientSettings((settings) => settings.sidebarProjectIcons);
  const iconStyle = useClientSettings((settings) => settings.sidebarProjectIconStyle);
  const indent = useClientSettings((settings) => settings.sidebarThreadIndent);
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
          checked={pinsStayGrouped}
          // Pins can only stay in a folder the view actually draws.
          disabled={!groupByProject}
          onCheckedChange={(checked) => {
            if (checked !== pinsStayGrouped) togglePinsStayGrouped();
          }}
        >
          Pins stay grouped
        </MenuCheckboxItem>
        <MenuSub>
          {/* Only grouped rows have a project header to sit in from. */}
          <MenuSubTrigger disabled={!groupByProject}>
            Indent
            <MenuSubValue>{SIDEBAR_THREAD_INDENT_LABELS[indent]}</MenuSubValue>
          </MenuSubTrigger>
          <MenuSubPopup className="min-w-36">
            <MenuRadioGroup
              value={indent}
              onValueChange={(value) =>
                updateSettings({ sidebarThreadIndent: value as SidebarThreadIndent })
              }
            >
              {SidebarThreadIndent.literals.map((option) => (
                <MenuRadioItem key={option} value={option}>
                  {SIDEBAR_THREAD_INDENT_LABELS[option]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuCheckboxItem
          variant="switch"
          checked={showProjectIcons}
          onCheckedChange={(checked) => updateSettings({ sidebarProjectIcons: checked })}
        >
          Project icons
        </MenuCheckboxItem>
        <MenuSub>
          <MenuSubTrigger>
            Icon style
            <MenuSubValue>{SIDEBAR_PROJECT_ICON_STYLE_LABELS[iconStyle]}</MenuSubValue>
          </MenuSubTrigger>
          <MenuSubPopup className="min-w-36">
            <MenuRadioGroup
              value={iconStyle}
              onValueChange={(value) =>
                updateSettings({ sidebarProjectIconStyle: value as SidebarProjectIconStyle })
              }
            >
              {SidebarProjectIconStyle.literals.map((option) => (
                <MenuRadioItem key={option} value={option}>
                  {SIDEBAR_PROJECT_ICON_STYLE_LABELS[option]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
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

/** Shown beside the search box while searching: titles only, or titles and messages. */
export function SearchScopeToggle() {
  const titlesOnly = useClientSettings((settings) => settings.sidebarSearchTitlesOnly);
  const updateSettings = useUpdateClientSettings();
  return (
    <SidebarHeaderIconButton
      label={
        titlesOnly
          ? "Searching titles only (click to search messages too)"
          : "Searching titles and messages (click to search titles only)"
      }
      aria-pressed={titlesOnly}
      data-active={titlesOnly}
      onClick={() => updateSettings({ sidebarSearchTitlesOnly: !titlesOnly })}
    >
      {titlesOnly ? <HeadingIcon /> : <TextSearchIcon />}
    </SidebarHeaderIconButton>
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
  icon: "working" | "waiting" | "approval" | "input" | "failed" | "woke" | "done";
}) {
  const className = "size-4 shrink-0";
  switch (props.icon) {
    case "working":
      return <CircleDashedIcon aria-hidden className={className} />;
    case "waiting":
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

/**
 * Opens one project's group in the grouped active list; collapses it on click (Mitchell, PR #1).
 * The icon follows the view settings (a folder in the project's colour that opens and closes,
 * or the project's own icon), the collapse arrow shows beside the name on hover, the count
 * only while collapsed, and the button at the end starts a thread in the project.
 */
export function SidebarProjectGroupHeader(props: {
  label: string;
  count: number;
  collapsed: boolean;
  /** "folder" draws an open or closed folder; "project" draws `projectIcon`. */
  iconStyle: "folder" | "project" | "none";
  /** Text colour classes for the folder, from the project's icon colour. */
  folderClassName?: string | undefined;
  projectIcon?: ReactNode;
  onToggle: () => void;
  onNewThread?: (() => void) | undefined;
}) {
  const Folder = props.collapsed ? FolderIcon : FolderOpenIcon;
  return (
    <li
      className="group/project-header mx-0.5 mt-1 flex list-none items-center first:mt-0"
      data-testid="sidebar-project-group-header"
    >
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={!props.collapsed}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-sidebar-foreground/90 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        {props.iconStyle === "folder" ? (
          <Folder
            aria-hidden
            className={cn(
              "size-4 shrink-0",
              props.folderClassName ?? "text-sidebar-muted-foreground",
            )}
          />
        ) : props.iconStyle === "project" ? (
          <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
            {props.projectIcon}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{props.label}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-sidebar-muted-foreground opacity-0 transition-[opacity,transform] group-focus-within/project-header:opacity-100 group-hover/project-header:opacity-100",
            props.collapsed && "-rotate-90",
          )}
        />
        <span className="flex-1" />
        {props.collapsed ? (
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground/70">
            {props.count}
          </span>
        ) : null}
      </button>
      {props.onNewThread ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`New thread in ${props.label}`}
                onClick={props.onNewThread}
                className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
              />
            }
          >
            <SquarePenIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">New thread in {props.label}</TooltipPopup>
        </Tooltip>
      ) : null}
    </li>
  );
}
