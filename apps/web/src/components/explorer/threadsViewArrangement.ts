/**
 * Fork (chickenputty/t3code): what a Threads view does to the native sidebar
 * list, as plain functions over view rows: which threads its filter keeps,
 * which group a thread falls in for a grouping other than project, and the
 * properties line a row shows.
 */
import type { SavedView } from "@t3tools/contracts";

import type {
  SidebarProjectGroupRef,
  SidebarThreadSort,
  SidebarThreadSortField,
} from "~/components/sidebar/sidebarArrangement";

import {
  filterViewRows,
  formatViewPropertyValue,
  groupViewRows,
  synthesizeThreadsView,
  viewProperty,
  type LocalThreadsArrangement,
  type ViewRow,
} from "../views/viewEngine";

/**
 * The keys of the rows the view's conditions keep, or null when it has none.
 * Archived, settled and sub-agent rows are never hidden here: the sidebar's
 * own sections decide those.
 */
export function threadsFilterKeys(
  rows: readonly ViewRow[],
  view: Pick<SavedView, "filter">,
  nowMs: number,
): ReadonlySet<string> | null {
  if (view.filter.conditions.length === 0) return null;
  const kept = filterViewRows(
    rows,
    { filter: view.filter, showArchived: true, showSettled: true, showSubagents: true },
    nowMs,
  );
  return new Set(kept.map((row) => row.key));
}

const NONE_GROUP_KEY = "none";

/** The group a row falls in when a Threads view groups by `groupBy` (not project). */
export function threadsGroupRef(
  row: ViewRow,
  groupBy: string,
  nowMs: number,
): SidebarProjectGroupRef {
  if (groupBy === "category") {
    return row.category === null || row.categoryLabel === null
      ? { key: NONE_GROUP_KEY, label: "No category" }
      : { key: row.category, label: row.categoryLabel };
  }
  // One row, so the only non-empty group is the row's own.
  const group = groupViewRows([row], groupBy, { hideEmpty: true, nowMs }).find(
    (candidate) => candidate.rows.length > 0,
  );
  if (group === undefined) {
    const label = viewProperty(groupBy)?.label.toLowerCase() ?? "group";
    return { key: NONE_GROUP_KEY, label: `No ${label}` };
  }
  return { key: group.key === "" ? NONE_GROUP_KEY : group.key, label: group.label };
}

/** The row's shown properties, empty values left out, as one short line. */
export function threadsPropertiesText(
  row: ViewRow,
  properties: readonly string[],
  nowMs: number,
): string {
  const values: string[] = [];
  for (const id of properties) {
    const property = viewProperty(id);
    if (!property) continue;
    const value = formatViewPropertyValue(property, row, nowMs);
    if (value !== "") values.push(value);
  }
  return values.join(" · ");
}

/**
 * The view as this device arranges it, for a connection that cannot save
 * views: project grouping, sorts and pins come from the device's own sidebar
 * arrangement, which is what its options menu writes there. Another grouping
 * the view brings stays while project grouping is off.
 */
export function withLocalArrangement(view: SavedView, local: LocalThreadsArrangement): SavedView {
  const synthesized = synthesizeThreadsView(local);
  return {
    ...view,
    groupBy: local.groupByProject ? "project" : view.groupBy === "project" ? null : view.groupBy,
    threads: synthesized.threads,
  };
}

/** A short line for the view's toolbar row: its filter count and grouping, or null. */
export function threadsViewSummary(view: Pick<SavedView, "filter" | "groupBy">): string | null {
  const parts: string[] = [];
  const filters = view.filter.conditions.length;
  if (filters > 0) parts.push(filters === 1 ? "1 filter" : `${filters} filters`);
  const group = view.groupBy === null ? undefined : viewProperty(view.groupBy);
  if (group?.groupable) parts.push(`By ${group.label.toLowerCase()}`);
  return parts.length === 0 ? null : parts.join(", ");
}

/** One row of the native list's Sort popover: which of the view's two sorts it writes. */
export interface ThreadsSortRow {
  readonly key: "sort" | "projectSort";
  readonly label: string;
  /** Shown in place of the direction while the row's sort is manual. */
  readonly manualHint: string | null;
}

/**
 * The Sort popover's rows: threads always, then the groups' own order while the
 * list is grouped ("Projects" for project grouping, "Groups" for any other).
 */
export function threadsSortRows(grouping: "project" | "other" | null): readonly ThreadsSortRow[] {
  const threads: ThreadsSortRow = {
    key: "sort",
    label: "Threads",
    manualHint: "Drag threads to arrange them.",
  };
  if (grouping === null) return [threads];
  return [
    threads,
    grouping === "project"
      ? {
          key: "projectSort",
          label: "Projects",
          manualHint: "Follows the project order in Settings.",
        }
      : // Other groups have no order of their own: they follow their first thread.
        { key: "projectSort", label: "Groups", manualHint: null },
  ];
}

/** Picking a field starts it in its natural order; picking it again keeps the order. */
export function withSortField(
  sort: SidebarThreadSort,
  field: SidebarThreadSortField,
): SidebarThreadSort {
  return sort.field === field ? sort : { field, reversed: false };
}

/** Manual has no direction, and an unchanged direction writes nothing. */
export function withSortReversed(
  sort: SidebarThreadSort,
  reversed: boolean,
): SidebarThreadSort | null {
  return sort.field === "manual" || sort.reversed === reversed
    ? null
    : { field: sort.field, reversed };
}
