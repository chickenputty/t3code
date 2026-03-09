import type { SidebarThreadSort } from "../sidebarThreadSort";
import { findLatestProposedPlan, isLatestTurnSettled } from "../session-logic";
import type { PendingThreadRunPhase } from "../threadRunStateStore";
import { resolveLatestThreadContextMessage, resolveThreadContextMessage } from "../threadContext";
import type { Thread } from "../types";

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Preparing"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

export interface SortSidebarThreadsOptions {
  readonly sortBy: SidebarThreadSort;
  readonly hasPendingApprovalsByThreadId: ReadonlyMap<Thread["id"], boolean>;
  readonly hasPendingUserInputByThreadId: ReadonlyMap<Thread["id"], boolean>;
}

type ThreadStatusInput = {
  readonly interactionMode: Thread["interactionMode"];
  readonly latestTurn: Thread["latestTurn"];
  readonly lastVisitedAt?: Thread["lastVisitedAt"];
  readonly proposedPlans: ReadonlyArray<Thread["proposedPlans"][number]>;
  readonly session: Thread["session"];
};

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

function buildPlanReadyPill(): ThreadStatusPill {
  return {
    label: "Plan Ready",
    colorClass: "text-violet-600 dark:text-violet-300/90",
    dotClass: "bg-violet-500 dark:bg-violet-300/90",
    pulse: false,
  };
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null) !== null;
  if (hasPlanReadyPrompt) {
    return buildPlanReadyPill();
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export function deriveThreadStatusPill(input: {
  readonly thread: Thread;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly pendingRunPhase?: PendingThreadRunPhase | null;
}): ThreadStatusPill | null {
  const base = resolveThreadStatusPill(input);
  if (base) {
    return base;
  }

  if (input.pendingRunPhase === "preparing-worktree") {
    return {
      label: "Preparing",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (input.pendingRunPhase === "sending-turn") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    input.thread.interactionMode === "plan" &&
    isLatestTurnSettled(input.thread.latestTurn, input.thread.session) &&
    findLatestProposedPlan(
      input.thread.proposedPlans,
      input.thread.latestTurn?.turnId ?? null,
    ) !== null;
  if (hasPlanReadyPrompt) {
    return buildPlanReadyPill();
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
    case "Awaiting Input":
      return 1;
    case "Preparing":
      return 2;
    case "Working":
      return 3;
    case "Connecting":
      return 4;
    case "Plan Ready":
      return 5;
    case "Completed":
      return 6;
    default:
      return 7;
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
