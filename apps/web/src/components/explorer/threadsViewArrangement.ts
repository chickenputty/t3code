/**
 * Fork (chickenputty/t3code): what a Threads view does to the native sidebar
 * list, as plain functions over view rows: which threads its filter keeps,
 * which group a thread falls in for a grouping other than project, and the
 * properties line a row shows.
 */
import type { SavedView } from "@t3tools/contracts";

import type { SidebarProjectGroupRef } from "~/components/sidebar/sidebarArrangement";

import {
  filterViewRows,
  formatViewPropertyValue,
  groupViewRows,
  viewProperty,
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
  if (group === undefined) return { key: NONE_GROUP_KEY, label: "Other" };
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
