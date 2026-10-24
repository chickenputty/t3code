import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  LedgerItemId,
  NodeId,
  NonNegativeInt,
  PositiveInt,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { LedgerItemStatus } from "./ledger.ts";
import { OrchestrationV2RunStatus, OrchestrationV2Subagent } from "./orchestrationV2.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/** Timestamps are ISO strings and durations are whole milliseconds. */
const Ms = NonNegativeInt;
const MaybeIso = Schema.NullOr(IsoDateTime);
const MaybeMs = Schema.NullOr(Ms);

export const TaskTimingRun = Schema.Struct({
  runId: RunId,
  ordinal: PositiveInt,
  status: OrchestrationV2RunStatus,
  instanceId: ProviderInstanceId,
  model: Schema.String,
  /** The message that started the run was written by the server, such as an auto-continue. */
  serverInitiated: Schema.Boolean,
  requestedAt: IsoDateTime,
  startedAt: MaybeIso,
  /** Null while the run is still going. */
  endedAt: MaybeIso,
  /** Started to ended, or to now while it is going; null if it never started. */
  durationMs: MaybeMs,
  /** Requested to started; null if it has not started. */
  queueWaitMs: MaybeMs,
});
export type TaskTimingRun = typeof TaskTimingRun.Type;

export const TaskTimingDelegated = Schema.Struct({
  taskId: NodeId,
  /** The delegate_task role; null when the delegation named none. */
  role: Schema.NullOr(Schema.String),
  instanceId: ProviderInstanceId,
  model: Schema.NullOr(Schema.String),
  childThreadId: Schema.NullOr(ThreadId),
  status: OrchestrationV2Subagent.fields.status,
  requestedAt: IsoDateTime,
  startedAt: MaybeIso,
  endedAt: MaybeIso,
  durationMs: MaybeMs,
  /** Requested to the child's first run starting. */
  waitMs: MaybeMs,
});
export type TaskTimingDelegated = typeof TaskTimingDelegated.Type;

export const TaskTimingVerdict = Schema.Struct({
  outcome: Schema.Literals(["pass", "fail"]),
  at: IsoDateTime,
  /** Since the evidence this verdict judged was written; the judge's turnaround. */
  afterMs: Ms,
});
export type TaskTimingVerdict = typeof TaskTimingVerdict.Type;

export const TaskTimingLedgerItem = Schema.Struct({
  itemId: LedgerItemId,
  title: TrimmedNonEmptyString,
  status: LedgerItemStatus,
  openedAt: IsoDateTime,
  /** First time the item went in progress. */
  startedAt: MaybeIso,
  /** When it last closed or was dropped; null while it is not closed or dropped. */
  closedAt: MaybeIso,
  /** Opened to first in progress; null if never started. */
  waitToStartMs: MaybeMs,
  /** Time spent in progress, summed over every stretch. */
  inProgressMs: Ms,
  /** Opened to closed or dropped; null while unfinished. */
  openToCloseMs: MaybeMs,
  judgeAttempts: Ms,
  verdicts: Schema.Array(TaskTimingVerdict),
});
export type TaskTimingLedgerItem = typeof TaskTimingLedgerItem.Type;

export const TaskTimingStallKind = Schema.Literals([
  "waiting_on_user",
  "pending_request",
  "waiting_on_delegate",
  "idle_between_runs",
  "no_ledger_progress",
]);
export type TaskTimingStallKind = typeof TaskTimingStallKind.Type;

export const TaskTimingStall = Schema.Struct({
  kind: TaskTimingStallKind,
  startedAt: IsoDateTime,
  /** Null while the stall is ongoing. */
  endedAt: MaybeIso,
  durationMs: Ms,
  /** The run this stall is about, or the run that ended it. */
  runId: Schema.optionalKey(RunId),
  /** For a pending request, its kind. */
  detail: Schema.optionalKey(Schema.String),
});
export type TaskTimingStall = typeof TaskTimingStall.Type;

export const TaskTimingDelegatedTotal = Schema.Struct({
  role: Schema.String,
  instanceId: ProviderInstanceId,
  model: Schema.String,
  tasks: Ms,
  totalMs: Ms,
});
export type TaskTimingDelegatedTotal = typeof TaskTimingDelegatedTotal.Type;

export const TaskTimingTotals = Schema.Struct({
  /** First run requested to the last run ending, or to now while one is going. */
  wallMs: Ms,
  /** Sum of run durations. */
  agentMs: Ms,
  /** Sum of run queue waits. */
  queueMs: Ms,
  /** Sum of delegated task durations; tasks overlap, so this can exceed wallMs. */
  delegatedMs: Ms,
  /**
   * Pending requests, idle gaps and waits on delegated tasks, overlaps counted once. It leaves out
   * time spent waiting on the user, so an overnight absence does not swamp it.
   */
  stalledMs: Ms,
  /** Gaps between runs that ended with a message from a person. */
  waitingOnUserMs: Ms,
});
export type TaskTimingTotals = typeof TaskTimingTotals.Type;

export const TaskTiming = Schema.Struct({
  threadId: ThreadId,
  generatedAt: IsoDateTime,
  stallThresholdMs: Ms,
  runs: Schema.Array(TaskTimingRun),
  delegated: Schema.Array(TaskTimingDelegated),
  ledgerItems: Schema.Array(TaskTimingLedgerItem),
  stalls: Schema.Array(TaskTimingStall),
  totals: TaskTimingTotals,
  delegatedBy: Schema.Array(TaskTimingDelegatedTotal),
});
export type TaskTiming = typeof TaskTiming.Type;

/**
 * The record trimmed for agents and the Timing view: counts, then only the slowest runs and
 * delegated tasks, the longest stalls and the slowest ledger items.
 */
export const TaskTimingSummary = Schema.Struct({
  threadId: ThreadId,
  generatedAt: IsoDateTime,
  stallThresholdMs: Ms,
  runCount: Ms,
  delegatedCount: Ms,
  stallCount: Ms,
  totals: TaskTimingTotals,
  delegatedBy: Schema.Array(TaskTimingDelegatedTotal),
  slowestRuns: Schema.Array(TaskTimingRun),
  slowestDelegated: Schema.Array(TaskTimingDelegated),
  longestStalls: Schema.Array(TaskTimingStall),
  ledgerItems: Schema.Array(TaskTimingLedgerItem),
});
export type TaskTimingSummary = typeof TaskTimingSummary.Type;

export const OrchestrationGetTaskTimingInput = Schema.Struct({ threadId: ThreadId });
export type OrchestrationGetTaskTimingInput = typeof OrchestrationGetTaskTimingInput.Type;

export class OrchestrationGetTaskTimingError extends Schema.TaggedError<OrchestrationGetTaskTimingError>()(
  "OrchestrationGetTaskTimingError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
