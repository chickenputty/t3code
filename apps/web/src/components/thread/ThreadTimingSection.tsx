/** Fork (chickenputty/t3code): where a thread's time went, shown at the top of its Activity tab. */
import type { ScopedThreadRef, TaskTimingStallKind, TaskTimingSummary } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatDuration } from "~/components/views/inspectorModel";
import { formatRelativeMs } from "~/components/views/viewEngine";
import { useServerConfigs } from "~/state/entities";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";

import { Stat } from "./ThreadUsageTab";

const STALL_LABEL: Record<TaskTimingStallKind, string> = {
  waiting_on_user: "Waiting on you",
  pending_request: "Pending request",
  waiting_on_delegate: "Waiting on a delegated task",
  idle_between_runs: "Idle between turns",
  no_ledger_progress: "Turn with no ledger progress",
};

const duration = (ms: number | null) => (ms === null ? "-" : formatDuration(ms));

function TimingBody({ timing, nowMs }: { timing: TaskTimingSummary; nowMs: number }) {
  const { totals } = timing;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Wall time" value={duration(totals.wallMs)} />
        <Stat label="Agent time" value={duration(totals.agentMs)} />
        <Stat label="Queued" value={duration(totals.queueMs)} />
        <Stat label="Delegated" value={duration(totals.delegatedMs)} />
        <Stat label="Stalled" value={duration(totals.stalledMs)} />
        <Stat label="Waiting on you" value={duration(totals.waitingOnUserMs)} />
      </div>
      {timing.delegatedBy.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Tasks</TableHead>
              <TableHead className="text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {timing.delegatedBy.map((row) => (
              <TableRow key={`${row.role}:${row.instanceId}:${row.model}`}>
                <TableCell>{row.role}</TableCell>
                <TableCell>
                  <span className="text-muted-foreground">{row.model}</span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="tabular-nums">{row.tasks}</span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="tabular-nums">{duration(row.totalMs)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {timing.slowestRuns.length + timing.slowestDelegated.length > 0 ? (
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium">Slowest steps</span>
          {timing.slowestRuns.map((run) => (
            <span key={run.runId} className="text-muted-foreground">
              Turn {run.ordinal} on {run.model}: {duration(run.durationMs)}
            </span>
          ))}
          {timing.slowestDelegated.map((task) => (
            <span key={task.taskId} className="text-muted-foreground">
              {task.role ?? "general"} task on {task.model ?? "unknown"}:{" "}
              {duration(task.durationMs)}
              {task.waitMs ? `, waited ${duration(task.waitMs)}` : ""}
            </span>
          ))}
        </div>
      ) : null}
      {timing.longestStalls.length > 0 ? (
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium">
            Longest stalls
            {timing.stallCount > timing.longestStalls.length
              ? ` (${timing.stallCount} in all)`
              : ""}
          </span>
          {timing.longestStalls.map((stall) => (
            <span key={`${stall.kind}:${stall.startedAt}`} className="text-muted-foreground">
              {STALL_LABEL[stall.kind]}
              {stall.detail ? ` (${stall.detail})` : ""}: {duration(stall.durationMs)},{" "}
              {formatRelativeMs(Date.parse(stall.startedAt), nowMs)} ago
              {stall.endedAt === null ? ", still going" : ""}
            </span>
          ))}
        </div>
      ) : null}
      {timing.ledgerItems.length > 0 ? (
        <div className="flex flex-col gap-0.5 text-xs">
          <span className="font-medium">Ledger items</span>
          {timing.ledgerItems.map((item) => (
            <span key={item.itemId} className="truncate text-muted-foreground">
              {item.itemId} {item.status.replace("_", " ")}: started after{" "}
              {duration(item.waitToStartMs)}, {duration(item.inProgressMs)} in progress
              {item.judgeAttempts > 0 ? `, ${item.judgeAttempts} judge attempts` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Reads the server's timing summary. A server that cannot answer shows nothing, and the summary
 * is fetched again when the thread's latest turn changes rather than on a timer.
 */
export function ThreadTimingSection({
  threadRef,
  activityKey,
  nowMs,
}: {
  threadRef: ScopedThreadRef;
  /** Changes when a turn finishes. */
  activityKey: string;
  nowMs: number;
}) {
  const serverConfigs = useServerConfigs();
  const supported =
    serverConfigs.get(threadRef.environmentId)?.environment.capabilities.taskTiming === true;
  const atom = supported
    ? orchestrationEnvironment.taskTiming({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      })
    : null;
  const { data, error, refresh } = useEnvironmentQuery(atom);
  const seenKey = useRef(activityKey);
  useEffect(() => {
    if (seenKey.current === activityKey) return;
    seenKey.current = activityKey;
    refresh();
  }, [activityKey, refresh]);

  if (!supported) return null;
  return (
    <section className="mb-4 flex flex-col gap-2">
      <h3 className="font-medium text-sm">Timing</h3>
      {data !== null ? (
        <TimingBody timing={data} nowMs={nowMs} />
      ) : error !== null ? (
        <p className="text-muted-foreground text-xs">Timing is unavailable: {error}</p>
      ) : (
        <p className="text-muted-foreground text-xs">Loading timing…</p>
      )}
    </section>
  );
}
