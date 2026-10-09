import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { resolveThreadLastVisitedAt } from "~/components/Sidebar.logic";
import { resolveSidebarThreadDisplayStatus } from "~/components/sidebar/sidebarArrangement";
import { useArchivedThreadSnapshots } from "~/lib/archivedThreadsState";
import {
  readEnvironmentSupportsSettlement,
  readEnvironmentSupportsSnooze,
  useProjects,
  useThreadShells,
} from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import type { SidebarThreadSummary } from "~/types";
import { useUiStateStore } from "~/uiStateStore";

import type { ViewPullRequestState, ViewRow, ViewSection } from "./viewEngine";

/** A clock that ticks once a minute, for relative times and date filters. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
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

/**
 * Every thread a view can show, as resolved rows. Archived threads are only
 * fetched while `includeArchived` is on, since they arrive on their own feed.
 */
export function useViewRows(includeArchived: boolean): {
  readonly rows: readonly ViewRow[];
  readonly nowMs: number;
  readonly archivedLoading: boolean;
} {
  const nowMs = useMinuteClock();
  const shells = useThreadShells();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const lastVisitedById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const environmentIds = useMemo<readonly EnvironmentId[]>(
    () => (includeArchived ? environments.map((environment) => environment.environmentId) : []),
    [environments, includeArchived],
  );
  const archived = useArchivedThreadSnapshots(environmentIds);

  const rows = useMemo(() => {
    const projectLabels = new Map<string, string>();
    for (const project of projects) {
      projectLabels.set(`${project.environmentId}:${project.id}`, project.title);
    }
    const environmentLabels = new Map(
      environments.map((environment) => [environment.environmentId, environment.label]),
    );
    const now = new Date(nowMs).toISOString();

    const toRow = (thread: SidebarThreadSummary, archivedRow: boolean): ViewRow => {
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
        lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, lastVisitedById[key]),
        wokeAt: threadWokeAt(thread, { now }),
      });
      const pullRequest = pullRequestOf(thread);
      return {
        key,
        ref,
        shell: thread,
        title: thread.title,
        projectKey,
        projectLabel: projectLabels.get(projectKey) ?? "Unknown project",
        section,
        status,
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
        preview: thread.source.latestVisibleMessage?.text ?? null,
      };
    };

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
  }, [archived.snapshots, environments, includeArchived, lastVisitedById, nowMs, projects, shells]);

  return { rows, nowMs, archivedLoading: includeArchived && archived.isLoading };
}
