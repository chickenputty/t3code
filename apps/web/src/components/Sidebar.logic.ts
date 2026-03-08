import type { SidebarThreadSort } from "../sidebarThreadSort";
import { resolveLatestThreadContextMessage, resolveThreadContextMessage } from "../threadContext";
import type { Thread } from "../types";

export interface ThreadStatusPill {
  label: "Working" | "Connecting" | "Completed" | "Pending Approval" | "Paused";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

export interface SortSidebarThreadsOptions {
  readonly sortBy: SidebarThreadSort;
  readonly hasPendingApprovalsByThreadId: ReadonlyMap<Thread["id"], boolean>;
  readonly hasPendingUserInputByThreadId: ReadonlyMap<Thread["id"], boolean>;
}

type ThreadStatusSource = {
  readonly session: Pick<NonNullable<Thread["session"]>, "status"> | null;
  readonly latestTurn: Pick<NonNullable<Thread["latestTurn"]>, "completedAt"> | null;
  readonly lastVisitedAt?: string | undefined;
};

export function hasUnseenCompletion(
  thread: Pick<ThreadStatusSource, "latestTurn" | "lastVisitedAt">,
): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function deriveThreadStatusPill(input: {
  readonly thread: ThreadStatusSource;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
}): ThreadStatusPill | null {
  if (input.hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (input.hasPendingUserInput) {
    return {
      label: "Paused",
      colorClass: "text-yellow-700 dark:text-yellow-300/90",
      dotClass: "bg-yellow-500 dark:bg-yellow-300/90",
      pulse: false,
    };
  }

  if (input.thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (input.thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (hasUnseenCompletion(input.thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

function parseIsoMs(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

export function getThreadLatestActivityAt(thread: Thread): string {
  let latestMs = parseIsoMs(thread.createdAt);
  let latestIso = thread.createdAt;

  const updateLatest = (candidate: string | null | undefined) => {
    const candidateMs = parseIsoMs(candidate);
    if (candidateMs <= latestMs) return;
    latestMs = candidateMs;
    latestIso = candidate!;
  };

  updateLatest(thread.session?.updatedAt);
  updateLatest(thread.latestTurn?.requestedAt);
  updateLatest(thread.latestTurn?.startedAt);
  updateLatest(thread.latestTurn?.completedAt);

  for (const message of thread.messages) {
    updateLatest(message.completedAt);
    updateLatest(message.createdAt);
  }
  for (const proposedPlan of thread.proposedPlans) {
    updateLatest(proposedPlan.updatedAt);
    updateLatest(proposedPlan.createdAt);
  }
  for (const activity of thread.activities) {
    updateLatest(activity.createdAt);
  }

  return latestIso;
}

function getThreadStatusRank(input: {
  readonly thread: Thread;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
}): number {
  const pill = deriveThreadStatusPill(input);
  switch (pill?.label) {
    case "Pending Approval":
      return 0;
    case "Paused":
      return 1;
    case "Working":
      return 2;
    case "Connecting":
      return 3;
    case "Completed":
      return 4;
    default:
      return 5;
  }
}

function compareNames(left: Thread, right: Thread): number {
  return left.title.localeCompare(right.title, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function normalizeSidebarSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function matchesNormalizedSidebarSearch(thread: Thread, normalizedQuery: string): boolean {
  const originalContextMessage = resolveThreadContextMessage(thread.messages);
  const latestContextMessage = resolveLatestThreadContextMessage(thread.messages);
  const searchableFields = [
    thread.title,
    originalContextMessage?.text ?? "",
    latestContextMessage?.text ?? "",
  ];

  return searchableFields.some((field) =>
    normalizeSidebarSearchText(field).includes(normalizedQuery),
  );
}

export function threadMatchesSidebarSearch(thread: Thread, query: string): boolean {
  const normalizedQuery = normalizeSidebarSearchText(query);
  if (normalizedQuery.length === 0) {
    return true;
  }

  return matchesNormalizedSidebarSearch(thread, normalizedQuery);
}

export function filterSidebarThreads(threads: readonly Thread[], query: string): Thread[] {
  const normalizedQuery = normalizeSidebarSearchText(query);
  if (normalizedQuery.length === 0) {
    return [...threads];
  }

  return threads.filter((thread) => matchesNormalizedSidebarSearch(thread, normalizedQuery));
}

export function sortSidebarThreads(
  threads: readonly Thread[],
  options: SortSidebarThreadsOptions,
): Thread[] {
  const entries = threads.map((thread) => ({
    thread,
    createdAtMs: parseIsoMs(thread.createdAt),
    latestActivityAtMs: parseIsoMs(getThreadLatestActivityAt(thread)),
    statusRank: getThreadStatusRank({
      thread,
      hasPendingApprovals: options.hasPendingApprovalsByThreadId.get(thread.id) === true,
      hasPendingUserInput: options.hasPendingUserInputByThreadId.get(thread.id) === true,
    }),
  }));

  entries.sort((left, right) => {
    if (options.sortBy === "name") {
      const byName = compareNames(left.thread, right.thread);
      if (byName !== 0) return byName;
      const byActivity = right.latestActivityAtMs - left.latestActivityAtMs;
      if (byActivity !== 0) return byActivity;
      return left.thread.id.localeCompare(right.thread.id);
    }

    if (options.sortBy === "status") {
      const byStatus = left.statusRank - right.statusRank;
      if (byStatus !== 0) return byStatus;
      const byActivity = right.latestActivityAtMs - left.latestActivityAtMs;
      if (byActivity !== 0) return byActivity;
      const byName = compareNames(left.thread, right.thread);
      if (byName !== 0) return byName;
      return left.thread.id.localeCompare(right.thread.id);
    }

    if (options.sortBy === "created") {
      const byCreatedAt = right.createdAtMs - left.createdAtMs;
      if (byCreatedAt !== 0) return byCreatedAt;
      const byName = compareNames(left.thread, right.thread);
      if (byName !== 0) return byName;
      return left.thread.id.localeCompare(right.thread.id);
    }

    const byActivity = right.latestActivityAtMs - left.latestActivityAtMs;
    if (byActivity !== 0) return byActivity;
    const byCreatedAt = right.createdAtMs - left.createdAtMs;
    if (byCreatedAt !== 0) return byCreatedAt;
    const byName = compareNames(left.thread, right.thread);
    if (byName !== 0) return byName;
    return left.thread.id.localeCompare(right.thread.id);
  });

  return entries.map((entry) => entry.thread);
}
