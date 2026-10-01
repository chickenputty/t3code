/**
 * Fork (chickenputty/t3code): sort and group the sidebar's active list.
 *
 * Only the active list is arranged. Pins keep their drag order, the snoozed
 * shelf its wake order and the settled shelf its settle order. Manual order
 * without grouping hands the list back untouched, so upstream's drag order
 * stays the source of truth whenever the view is off.
 */
import type { SidebarThreadRowDensity } from "@t3tools/contracts";

import { hasUnseenCompletion, resolveSidebarThreadStatus } from "~/components/Sidebar.logic";
import { parseTimestampDate } from "~/timestampFormat";
import type { SidebarThreadSummary } from "~/types";

export const SIDEBAR_THREAD_ROW_DENSITY_LABELS: Record<SidebarThreadRowDensity, string> = {
  comfortable: "Comfortable",
  compact: "Compact",
  slim: "Slim",
};

export const SIDEBAR_THREAD_SORT_FIELDS = [
  "manual",
  "activity",
  "status",
  "name",
  "created",
] as const;
export type SidebarThreadSortField = (typeof SIDEBAR_THREAD_SORT_FIELDS)[number];

export interface SidebarThreadSort {
  readonly field: SidebarThreadSortField;
  /** Flips the field's natural order (newest first, needs you first, A to Z). */
  readonly reversed: boolean;
}

export const MANUAL_SIDEBAR_THREAD_SORT: SidebarThreadSort = { field: "manual", reversed: false };

export const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortField, string> = {
  manual: "Manual",
  activity: "Latest activity",
  status: "Status",
  name: "Name",
  created: "Created",
};

/** The natural order first, then its reverse. Manual has no direction. */
export const SIDEBAR_THREAD_SORT_DIRECTION_LABELS: Record<
  Exclude<SidebarThreadSortField, "manual">,
  readonly [natural: string, reversed: string]
> = {
  activity: ["Newest first", "Oldest first"],
  status: ["Needs you first", "Needs you last"],
  name: ["A to Z", "Z to A"],
  created: ["Newest first", "Oldest first"],
};

/** What a row shows at its status slot, in the order a status sort lists them. */
export type SidebarThreadDisplayStatus =
  | "approval"
  | "input"
  | "failed"
  | "woke"
  | "done"
  | "working"
  | "monitoring"
  | "idle";

const DISPLAY_STATUS_RANK: Record<SidebarThreadDisplayStatus, number> = {
  approval: 0,
  input: 1,
  failed: 2,
  woke: 3,
  done: 4,
  working: 5,
  monitoring: 6,
  idle: 7,
};

type DisplayStatusThread = Parameters<typeof resolveSidebarThreadStatus>[0] &
  Omit<Parameters<typeof hasUnseenCompletion>[0], "lastVisitedAt"> &
  Pick<SidebarThreadSummary, "settledOverride">;

/**
 * The status a sidebar row shows, as SidebarThreadRow resolves it: live states
 * first, then an unacknowledged wake, then an unseen completion.
 */
export function resolveSidebarThreadDisplayStatus(
  thread: DisplayStatusThread,
  context: { readonly lastVisitedAt: string | undefined; readonly wokeAt: string | null },
): SidebarThreadDisplayStatus {
  const status = resolveSidebarThreadStatus(thread);
  if (status !== "ready") return status;
  const wokeAt = context.wokeAt === null ? null : parseTimestampDate(context.wokeAt);
  if (wokeAt !== null && thread.settledOverride !== "settled") {
    const visitedAt =
      context.lastVisitedAt === undefined ? null : parseTimestampDate(context.lastVisitedAt);
    if (visitedAt === null || visitedAt < wokeAt) return "woke";
  }
  if (hasUnseenCompletion({ ...thread, lastVisitedAt: context.lastVisitedAt })) return "done";
  return "idle";
}

type ActivityThread = Pick<
  SidebarThreadSummary,
  "createdAt" | "latestUserMessageAt" | "latestTurn"
>;

/**
 * Latest activity: a message from the user or a turn starting or finishing.
 * `updatedAt` is left out on purpose: renames, pins and settles bump it too.
 */
function sidebarThreadLatestActivityMs(thread: ActivityThread): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const value of [
    thread.latestUserMessageAt,
    thread.latestTurn?.requestedAt,
    thread.latestTurn?.startedAt,
    thread.latestTurn?.completedAt,
  ]) {
    if (value == null) continue;
    const ms = Date.parse(value);
    if (!Number.isNaN(ms) && ms > latest) latest = ms;
  }
  return latest === Number.NEGATIVE_INFINITY ? timestampMs(thread.createdAt) : latest;
}

function timestampMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

type SortableThread = ActivityThread & Pick<SidebarThreadSummary, "title">;

/**
 * Orders threads by `sort`. Ties fall back to latest activity, newest first,
 * then to the incoming order, so equal rows never trade places between renders.
 */
export function sortSidebarThreads<T extends SortableThread>(
  threads: readonly T[],
  sort: SidebarThreadSort,
  statusOf: (thread: T) => SidebarThreadDisplayStatus,
): readonly T[] {
  if (sort.field === "manual") return threads;
  const direction = sort.reversed ? -1 : 1;
  const keyed = threads.map((thread) => ({
    thread,
    activity: sidebarThreadLatestActivityMs(thread),
    status: sort.field === "status" ? DISPLAY_STATUS_RANK[statusOf(thread)] : 0,
  }));
  keyed.sort((left, right) => {
    let primary = 0;
    switch (sort.field) {
      case "activity":
        primary = right.activity - left.activity;
        break;
      case "status":
        primary = left.status - right.status;
        break;
      case "name":
        primary = nameCollator.compare(left.thread.title, right.thread.title);
        break;
      case "created":
        primary = timestampMs(right.thread.createdAt) - timestampMs(left.thread.createdAt);
        break;
    }
    if (primary !== 0) return primary * direction;
    return right.activity - left.activity;
  });
  return keyed.map((entry) => entry.thread);
}

export interface SidebarProjectGroupRef {
  readonly key: string;
  readonly label: string;
}

export interface SidebarActiveThreadGroup<T> {
  readonly key: string;
  readonly label: string;
  /** Every thread in the group, collapsed or not, so a header can count them. */
  readonly threads: readonly T[];
  readonly collapsed: boolean;
}

export interface SidebarActiveArrangement<T> {
  /** The rows to render, in display order; a collapsed group contributes none. */
  readonly threads: readonly T[];
  /** Null when the list is not grouped. */
  readonly groups: readonly SidebarActiveThreadGroup<T>[] | null;
}

const UNKNOWN_PROJECT_GROUP: SidebarProjectGroupRef = { key: "", label: "Other" };

export function arrangeSidebarActiveThreads<T extends SortableThread>(
  threads: readonly T[],
  options: {
    readonly sort: SidebarThreadSort;
    readonly groupByProject: boolean;
    readonly statusOf: (thread: T) => SidebarThreadDisplayStatus;
    readonly groupOf: (thread: T) => SidebarProjectGroupRef | null;
    readonly collapsedGroupKeys: ReadonlySet<string>;
  },
): SidebarActiveArrangement<T> {
  const sorted = sortSidebarThreads(threads, options.sort, options.statusOf);
  if (!options.groupByProject) return { threads: sorted, groups: null };

  const byKey = new Map<string, { ref: SidebarProjectGroupRef; threads: T[] }>();
  for (const thread of sorted) {
    const ref = options.groupOf(thread) ?? UNKNOWN_PROJECT_GROUP;
    const entry = byKey.get(ref.key);
    if (entry === undefined) byKey.set(ref.key, { ref, threads: [thread] });
    else entry.threads.push(thread);
  }
  const groups = [...byKey.values()]
    .toSorted((left, right) => {
      // Threads whose project is not loaded yet trail the named groups.
      if (left.ref === UNKNOWN_PROJECT_GROUP) return 1;
      if (right.ref === UNKNOWN_PROJECT_GROUP) return -1;
      return (
        nameCollator.compare(left.ref.label, right.ref.label) ||
        left.ref.key.localeCompare(right.ref.key)
      );
    })
    .map((entry): SidebarActiveThreadGroup<T> => ({
      key: entry.ref.key,
      label: entry.ref.label,
      threads: entry.threads,
      collapsed: options.collapsedGroupKeys.has(entry.ref.key),
    }));
  return {
    threads: groups.flatMap((group) => (group.collapsed ? [] : group.threads)),
    groups,
  };
}
