import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentId, ScopedThreadRef, ThreadCategories } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { resolveThreadLastVisitedAt } from "~/components/Sidebar.logic";
import { resolveSidebarThreadDisplayStatus } from "~/components/sidebar/sidebarArrangement";
import { useArchivedThreadSnapshots } from "~/lib/archivedThreadsState";
import {
  readEnvironmentSupportsSettlement,
  readEnvironmentSupportsSnooze,
  useProjects,
  useThreadShell,
  useThreadShells,
} from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import type { SidebarThreadSummary } from "~/types";
import { useUiStateStore } from "~/uiStateStore";

import { stageOfStatus } from "./viewEngine";
import type { ViewPullRequestState, ViewRow, ViewSection } from "./viewEngine";

const NO_ROWS: readonly ViewRow[] = [];

/** A clock that ticks once a minute, for relative times and date filters. */
export function useMinuteClock(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the minute interval timer while enabled
  useEffect(() => {
    if (!enabled) return;
    // Catch up on time that passed while paused (a no-op on first mount).
    // oxlint-disable-next-line react/set-state-in-effect -- resuming the timer catches up on paused time
    setNow((previous) => (Date.now() - previous >= 60_000 ? Date.now() : previous));
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

function activityMs(thread: SidebarThreadSummary): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const value of [
    thread.latestUserMessageAt,
    thread.latestRun?.requestedAt,
    thread.latestRun?.startedAt,
    thread.latestRun?.completedAt,
  ]) {
    if (value == null) continue;
    const ms = Date.parse(value);
    if (!Number.isNaN(ms) && ms > latest) latest = ms;
  }
  return latest === Number.NEGATIVE_INFINITY ? Date.parse(thread.createdAt) : latest;
}

function pullRequestOf(thread: SidebarThreadSummary): {
  state: ViewPullRequestState;
  number: number | null;
} {
  const links = thread.pullRequests.filter((link) => link.source !== "stack-dismissed");
  const preferred =
    links.find((link) => link.number === thread.linkedPullRequest?.number) ??
    links.find((link) => link.snapshot?.state === "open") ??
    links[0];
  if (!preferred) {
    const fallback = thread.linkedPullRequest ?? thread.branchPullRequest ?? null;
    return fallback ? { state: "open", number: fallback.number } : { state: "none", number: null };
  }
  const snapshot = preferred.snapshot;
  const state: ViewPullRequestState =
    snapshot === null
      ? "open"
      : snapshot.state === "open" && snapshot.isDraft
        ? "draft"
        : snapshot.state === "merged"
          ? "merged"
          : snapshot.state === "closed"
            ? "closed"
            : "open";
  return { state, number: preferred.number };
}

function projectLabelsOf(
  projects: ReadonlyArray<{ environmentId: string; id: string; title: string }>,
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const project of projects) {
    labels.set(`${project.environmentId}:${project.id}`, project.title);
  }
  return labels;
}

/** Builds view rows; one builder serves every thread of one render. */
function makeRowBuilder({
  projectLabels,
  environments,
  nowMs,
  categories,
  lastVisitedAt,
}: {
  projectLabels: ReadonlyMap<string, string>;
  environments: ReadonlyArray<{ environmentId: EnvironmentId; label: string }>;
  nowMs: number;
  categories: Pick<ThreadCategories, "categories" | "assignments">;
  lastVisitedAt: (key: string) => string | undefined;
}): (thread: SidebarThreadSummary, archivedRow: boolean) => ViewRow {
  const environmentLabels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const now = new Date(nowMs).toISOString();
  const categoryNames = new Map(
    categories.categories.map((category) => [category.id, category.name]),
  );

  return (thread: SidebarThreadSummary, archivedRow: boolean): ViewRow => {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    const key = scopedThreadKey(ref);
    const projectKey = `${thread.environmentId}:${thread.projectId}`;
    const pinned = thread.pinnedAt != null;
    let section: ViewSection;
    if (archivedRow || thread.archivedAt !== null) section = "archived";
    else if (
      readEnvironmentSupportsSnooze(thread.environmentId) &&
      effectiveSnoozed(thread, { now })
    )
      section = "snoozed";
    else if (
      readEnvironmentSupportsSettlement(thread.environmentId) &&
      thread.settledOverride === "settled"
    )
      section = "settled";
    else if (pinned) section = "pinned";
    else section = "active";
    const status = resolveSidebarThreadDisplayStatus(thread, {
      lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, lastVisitedAt(key)),
      wokeAt: threadWokeAt(thread, { now }),
    });
    const pullRequest = pullRequestOf(thread);
    // An assignment to a deleted category reads as none.
    const assigned = categories.assignments[key];
    const categoryLabel = assigned === undefined ? undefined : categoryNames.get(assigned);
    return {
      key,
      ref,
      shell: thread,
      title: thread.title,
      projectKey,
      projectLabel: projectLabels.get(projectKey) ?? "Unknown project",
      section,
      status,
      stage: stageOfStatus(status),
      category: assigned !== undefined && categoryLabel !== undefined ? assigned : null,
      categoryLabel: categoryLabel ?? null,
      kind:
        thread.lineage.relationshipToParent === "subagent"
          ? "subagent"
          : thread.lineage.relationshipToParent === "fork"
            ? "fork"
            : "chat",
      model: thread.modelSelection.model,
      provider: thread.providerInstanceId,
      branch: thread.branch,
      worktree: thread.worktreePath,
      pullRequest: pullRequest.state,
      pullRequestNumber: pullRequest.number,
      unread: status === "done" || status === "woke",
      pinned,
      createdMs: Date.parse(thread.createdAt),
      activityMs: activityMs(thread),
      messages: thread.visibleItemCount,
      environment: environmentLabels.get(thread.environmentId) ?? thread.environmentId,
    };
  };
}

/**
 * Every thread a view can show, as resolved rows. Archived threads are only
 * fetched while `includeArchived` is on, since they arrive on their own feed.
 * With `enabled` off it builds nothing and skips the clock and the visit
 * subscription, so a caller that needs rows only sometimes costs nothing else.
 */
export function useViewRows(
  includeArchived: boolean,
  categories: Pick<ThreadCategories, "categories" | "assignments">,
  enabled = true,
): {
  readonly rows: readonly ViewRow[];
  readonly nowMs: number;
  readonly archivedLoading: boolean;
} {
  const nowMs = useMinuteClock(enabled);
  const shells = useThreadShells();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const lastVisitedById = useUiStateStore((state) =>
    enabled ? state.threadLastVisitedAtById : null,
  );
  const environmentIds = includeArchived
    ? environments.map((environment) => environment.environmentId)
    : [];
  const archived = useArchivedThreadSnapshots(environmentIds);

  const rows = ((): readonly ViewRow[] => {
    if (!enabled || lastVisitedById === null) return NO_ROWS;
    const projectLabels = projectLabelsOf(projects);
    const toRow = makeRowBuilder({
      projectLabels,
      environments,
      nowMs,
      categories: { categories: categories.categories, assignments: categories.assignments },
      lastVisitedAt: (key) => lastVisitedById[key],
    });

    const result: ViewRow[] = [];
    const seen = new Set<string>();
    for (const thread of shells) {
      if (thread.deletedAt !== null) continue;
      const row = toRow(thread, false);
      seen.add(row.key);
      result.push(row);
    }
    if (includeArchived) {
      for (const entry of archived.snapshots) {
        for (const project of entry.snapshot.projects) {
          const projectKey = `${entry.environmentId}:${project.id}`;
          if (!projectLabels.has(projectKey)) projectLabels.set(projectKey, project.title);
        }
        for (const source of entry.snapshot.threads) {
          const thread = presentThreadShell(entry.environmentId, source);
          if (thread.deletedAt !== null) continue;
          const row = toRow(thread, true);
          if (seen.has(row.key)) continue;
          seen.add(row.key);
          result.push(row);
        }
      }
    }
    return result;
  })();

  return { rows, nowMs, archivedLoading: includeArchived && archived.isLoading };
}

const NO_ENVIRONMENTS: readonly EnvironmentId[] = [];

/**
 * One thread's view row, built the same way as `useViewRows` builds every
 * row. A thread missing from the live shells (archived) is looked up in its
 * own environment's archived feed only.
 */
export function useViewRow(
  ref: ScopedThreadRef,
  categories: Pick<ThreadCategories, "categories" | "assignments">,
): {
  readonly row: ViewRow | null;
  readonly nowMs: number;
  readonly archivedLoading: boolean;
} {
  const nowMs = useMinuteClock();
  const shell = useThreadShell(ref);
  const projects = useProjects();
  const { environments } = useEnvironments();
  const key = scopedThreadKey(ref);
  const lastVisited = useUiStateStore((state) => state.threadLastVisitedAtById[key]);
  const live = shell !== null;
  const archivedEnvironmentIds = live ? NO_ENVIRONMENTS : [ref.environmentId];
  const archived = useArchivedThreadSnapshots(archivedEnvironmentIds);

  const row = ((): ViewRow | null => {
    const projectLabels = projectLabelsOf(projects);
    let thread: SidebarThreadSummary | null = shell?.deletedAt === null ? shell : null;
    let archivedRow = false;
    if (shell === null) {
      for (const entry of archived.snapshots) {
        if (entry.environmentId !== ref.environmentId) continue;
        const source = entry.snapshot.threads.find((candidate) => candidate.id === ref.threadId);
        if (source === undefined) continue;
        const presented = presentThreadShell(entry.environmentId, source);
        if (presented.deletedAt !== null) continue;
        for (const project of entry.snapshot.projects) {
          const projectKey = `${entry.environmentId}:${project.id}`;
          if (!projectLabels.has(projectKey)) projectLabels.set(projectKey, project.title);
        }
        thread = presented;
        archivedRow = true;
      }
    }
    if (thread === null) return null;
    return makeRowBuilder({
      projectLabels,
      environments,
      nowMs,
      categories: { categories: categories.categories, assignments: categories.assignments },
      lastVisitedAt: () => lastVisited,
    })(thread, archivedRow);
  })();

  return { row, nowMs, archivedLoading: !live && archived.isLoading };
}
