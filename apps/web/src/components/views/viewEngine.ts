/**
 * Fork (chickenputty/t3code): the pure half of saved thread views.
 *
 * A view row is a thread shell with every property a view can filter, sort,
 * group or show already resolved, so the layouts never re-derive status or
 * section per render. Everything here is plain data in, plain data out.
 */
import type {
  SavedView,
  SavedViewFilterCondition,
  SavedViewLayout,
  SavedViewSort,
  ScopedThreadRef,
} from "@t3tools/contracts";

import type { SidebarThreadDisplayStatus } from "~/components/sidebar/sidebarArrangement";
import type { SidebarThreadSummary } from "~/types";

export type ViewSection = "pinned" | "active" | "snoozed" | "settled" | "archived";
export type ViewPullRequestState = "none" | "open" | "draft" | "merged" | "closed";

export interface ViewRow {
  readonly key: string;
  readonly ref: ScopedThreadRef;
  readonly shell: SidebarThreadSummary;
  readonly title: string;
  readonly projectKey: string;
  readonly projectLabel: string;
  readonly section: ViewSection;
  readonly status: SidebarThreadDisplayStatus;
  readonly model: string;
  readonly provider: string;
  readonly branch: string | null;
  readonly worktree: string | null;
  readonly pullRequest: ViewPullRequestState;
  readonly pullRequestNumber: number | null;
  readonly unread: boolean;
  readonly pinned: boolean;
  readonly createdMs: number;
  readonly activityMs: number;
  readonly messages: number;
  readonly environment: string;
  /** The latest visible message, the cheapest preview the shell carries. */
  readonly preview: string | null;
}

export type ViewPropertyType = "text" | "enum" | "boolean" | "number" | "date";

export interface ViewPropertyOption {
  readonly value: string;
  readonly label: string;
}

export interface ViewProperty {
  readonly id: string;
  readonly label: string;
  readonly type: ViewPropertyType;
  readonly groupable: boolean;
  /** Fixed options in display order; enum properties without them derive options from the rows. */
  readonly options?: readonly ViewPropertyOption[];
  readonly value: (row: ViewRow) => string | number | boolean | null;
  /** Display label for a raw value (enum values, group keys). */
  readonly display?: (row: ViewRow) => string;
}

export const VIEW_SECTION_OPTIONS: readonly ViewPropertyOption[] = [
  { value: "pinned", label: "Pinned" },
  { value: "active", label: "Active" },
  { value: "snoozed", label: "Snoozed" },
  { value: "settled", label: "Settled" },
  { value: "archived", label: "Archived" },
];

export const VIEW_STATUS_OPTIONS: readonly ViewPropertyOption[] = [
  { value: "approval", label: "Needs approval" },
  { value: "input", label: "Needs input" },
  { value: "failed", label: "Failed" },
  { value: "limited", label: "Usage limited" },
  { value: "woke", label: "Woke" },
  { value: "done", label: "Done (unread)" },
  { value: "working", label: "Working" },
  { value: "waiting", label: "Waiting" },
  { value: "idle", label: "Idle" },
];

const PULL_REQUEST_OPTIONS: readonly ViewPropertyOption[] = [
  { value: "open", label: "Open" },
  { value: "draft", label: "Draft" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "none", label: "No pull request" },
];

const BOOLEAN_OPTIONS: readonly ViewPropertyOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

function optionLabel(options: readonly ViewPropertyOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export const VIEW_PROPERTIES: readonly ViewProperty[] = [
  { id: "title", label: "Title", type: "text", groupable: false, value: (row) => row.title },
  {
    id: "project",
    label: "Project",
    type: "enum",
    groupable: true,
    value: (row) => row.projectKey,
    display: (row) => row.projectLabel,
  },
  {
    id: "section",
    label: "Section",
    type: "enum",
    groupable: true,
    options: VIEW_SECTION_OPTIONS,
    value: (row) => row.section,
  },
  {
    id: "status",
    label: "Status",
    type: "enum",
    groupable: true,
    options: VIEW_STATUS_OPTIONS,
    value: (row) => row.status,
  },
  { id: "model", label: "Model", type: "enum", groupable: true, value: (row) => row.model },
  {
    id: "provider",
    label: "Provider",
    type: "enum",
    groupable: true,
    value: (row) => row.provider,
  },
  { id: "branch", label: "Branch", type: "text", groupable: true, value: (row) => row.branch },
  {
    id: "worktree",
    label: "Worktree",
    type: "text",
    groupable: false,
    value: (row) => row.worktree,
  },
  {
    id: "pullRequest",
    label: "Pull request",
    type: "enum",
    groupable: true,
    options: PULL_REQUEST_OPTIONS,
    value: (row) => row.pullRequest,
    display: (row) =>
      row.pullRequestNumber === null
        ? optionLabel(PULL_REQUEST_OPTIONS, row.pullRequest)
        : `#${row.pullRequestNumber} ${optionLabel(PULL_REQUEST_OPTIONS, row.pullRequest).toLowerCase()}`,
  },
  {
    id: "unread",
    label: "Unread",
    type: "boolean",
    groupable: true,
    options: BOOLEAN_OPTIONS,
    value: (row) => row.unread,
  },
  {
    id: "pinned",
    label: "Pinned",
    type: "boolean",
    groupable: true,
    options: BOOLEAN_OPTIONS,
    value: (row) => row.pinned,
  },
  { id: "created", label: "Created", type: "date", groupable: true, value: (row) => row.createdMs },
  {
    id: "activity",
    label: "Last activity",
    type: "date",
    groupable: true,
    value: (row) => row.activityMs,
  },
  {
    id: "messages",
    label: "Messages",
    type: "number",
    groupable: false,
    value: (row) => row.messages,
  },
  {
    id: "environment",
    label: "Environment",
    type: "enum",
    groupable: true,
    value: (row) => row.environment,
  },
];

const PROPERTY_BY_ID = new Map(VIEW_PROPERTIES.map((property) => [property.id, property]));

export function viewProperty(id: string): ViewProperty | undefined {
  return PROPERTY_BY_ID.get(id);
}

/** The text a property shows for a row on a card, list row or table cell. */
export function formatViewPropertyValue(
  property: ViewProperty,
  row: ViewRow,
  nowMs: number,
): string {
  if (property.display) return property.display(row);
  const value = property.value(row);
  if (value === null || value === "") return "";
  switch (property.type) {
    case "boolean":
      return value === true ? "Yes" : "No";
    case "date":
      return formatRelativeMs(value as number, nowMs);
    case "enum":
      return property.options ? optionLabel(property.options, String(value)) : String(value);
    default:
      return String(value);
  }
}

export function formatRelativeMs(ms: number, nowMs: number): string {
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round((nowMs - ms) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Filters ────────────────────────────────────────────────────────────────

export interface ViewOperator {
  readonly id: string;
  readonly label: string;
  /** What the value editor collects. */
  readonly input: "text" | "options" | "boolean" | "days" | "number" | "none";
}

export const VIEW_OPERATORS: Record<ViewPropertyType, readonly ViewOperator[]> = {
  text: [
    { id: "contains", label: "contains", input: "text" },
    { id: "not_contains", label: "does not contain", input: "text" },
    { id: "is", label: "is", input: "text" },
    { id: "is_empty", label: "is empty", input: "none" },
    { id: "is_not_empty", label: "is not empty", input: "none" },
  ],
  enum: [
    { id: "any_of", label: "is any of", input: "options" },
    { id: "none_of", label: "is none of", input: "options" },
  ],
  boolean: [{ id: "is", label: "is", input: "boolean" }],
  number: [
    { id: "gt", label: "more than", input: "number" },
    { id: "lt", label: "less than", input: "number" },
  ],
  date: [
    { id: "within_days", label: "within the last (days)", input: "days" },
    { id: "older_than_days", label: "older than (days)", input: "days" },
  ],
};

export function viewOperator(property: ViewProperty, operatorId: string): ViewOperator | undefined {
  return VIEW_OPERATORS[property.type].find((operator) => operator.id === operatorId);
}

const DAY_MS = 86_400_000;

function matchesCondition(
  row: ViewRow,
  condition: SavedViewFilterCondition,
  nowMs: number,
): boolean {
  const property = viewProperty(condition.property);
  // An unknown property (a newer client's) or operator never hides a row.
  if (!property || !viewOperator(property, condition.operator)) return true;
  const value = property.value(row);
  const target = condition.value;
  switch (condition.operator) {
    case "contains":
    case "not_contains": {
      const needle = String(target).trim().toLowerCase();
      if (needle === "") return true;
      const found = String(value ?? "")
        .toLowerCase()
        .includes(needle);
      return condition.operator === "contains" ? found : !found;
    }
    case "is":
      return property.type === "boolean"
        ? value === (target === true || target === "true")
        : String(value ?? "").toLowerCase() === String(target).trim().toLowerCase();
    case "is_empty":
      return value === null || value === "";
    case "is_not_empty":
      return value !== null && value !== "";
    case "any_of":
    case "none_of": {
      const values = Array.isArray(target) ? target : [String(target)];
      if (values.length === 0) return true;
      const found = values.includes(String(value));
      return condition.operator === "any_of" ? found : !found;
    }
    case "gt":
      return typeof value === "number" && value > Number(target);
    case "lt":
      return typeof value === "number" && value < Number(target);
    case "within_days":
      return typeof value === "number" && nowMs - value <= Number(target) * DAY_MS;
    case "older_than_days":
      return typeof value === "number" && nowMs - value > Number(target) * DAY_MS;
    default:
      return true;
  }
}

/** Applies the view's visibility toggles, then its conditions. */
export function filterViewRows(
  rows: readonly ViewRow[],
  view: Pick<SavedView, "filter" | "showArchived" | "showSettled">,
  nowMs: number,
): readonly ViewRow[] {
  const { conjunction, conditions } = view.filter;
  return rows.filter((row) => {
    if (!view.showArchived && row.section === "archived") return false;
    if (!view.showSettled && row.section === "settled") return false;
    if (conditions.length === 0) return true;
    return conjunction === "or"
      ? conditions.some((condition) => matchesCondition(row, condition, nowMs))
      : conditions.every((condition) => matchesCondition(row, condition, nowMs));
  });
}

// ── Sorting ────────────────────────────────────────────────────────────────

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function rankOf(property: ViewProperty, value: string): number {
  const index = property.options?.findIndex((option) => option.value === value) ?? -1;
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Ascending comparison of two rows on one property; empty values sort last either way. */
function compareOn(property: ViewProperty, left: ViewRow, right: ViewRow): number {
  const a = property.value(left);
  const b = property.value(right);
  const aEmpty = a === null || a === "";
  const bEmpty = b === null || b === "";
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  switch (property.type) {
    case "number":
    case "date":
      return (a as number) - (b as number);
    case "boolean":
      return a === b ? 0 : a === true ? -1 : 1;
    case "enum":
      if (property.options) return rankOf(property, String(a)) - rankOf(property, String(b));
      return collator.compare(
        property.display?.(left) ?? String(a),
        property.display?.(right) ?? String(b),
      );
    default:
      return collator.compare(String(a), String(b));
  }
}

/** Multi-key sort. Ties fall to latest activity, then the incoming order. */
export function sortViewRows(
  rows: readonly ViewRow[],
  sorts: readonly SavedViewSort[],
): readonly ViewRow[] {
  const keys = sorts.flatMap((sort) => {
    const property = viewProperty(sort.property);
    return property ? [{ property, direction: sort.direction === "desc" ? -1 : 1 }] : [];
  });
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      for (const { property, direction } of keys) {
        const a = property.value(left.row);
        const b = property.value(right.row);
        const emptyA = a === null || a === "";
        const emptyB = b === null || b === "";
        // Empty stays last in both directions.
        if (emptyA || emptyB) {
          if (emptyA !== emptyB) return emptyA ? 1 : -1;
          continue;
        }
        const result = compareOn(property, left.row, right.row);
        if (result !== 0) return result * direction;
      }
      if (left.row.activityMs !== right.row.activityMs) {
        return right.row.activityMs > left.row.activityMs ? 1 : -1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

// ── Grouping ───────────────────────────────────────────────────────────────

export interface ViewGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly ViewRow[];
}

const DATE_BUCKETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Last 7 days" },
  { key: "month", label: "Last 30 days" },
  { key: "older", label: "Older" },
] as const;

export function dateBucket(ms: number, nowMs: number): (typeof DATE_BUCKETS)[number]["key"] {
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  if (ms >= today) return "today";
  if (ms >= today - DAY_MS) return "yesterday";
  if (ms >= today - 6 * DAY_MS) return "week";
  if (ms >= today - 29 * DAY_MS) return "month";
  return "older";
}

function groupKeyOf(
  property: ViewProperty,
  row: ViewRow,
  nowMs: number,
): { key: string; label: string } {
  const value = property.value(row);
  if (property.type === "date") {
    const key = dateBucket(value as number, nowMs);
    return { key, label: DATE_BUCKETS.find((bucket) => bucket.key === key)!.label };
  }
  if (value === null || value === "")
    return { key: "", label: `No ${property.label.toLowerCase()}` };
  const key = String(value);
  if (property.display) {
    // A PR group is its state, not each number.
    if (property.id === "pullRequest")
      return { key, label: optionLabel(PULL_REQUEST_OPTIONS, key) };
    return { key, label: property.display(row) };
  }
  return { key, label: property.options ? optionLabel(property.options, key) : key };
}

/**
 * Splits sorted rows into groups, keeping each group's rows in sort order.
 * Groups with fixed options (section, status, dates) keep that order and can
 * show empty; derived groups (project, model) follow their first row.
 */
export function groupViewRows(
  rows: readonly ViewRow[],
  groupBy: string | null,
  options: { readonly hideEmpty: boolean; readonly nowMs: number; readonly showArchived?: boolean },
): readonly ViewGroup[] {
  const property = groupBy === null ? undefined : viewProperty(groupBy);
  if (!property || !property.groupable) return [{ key: "all", label: "All", rows }];
  const groups = new Map<string, { label: string; rows: ViewRow[] }>();
  const fixed =
    property.type === "date"
      ? DATE_BUCKETS.map((bucket) => ({ value: bucket.key, label: bucket.label }))
      : property.options?.filter(
          (option) =>
            property.id !== "section" || option.value !== "archived" || options.showArchived,
        );
  for (const option of fixed ?? []) groups.set(option.value, { label: option.label, rows: [] });
  for (const row of rows) {
    const { key, label } = groupKeyOf(property, row, options.nowMs);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { label, rows: [row] });
  }
  const result: ViewGroup[] = [];
  for (const [key, group] of groups) {
    if (options.hideEmpty && group.rows.length === 0) continue;
    result.push({ key, label: group.label, rows: group.rows });
  }
  return result;
}

// ── View records ───────────────────────────────────────────────────────────

export const DEFAULT_VIEW_PROPERTIES = ["project", "status", "model", "activity"] as const;

export const VIEW_LAYOUT_LABELS: Record<SavedViewLayout, string> = {
  list: "List",
  board: "Board",
  gallery: "Gallery",
  table: "Table",
};

export function newSavedView(layout: SavedViewLayout, id: string, name?: string): SavedView {
  return {
    id,
    name: name ?? VIEW_LAYOUT_LABELS[layout],
    layout,
    filter: { conjunction: "and", conditions: [] },
    sorts: [{ property: "activity", direction: "desc" }],
    groupBy: layout === "board" ? "project" : null,
    properties:
      layout === "table"
        ? ["project", "status", "model", "branch", "pullRequest", "messages", "created", "activity"]
        : [...DEFAULT_VIEW_PROPERTIES],
    cardSize: "medium",
    preview: "last",
    density: "comfortable",
    showArchived: false,
    showSettled: true,
    hideEmptyGroups: true,
    openMode: "peek",
  };
}

/** Shown until the user edits a view, when the whole list is first written. */
export const DEFAULT_SAVED_VIEWS: readonly SavedView[] = [
  newSavedView("list", "default-list", "Recent"),
  newSavedView("board", "default-board", "By project"),
  newSavedView("gallery", "default-gallery", "Gallery"),
  newSavedView("table", "default-table", "Table"),
];

export function newSavedViewId(): string {
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Groupings whose columns a card can be dragged between. */
export function isEditableGrouping(groupBy: string | null): boolean {
  return groupBy === "section";
}
