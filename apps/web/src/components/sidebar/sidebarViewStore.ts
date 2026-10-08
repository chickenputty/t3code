/**
 * Fork (chickenputty/t3code): how this device arranges the sidebar's active
 * list. Kept per device like the project scope, and in its own storage key so
 * upstream's UI state schema never has to know about it.
 */
import { create } from "zustand";

import {
  MANUAL_SIDEBAR_THREAD_SORT,
  SIDEBAR_THREAD_SORT_FIELDS,
  type SidebarThreadSort,
  type SidebarThreadSortField,
} from "./sidebarArrangement";

const STORAGE_KEY = "t3code:fork:sidebar-view:v1";

interface PersistedSidebarView {
  readonly groupByProject: boolean;
  /** Keep pins in their project group, on top, instead of above the folders. */
  readonly pinsStayGrouped: boolean;
  readonly sort: SidebarThreadSort;
  readonly collapsedProjectKeys: readonly string[];
}

interface SidebarViewState extends PersistedSidebarView {
  readonly toggleGroupByProject: () => void;
  readonly togglePinsStayGrouped: () => void;
  /** Picking a field starts it in its natural order; picking it again keeps the order. */
  readonly setSortField: (field: SidebarThreadSortField) => void;
  readonly setSortReversed: (reversed: boolean) => void;
  readonly toggleProjectCollapsed: (projectKey: string) => void;
}

const DEFAULT_VIEW: PersistedSidebarView = {
  groupByProject: false,
  pinsStayGrouped: false,
  sort: MANUAL_SIDEBAR_THREAD_SORT,
  collapsedProjectKeys: [],
};

function readPersistedView(): PersistedSidebarView {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_VIEW;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_VIEW;
    const value = parsed as Record<string, unknown>;
    const sort = value.sort as Record<string, unknown> | null | undefined;
    const field = SIDEBAR_THREAD_SORT_FIELDS.find((candidate) => candidate === sort?.field);
    return {
      groupByProject: value.groupByProject === true,
      pinsStayGrouped: value.pinsStayGrouped === true,
      sort:
        field === undefined
          ? MANUAL_SIDEBAR_THREAD_SORT
          : { field, reversed: sort?.reversed === true },
      collapsedProjectKeys: Array.isArray(value.collapsedProjectKeys)
        ? value.collapsedProjectKeys.filter((key): key is string => typeof key === "string")
        : [],
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export const useSidebarViewStore = create<SidebarViewState>((set) => ({
  ...readPersistedView(),
  toggleGroupByProject: () => set((state) => ({ groupByProject: !state.groupByProject })),
  togglePinsStayGrouped: () => set((state) => ({ pinsStayGrouped: !state.pinsStayGrouped })),
  setSortField: (field) =>
    set((state) => (state.sort.field === field ? state : { sort: { field, reversed: false } })),
  setSortReversed: (reversed) =>
    set((state) =>
      state.sort.field === "manual" || state.sort.reversed === reversed
        ? state
        : { sort: { field: state.sort.field, reversed } },
    ),
  toggleProjectCollapsed: (projectKey) =>
    set((state) => ({
      collapsedProjectKeys: state.collapsedProjectKeys.includes(projectKey)
        ? state.collapsedProjectKeys.filter((key) => key !== projectKey)
        : [...state.collapsedProjectKeys, projectKey],
    })),
}));

useSidebarViewStore.subscribe((state) => {
  if (typeof window === "undefined") return;
  const persisted: PersistedSidebarView = {
    groupByProject: state.groupByProject,
    pinsStayGrouped: state.pinsStayGrouped,
    sort: state.sort,
    collapsedProjectKeys: state.collapsedProjectKeys,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Storage can be full or disabled; the view still works for this session.
  }
});
