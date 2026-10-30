// Fork: the Threads view's control row, view options menu and project group header.
// Grouping, sorts and pins write the active Threads view, or this device's arrangement where views can't be saved.
import {
  SidebarProjectIconStyle,
  SidebarProjectRowDensity,
  SidebarThreadIndent,
  SidebarThreadRowDensity,
} from "@t3tools/contracts";
import {
  AlarmClockIcon,
  ArrowDownUpIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  EyeIcon,
  FolderIcon,
  FolderOpenIcon,
  HeadingIcon,
  MessageCircleQuestionIcon,
  Rows3Icon,
  ShieldQuestionIcon,
  SquarePenIcon,
  TextSearchIcon,
  UserRoundIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import {
  SIDEBAR_PROJECT_ICON_STYLE_LABELS,
  SIDEBAR_PROJECT_ROW_DENSITY_LABELS,
  SIDEBAR_THREAD_INDENT_LABELS,
  SIDEBAR_THREAD_ROW_DENSITY_LABELS,
  SIDEBAR_THREAD_SORT_DIRECTION_LABELS,
  SIDEBAR_THREAD_SORT_FIELDS,
  SIDEBAR_THREAD_SORT_LABELS,
  type SidebarThreadSort,
  type SidebarThreadSortField,
} from "./sidebarArrangement";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { ThreadsViewOptions } from "~/components/explorer/useThreadsViewOptions";
import { ThreadsViewSettings } from "~/components/explorer/ThreadsViewSettings";
import {
  FilterControl,
  GroupControl,
  MiniSelect,
  PropertiesControl,
  ToolbarTrigger,
} from "~/components/views/ViewToolbar";
import {
  threadsSortRows,
  threadsViewSummary,
  withSortField,
  withSortReversed,
  type ThreadsSortRow,
} from "~/components/explorer/threadsViewArrangement";

/** A submenu's current choice, right-aligned before its chevron. */
function MenuSubValue(props: { children: ReactNode }) {
  return (
    <span className="flex-1 ps-4 text-end text-muted-foreground text-xs">{props.children}</span>
  );
}

/**
 * The Threads view's row under the search row: its summary on the left, then
 * filter, sort, group, properties, view options and the view's settings. Where
 * views cannot be saved only the view options show.
 */
export function SidebarViewToolbar(props: { options: ThreadsViewOptions }) {
  const { view, update, optionsFor, canSave } = props.options;
  const summary = threadsViewSummary(view);
  return (
    <div className="flex h-6 items-center gap-0.5 ps-2">
      <span className="min-w-0 flex-1 truncate text-2xs text-sidebar-muted-foreground">
        {summary}
      </span>
      {canSave ? (
        <>
          <FilterControl view={view} update={update} optionsFor={optionsFor} compact />
          <ThreadsSortControl options={props.options} />
          <GroupControl view={view} update={update} compact />
          <PropertiesControl view={view} update={update} compact />
        </>
      ) : null}
      <SidebarViewControls options={props.options} />
      {canSave ? <ThreadsViewSettings options={props.options} /> : null}
    </div>
  );
}

const SORT_FIELD_OPTIONS = SIDEBAR_THREAD_SORT_FIELDS.map((field) => ({
  value: field,
  label: SIDEBAR_THREAD_SORT_LABELS[field],
}));

/**
 * The native list's Sort popover: one row for threads and, while grouped, one
 * for the groups. Each picks a field, then its direction (manual has none).
 */
function ThreadsSortControl(props: { options: ThreadsViewOptions }) {
  const { view, update, sort, projectSort } = props.options;
  const grouped = props.options.groupByProject;
  const rows = threadsSortRows(grouped ? (view.groupBy === "project" ? "project" : "other") : null);
  const current = (key: ThreadsSortRow["key"]) => (key === "sort" ? sort : projectSort);
  const write = (key: ThreadsSortRow["key"], next: SidebarThreadSort) =>
    update({ threads: { ...view.threads, [key]: next } });
  // Lit while an order the list draws is not the manual one.
  const sorted = sort.field !== "manual" || (grouped && projectSort.field !== "manual");
  return (
    <Popover>
      <ToolbarTrigger
        compact
        label="Sort"
        trigger={
          <PopoverTrigger
            render={
              <Button
                variant={sorted ? "secondary" : "ghost-muted"}
                size="icon-xs"
                aria-label="Sort"
              />
            }
          />
        }
      >
        <ArrowDownUpIcon />
      </ToolbarTrigger>
      <PopoverPopup align="end" className="w-[min(24rem,calc(100vw-2rem))]">
        <div className="flex flex-col gap-2 py-1">
          {rows.map((row) => {
            const rowSort = current(row.key);
            const directions =
              rowSort.field === "manual"
                ? null
                : SIDEBAR_THREAD_SORT_DIRECTION_LABELS[rowSort.field];
            return (
              <div key={row.key} className="flex items-center gap-1.5">
                <span className="w-16 shrink-0 text-muted-foreground text-xs">{row.label}</span>
                <MiniSelect
                  label={`${row.label} sort`}
                  value={rowSort.field}
                  options={SORT_FIELD_OPTIONS}
                  onChange={(field) =>
                    write(row.key, withSortField(rowSort, field as SidebarThreadSortField))
                  }
                  className="w-36"
                />
                {directions === null ? (
                  row.manualHint === null ? null : (
                    <span className="min-w-0 text-muted-foreground text-xs">{row.manualHint}</span>
                  )
                ) : (
                  <MiniSelect
                    label={`${row.label} direction`}
                    value={rowSort.reversed ? "reversed" : "natural"}
                    options={[
                      { value: "natural", label: directions[0] },
                      { value: "reversed", label: directions[1] },
                    ]}
                    onChange={(value) => {
                      const next = withSortReversed(rowSort, value === "reversed");
                      if (next) write(row.key, next);
                    }}
                    className="w-32"
                  />
                )}
              </div>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** The view row's options menu: pins and row settings; grouping and sorts have their own controls. */
function SidebarViewControls(props: { options: ThreadsViewOptions }) {
  const { view, update, pinsStayGrouped } = props.options;
  return (
    <SidebarViewOptionsMenu
      // Any grouping draws headers.
      grouped={props.options.groupByProject}
      pinsStayGrouped={pinsStayGrouped}
      onPinsStayGroupedChange={(checked) =>
        update({ threads: { ...view.threads, pinsStayGrouped: checked } })
      }
    />
  );
}

function SidebarViewOptionsMenu(props: {
  grouped: boolean;
  pinsStayGrouped: boolean;
  onPinsStayGroupedChange: (checked: boolean) => void;
}) {
  const { grouped, pinsStayGrouped } = props;
  const rowDensity = useClientSettings((settings) => settings.sidebarThreadRowDensity);
  const projectRowDensity = useClientSettings((settings) => settings.sidebarProjectRowDensity);
  const showEmoji = useClientSettings((settings) => settings.sidebarThreadEmoji);
  const showProjectIcons = useClientSettings((settings) => settings.sidebarProjectIcons);
  const iconStyle = useClientSettings((settings) => settings.sidebarProjectIconStyle);
  const indent = useClientSettings((settings) => settings.sidebarThreadIndent);

  return (
    <Menu>
      <ToolbarTrigger
        compact
        label="View options"
        trigger={
          <MenuTrigger
            render={<Button variant="ghost-muted" size="icon-xs" aria-label="View options" />}
          />
        }
      >
        <Rows3Icon />
      </ToolbarTrigger>
      <MenuPopup align="end" side="bottom" className="min-w-56">
        <MenuCheckboxItem
          variant="switch"
          checked={pinsStayGrouped}
          // Pins can only stay in a folder the view actually draws.
          disabled={!grouped}
          onCheckedChange={(checked) => {
            if (checked !== pinsStayGrouped) props.onPinsStayGroupedChange(checked);
          }}
        >
          Pins stay grouped
        </MenuCheckboxItem>
        <MenuSub>
          {/* Only grouped rows have a header to sit in from. */}
          <MenuSubTrigger disabled={!grouped}>
            Indent
            <MenuSubValue>{SIDEBAR_THREAD_INDENT_LABELS[indent]}</MenuSubValue>
          </MenuSubTrigger>
          <MenuSubPopup className="min-w-36">
            <MenuRadioGroup
              value={indent}
              onValueChange={(value) =>
                updateClientSettings({ sidebarThreadIndent: value as SidebarThreadIndent })
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
        <MenuSub>
          {/* Only grouped lists draw group headers. */}
          <MenuSubTrigger disabled={!grouped}>
            Project rows
            <MenuSubValue>{SIDEBAR_PROJECT_ROW_DENSITY_LABELS[projectRowDensity]}</MenuSubValue>
          </MenuSubTrigger>
          <MenuSubPopup className="min-w-40">
            <MenuRadioGroup
              value={projectRowDensity}
              onValueChange={(value) =>
                updateClientSettings({
                  sidebarProjectRowDensity: value as SidebarProjectRowDensity,
                })
              }
            >
              {SidebarProjectRowDensity.literals.map((density) => (
                <MenuRadioItem key={density} value={density}>
                  {SIDEBAR_PROJECT_ROW_DENSITY_LABELS[density]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
        <MenuSeparator />
        <MenuSub>
          <MenuSubTrigger>
            Thread rows
            <MenuSubValue>{SIDEBAR_THREAD_ROW_DENSITY_LABELS[rowDensity]}</MenuSubValue>
          </MenuSubTrigger>
          <MenuSubPopup className="min-w-40">
            <MenuRadioGroup
              value={rowDensity}
              onValueChange={(value) =>
                updateClientSettings({ sidebarThreadRowDensity: value as SidebarThreadRowDensity })
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
        <MenuCheckboxItem
          variant="switch"
          checked={showEmoji}
          onCheckedChange={(checked) => updateClientSettings({ sidebarThreadEmoji: checked })}
        >
          Topic emoji
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuCheckboxItem
          variant="switch"
          checked={showProjectIcons}
          onCheckedChange={(checked) => updateClientSettings({ sidebarProjectIcons: checked })}
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
                updateClientSettings({ sidebarProjectIconStyle: value as SidebarProjectIconStyle })
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
      </MenuPopup>
    </Menu>
  );
}

/** Shown beside the search box while searching: titles only, or titles and messages. */
export function SearchScopeToggle() {
  const titlesOnly = useClientSettings((settings) => settings.sidebarSearchTitlesOnly);
  return (
    <SidebarHeaderIconButton
      label={
        titlesOnly
          ? "Searching titles only (click to search messages too)"
          : "Searching titles and messages (click to search titles only)"
      }
      aria-pressed={titlesOnly}
      data-active={titlesOnly}
      onClick={() => updateClientSettings({ sidebarSearchTitlesOnly: !titlesOnly })}
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
  icon: "working" | "waiting" | "approval" | "input" | "request" | "failed" | "woke" | "done";
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
    case "request":
      return <UserRoundIcon aria-hidden className={className} />;
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
  density: SidebarProjectRowDensity;
  /** The first group's header: no divider or top margin above it. */
  first: boolean;
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
      className={cn(
        "group/project-header mx-0.5 flex list-none items-center",
        // Comfortable draws a divider above every project but the first. Drop
        // markers and pins share the list, so CSS first-child cannot tell.
        props.first
          ? null
          : props.density === "comfortable"
            ? "mt-2 border-t border-sidebar-border pt-2"
            : props.density === "compact"
              ? "mt-1"
              : "mt-0.5",
      )}
      data-testid="sidebar-project-group-header"
    >
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={!props.collapsed}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left font-medium text-sidebar-foreground/90 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          props.density === "comfortable"
            ? "h-9 text-sm"
            : props.density === "compact"
              ? "h-8 text-sm"
              : "h-6 text-xs",
        )}
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
