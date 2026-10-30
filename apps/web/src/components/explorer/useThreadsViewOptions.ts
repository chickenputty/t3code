// Fork: the native sidebar's arrangement, read from the active Threads view.
// Rows are only built while the view filters, groups by non-project, or shows properties.
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { SavedView, SavedViewThreadsSort } from "@t3tools/contracts";
import { useShallow } from "zustand/react/shallow";

import {
  DEFAULT_SIDEBAR_PROJECT_SORT,
  MANUAL_SIDEBAR_THREAD_SORT,
  SIDEBAR_THREAD_SORT_FIELDS,
  type SidebarProjectGroupRef,
  type SidebarThreadSort,
} from "~/components/sidebar/sidebarArrangement";
import type { SidebarThreadSummary } from "~/types";

import { useSidebarViewStore } from "~/components/sidebar/sidebarViewStore";

import { useSavedViews } from "../views/useSavedViews";
import { useThreadCategories } from "../views/useThreadCategories";
import { useViewRows } from "../views/useViewRows";
import {
  BUILT_IN_THREADS_VIEW_ID,
  viewProperty,
  type ViewProperty,
  type ViewPropertyOption,
  type ViewRow,
} from "../views/viewEngine";
import { resolveActiveExplorerView, useExplorerStore } from "./explorerStore";
import {
  threadsFilterKeys,
  threadsGroupRef,
  threadsPropertiesText,
  withLocalArrangement,
} from "./threadsViewArrangement";

/** Starts every non-project group key, so they never collide with project keys. */
const VIEW_GROUP_KEY_PREFIX = "view:";

type ThreadIdentity = Pick<SidebarThreadSummary, "environmentId" | "id">;

function readSort(sort: SavedViewThreadsSort, fallback: SidebarThreadSort): SidebarThreadSort {
  const field = SIDEBAR_THREAD_SORT_FIELDS.find((candidate) => candidate === sort.field);
  return field === undefined ? fallback : { field, reversed: sort.reversed };
}

function keyOf(thread: ThreadIdentity): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

export function useThreadsViewOptions() {
  const { views, canSave, update: updateView, duplicate, remove } = useSavedViews();
  const activeViewId = useExplorerStore((state) => state.activeViewId);
  const setActiveViewId = useExplorerStore((state) => state.setActiveViewId);
  const pruneCollapsedKeys = useSidebarViewStore((state) => state.pruneCollapsedKeys);
  // Where views cannot be saved, the options menu arranges this device's list instead.
  const local = useSidebarViewStore(
    useShallow((state) => ({
      groupByProject: state.groupByProject,
      pinsStayGrouped: state.pinsStayGrouped,
      sort: state.sort,
      projectSort: state.projectSort,
      toggleGroupByProject: state.toggleGroupByProject,
      togglePinsStayGrouped: state.togglePinsStayGrouped,
      setSortField: state.setSortField,
      setSortReversed: state.setSortReversed,
      setProjectSortField: state.setProjectSortField,
      setProjectSortReversed: state.setProjectSortReversed,
    })),
  );
  const resolvedView = ((): SavedView => {
    const active = resolveActiveExplorerView(views, activeViewId);
    // Only a Threads layout arranges this list; anything else reads the built-in one.
    const shown =
      active.layout === "threads"
        ? active
        : resolveActiveExplorerView(views, BUILT_IN_THREADS_VIEW_ID);
    return canSave ? shown : withLocalArrangement(shown, local);
  })();
  // Every saved view edit re-decodes the whole list; an unchanged view keeps its
  // identity, so an edit to another view rebuilds none of the rows below.
  const viewKey = JSON.stringify(resolvedView);
  const view = JSON.parse(viewKey) as SavedView;

  const groupProperty = view.groupBy === null ? undefined : viewProperty(view.groupBy);
  const groupBy = groupProperty?.groupable ? groupProperty.id : null;
  const otherGrouping = groupBy !== null && groupBy !== "project" ? groupBy : null;
  const needsRows =
    view.filter.conditions.length > 0 || otherGrouping !== null || view.properties.length > 0;

  const categories = useThreadCategories();
  const { rows, nowMs } = useViewRows(false, categories, needsRows);
  const rowByKey = new Map(rows.map((row) => [row.key, row] as const));

  const visibleThreadKeys = needsRows ? threadsFilterKeys(rows, view, nowMs) : null;

  const groupRefByKey = (() => {
    if (otherGrouping === null) return null;
    const refs = new Map<string, SidebarProjectGroupRef>();
    // One ref object per group, keyed apart from project keys so collapsing
    // a "Working" group never collapses a project.
    const shared = new Map<string, SidebarProjectGroupRef>();
    for (const row of rows) {
      const ref = threadsGroupRef(row, otherGrouping, nowMs);
      const key = `${VIEW_GROUP_KEY_PREFIX}${otherGrouping}:${ref.key}`;
      let entry = shared.get(key);
      if (entry === undefined) {
        entry = { key, label: ref.label };
        shared.set(key, entry);
      }
      refs.set(row.key, entry);
    }
    return refs;
  })();

  const groupOf =
    groupRefByKey === null
      ? null
      : (thread: ThreadIdentity): SidebarProjectGroupRef | null =>
          groupRefByKey.get(keyOf(thread)) ?? null;

  const propertiesTextByKey = (() => {
    if (view.properties.length === 0) return null;
    const texts = new Map<string, string>();
    for (const row of rows) {
      const text = threadsPropertiesText(row, view.properties, nowMs);
      if (text !== "") texts.set(row.key, text);
    }
    return texts;
  })();

  const propertiesTextOf = (threadKey: string): string | null =>
    propertiesTextByKey?.get(threadKey) ?? null;
  const rowOf = (threadKey: string): ViewRow | undefined => rowByKey.get(threadKey);

  /** Filter values for properties without fixed options, from the rows in hand. */
  const optionsFor = (property: ViewProperty): readonly ViewPropertyOption[] => {
    if (property.options) return property.options;
    const seen = new Map<string, string>();
    for (const row of rows) {
      const value = property.value(row);
      if (value === null || value === "") continue;
      const key = String(value);
      if (!seen.has(key)) seen.set(key, property.display?.(row) ?? key);
    }
    return [...seen]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  };

  const update = (patch: Partial<Omit<SavedView, "id">>) => {
    if (patch.groupBy !== undefined && patch.groupBy !== view.groupBy) {
      // Collapsed groups of the grouping being left would only pile up; project keys stay.
      const kept = `${VIEW_GROUP_KEY_PREFIX}${patch.groupBy}:`;
      pruneCollapsedKeys((key) => !key.startsWith(VIEW_GROUP_KEY_PREFIX) || key.startsWith(kept));
    }
    if (canSave) {
      updateView(view.id, patch);
      return;
    }
    // Only the options menu shows here: project grouping, sorts and pins.
    if (patch.groupBy !== undefined && (patch.groupBy === "project") !== local.groupByProject) {
      local.toggleGroupByProject();
    }
    const threads = patch.threads;
    if (threads === undefined) return;
    if (threads.pinsStayGrouped !== local.pinsStayGrouped) local.togglePinsStayGrouped();
    const sort = readSort(threads.sort, local.sort);
    local.setSortField(sort.field);
    local.setSortReversed(sort.reversed);
    const projectSort = readSort(threads.projectSort, local.projectSort);
    local.setProjectSortField(projectSort.field);
    local.setProjectSortReversed(projectSort.reversed);
  };

  /** Copies the view and shows the copy. */
  const duplicateView = () => {
    const copy = duplicate(view.id);
    if (copy) setActiveViewId(copy.id);
  };

  /** Deletes a copy and falls back to the built-in Threads view; the built-in one stays. */
  const deleteView = () => {
    if (view.id === BUILT_IN_THREADS_VIEW_ID) return;
    remove(view.id);
    setActiveViewId(null);
  };

  const sort = readSort(view.threads.sort, MANUAL_SIDEBAR_THREAD_SORT);
  const projectSort = readSort(view.threads.projectSort, DEFAULT_SIDEBAR_PROJECT_SORT);

  return {
    view,
    /** False where views cannot be saved: only the options menu shows, on this device's list. */
    canSave,
    visibleThreadKeys,
    /** Any grouping: project, or the view's other property through `groupOf`. */
    groupByProject: groupBy !== null,
    /** Null for project grouping (the sidebar's own project groups) and for none. */
    groupOf,
    sort,
    projectSort,
    pinsStayGrouped: view.threads.pinsStayGrouped,
    properties: view.properties,
    rowOf,
    propertiesTextOf,
    optionsFor,
    update,
    duplicateView,
    deleteView,
  };
}

export type ThreadsViewOptions = ReturnType<typeof useThreadsViewOptions>;
