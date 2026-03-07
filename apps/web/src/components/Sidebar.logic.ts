import type { Thread } from "../types";

export interface ThreadStatusPill {
  label: "Working" | "Connecting" | "Completed" | "Pending Approval" | "Paused";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
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
