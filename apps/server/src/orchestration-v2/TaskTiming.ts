import type {
  Ledger,
  LedgerId,
  LedgerItem,
  OrchestrationV2ConversationMessage,
  OrchestrationV2Run,
  OrchestrationV2RuntimeRequest,
  OrchestrationV2Subagent,
  TaskTiming,
  TaskTimingDelegated,
  TaskTimingDelegatedTotal,
  TaskTimingLedgerItem,
  TaskTimingRun,
  TaskTimingStall,
  TaskTimingSummary,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const DEFAULT_STALL_THRESHOLD_MS = 60_000;
const SUMMARY_LEDGER_ITEMS = 20;

export interface TaskTimingInput {
  readonly threadId: ThreadId;
  /** Where unfinished runs, tasks and requests are measured up to. */
  readonly now: DateTime.Utc;
  readonly stallThresholdMs?: number;
  readonly runs: ReadonlyArray<
    Pick<
      OrchestrationV2Run,
      | "id"
      | "ordinal"
      | "status"
      | "providerInstanceId"
      | "modelSelection"
      | "userMessageId"
      | "requestedAt"
      | "startedAt"
      | "completedAt"
      | "workStartedAt"
    >
  >;
  readonly userMessages: ReadonlyArray<
    Pick<OrchestrationV2ConversationMessage, "id" | "creationSource">
  >;
  /** App-owned delegated tasks with the first run of each one's child thread. */
  readonly delegated: ReadonlyArray<{
    readonly task: Pick<
      OrchestrationV2Subagent,
      | "id"
      | "childThreadId"
      | "role"
      | "providerInstanceId"
      | "model"
      | "status"
      | "startedAt"
      | "completedAt"
    >;
    readonly childRun: Pick<OrchestrationV2Run, "startedAt" | "workStartedAt"> | undefined;
  }>;
  readonly runtimeRequests: ReadonlyArray<
    Pick<OrchestrationV2RuntimeRequest, "id" | "kind" | "status" | "createdAt" | "resolvedAt">
  >;
  readonly ledger: Ledger | undefined;
  /** Every `ledger.item.updated` event of the thread, oldest first. */
  readonly itemUpdates: ReadonlyArray<{
    readonly at: DateTime.Utc;
    readonly ledgerId: LedgerId;
    readonly item: LedgerItem;
  }>;
}

const ms = DateTime.toEpochMillis;
const iso = DateTime.formatIso;
const isoMs = (epochMs: number) => iso(DateTime.makeUnsafe(epochMs));
const between = (from: number, to: number) => Math.max(0, to - from);
const sum = (values: ReadonlyArray<number | null>) =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

// A run that is queued, starting or running has no end yet.
const runIsLive = (status: TaskTimingRun["status"]) =>
  status === "preparing" ||
  status === "queued" ||
  status === "starting" ||
  status === "running" ||
  status === "waiting";

function deriveRuns(input: TaskTimingInput, now: number) {
  const serverMessages = new Set(
    input.userMessages
      .filter((message) => message.creationSource === "server")
      .map((message) => message.id),
  );
  return input.runs
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .map((run): TaskTimingRun => {
      const started = run.workStartedAt ?? run.startedAt;
      const startMs = started === null ? null : ms(started);
      const endMs = run.completedAt === null ? null : ms(run.completedAt);
      return {
        runId: run.id,
        ordinal: run.ordinal,
        status: run.status,
        instanceId: run.providerInstanceId,
        model: run.modelSelection.model,
        serverInitiated: serverMessages.has(run.userMessageId),
        requestedAt: iso(run.requestedAt),
        startedAt: started === null ? null : iso(started),
        endedAt: run.completedAt === null ? null : iso(run.completedAt),
        durationMs:
          startMs === null
            ? null
            : endMs !== null
              ? between(startMs, endMs)
              : runIsLive(run.status)
                ? between(startMs, now)
                : null,
        queueWaitMs: startMs === null ? null : between(ms(run.requestedAt), startMs),
      };
    });
}

function deriveDelegated(input: TaskTimingInput, now: number) {
  return input.delegated
    .map(({ task, childRun }): TaskTimingDelegated => {
      const requestedAt = task.startedAt ?? task.completedAt ?? input.now;
      const started = childRun?.workStartedAt ?? childRun?.startedAt ?? null;
      const endMs = task.completedAt === null ? null : ms(task.completedAt);
      return {
        taskId: task.id,
        role: task.role ?? null,
        instanceId: task.providerInstanceId,
        model: task.model,
        childThreadId: task.childThreadId,
        status: task.status,
        requestedAt: iso(requestedAt),
        startedAt: started === null ? null : iso(started),
        endedAt: task.completedAt === null ? null : iso(task.completedAt),
        durationMs: started === null ? null : between(ms(started), endMs ?? now),
        waitMs: started === null ? null : between(ms(requestedAt), ms(started)),
      };
    })
    .toSorted((left, right) => left.requestedAt.localeCompare(right.requestedAt));
}

function groupDelegated(delegated: ReadonlyArray<TaskTimingDelegated>) {
  const groups = new Map<string, TaskTimingDelegatedTotal>();
  for (const entry of delegated) {
    if (entry.durationMs === null) continue;
    const role = entry.role ?? "general";
    const model = entry.model ?? "unknown";
    const key = JSON.stringify([role, entry.instanceId, model]);
    const group = groups.get(key);
    groups.set(key, {
      role,
      instanceId: entry.instanceId,
      model,
      tasks: (group?.tasks ?? 0) + 1,
      totalMs: (group?.totalMs ?? 0) + entry.durationMs,
    });
  }
  return [...groups.values()].toSorted((left, right) => right.totalMs - left.totalMs);
}

function deriveLedgerItems(
  input: TaskTimingInput,
  now: number,
): ReadonlyArray<TaskTimingLedgerItem> {
  const { ledger } = input;
  if (ledger === undefined) return [];
  return ledger.items.map((item): TaskTimingLedgerItem => {
    const updates = input.itemUpdates.filter(
      (entry) => entry.ledgerId === ledger.id && entry.item.id === item.id,
    );
    const openedMs = ms(item.createdAt);
    // Each change of status ends the previous stretch, so reopening and un-starting both count.
    let status: LedgerItem["status"] = "open";
    let since = openedMs;
    let startedMs: number | null = null;
    let inProgressMs = 0;
    let closedMs: number | null = null;
    let evidence: string | null = null;
    let evidenceMs = openedMs;
    const seen = new Set<number>();
    const verdicts: Array<TaskTimingLedgerItem["verdicts"][number]> = [];
    for (const { at, item: next } of updates) {
      const atMs = ms(at);
      if (next.evidence !== evidence) {
        evidence = next.evidence;
        evidenceMs = atMs;
      }
      if (next.verdict !== null && !seen.has(ms(next.verdict.at))) {
        seen.add(ms(next.verdict.at));
        verdicts.push({
          outcome: next.verdict.outcome,
          at: iso(next.verdict.at),
          afterMs: between(evidenceMs, ms(next.verdict.at)),
        });
      }
      if (next.status === status) continue;
      if (status === "in_progress") inProgressMs += between(since, atMs);
      if (next.status === "in_progress") startedMs ??= atMs;
      closedMs = next.status === "closed" || next.status === "dropped" ? atMs : null;
      status = next.status;
      since = atMs;
    }
    if (status === "in_progress") inProgressMs += between(since, now);
    // With no events to go on, fall back to what the projection says about the item.
    const finished = item.status === "closed" || item.status === "dropped";
    const closedAtMs = !finished ? null : (closedMs ?? ms(item.closedAt ?? item.updatedAt));
    return {
      itemId: item.id,
      title: item.title,
      status: item.status,
      openedAt: iso(item.createdAt),
      startedAt: startedMs === null ? null : isoMs(startedMs),
      closedAt: closedAtMs === null ? null : isoMs(closedAtMs),
      waitToStartMs: startedMs === null ? null : between(openedMs, startedMs),
      inProgressMs,
      openToCloseMs: closedAtMs === null ? null : between(openedMs, closedAtMs),
      judgeAttempts: Math.max(item.judgements ?? 0, verdicts.length),
      verdicts,
    };
  });
}

function deriveStalls(
  input: TaskTimingInput,
  runs: ReadonlyArray<TaskTimingRun>,
  now: number,
  thresholdMs: number,
): ReadonlyArray<TaskTimingStall> {
  const stalls: Array<TaskTimingStall> = [];

  for (const request of input.runtimeRequests) {
    const endMs =
      request.resolvedAt !== null
        ? ms(request.resolvedAt)
        : request.status === "pending"
          ? now
          : null;
    if (endMs === null) continue;
    const durationMs = between(ms(request.createdAt), endMs);
    if (durationMs < thresholdMs) continue;
    stalls.push({
      kind: "pending_request",
      startedAt: iso(request.createdAt),
      endedAt: request.resolvedAt === null ? null : iso(request.resolvedAt),
      durationMs,
      detail: request.kind,
    });
  }

  // Only a message a person wrote counts as the thread waiting on them; a server or agent
  // message after a gap means the thread sat idle.
  const fromPerson = new Set(
    input.userMessages
      .filter((message) => message.creationSource === "web" || message.creationSource === "mobile")
      .map((message) => message.id),
  );
  const messageByRun = new Map(input.runs.map((run) => [run.id, run.userMessageId]));
  for (let index = 1; index < runs.length; index += 1) {
    const previous = runs[index - 1]!;
    const next = runs[index]!;
    if (previous.endedAt === null) continue;
    const gapMs = between(Date.parse(previous.endedAt), Date.parse(next.requestedAt));
    if (gapMs < thresholdMs) continue;
    const messageId = messageByRun.get(next.runId);
    stalls.push({
      kind:
        messageId !== undefined && fromPerson.has(messageId)
          ? "waiting_on_user"
          : "idle_between_runs",
      startedAt: previous.endedAt,
      endedAt: next.requestedAt,
      durationMs: gapMs,
      runId: next.runId,
    });
  }

  const ledger = input.ledger;
  if (ledger !== undefined) {
    const createdMs = ms(ledger.createdAt);
    const closedMs = ledger.closedAt === null ? now : ms(ledger.closedAt);
    const progress = input.itemUpdates
      .filter((entry) => entry.ledgerId === ledger.id)
      .map((entry) => ms(entry.at));
    for (const run of runs) {
      if (run.startedAt === null || run.durationMs === null || run.durationMs < thresholdMs) {
        continue;
      }
      const startMs = Date.parse(run.startedAt);
      const endMs = run.endedAt === null ? now : Date.parse(run.endedAt);
      // The run that wrote the ledger spent its time planning it, not failing to move it.
      const createdHere = startMs <= createdMs && createdMs <= endMs;
      if (createdHere || endMs < createdMs || startMs > closedMs) continue;
      if (progress.some((at) => at >= startMs && at <= endMs)) continue;
      stalls.push({
        kind: "no_ledger_progress",
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        durationMs: run.durationMs,
        runId: run.runId,
      });
    }
  }

  return stalls.toSorted((left, right) => left.startedAt.localeCompare(right.startedAt));
}

export function deriveTaskTiming(input: TaskTimingInput): TaskTiming {
  const now = ms(input.now);
  const thresholdMs = input.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
  const runs = deriveRuns(input, now);
  const delegated = deriveDelegated(input, now);
  const stalls = deriveStalls(input, runs, now, thresholdMs);

  const firstRequestedMs = runs.reduce(
    (first, run) => Math.min(first, Date.parse(run.requestedAt)),
    Number.POSITIVE_INFINITY,
  );
  const lastEndMs = runs.reduce((last, run) => {
    const endMs =
      run.endedAt === null
        ? runIsLive(run.status)
          ? now
          : Date.parse(run.requestedAt)
        : Date.parse(run.endedAt);
    return Math.max(last, endMs);
  }, Number.NEGATIVE_INFINITY);

  return {
    threadId: input.threadId,
    generatedAt: iso(input.now),
    stallThresholdMs: thresholdMs,
    runs,
    delegated,
    ledgerItems: deriveLedgerItems(input, now),
    stalls,
    totals: {
      wallMs: runs.length === 0 ? 0 : between(firstRequestedMs, lastEndMs),
      agentMs: sum(runs.map((run) => run.durationMs)),
      queueMs: sum(runs.map((run) => run.queueWaitMs)),
      delegatedMs: sum(delegated.map((entry) => entry.durationMs)),
      // A run with no ledger progress is already counted in agentMs.
      stalledMs: sum(
        stalls
          .filter((stall) => stall.kind !== "no_ledger_progress")
          .map((stall) => stall.durationMs),
      ),
    },
    delegatedBy: groupDelegated(delegated),
  };
}

const slowest = <T extends { readonly durationMs: number | null }>(
  entries: ReadonlyArray<T>,
  limit: number,
) =>
  entries
    .filter((entry) => entry.durationMs !== null)
    .toSorted((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .slice(0, limit);

/** Counts and totals in full, and only the few slowest entries of each list. */
export function summarizeTaskTiming(timing: TaskTiming, limit: number): TaskTimingSummary {
  return {
    threadId: timing.threadId,
    generatedAt: timing.generatedAt,
    stallThresholdMs: timing.stallThresholdMs,
    runCount: timing.runs.length,
    delegatedCount: timing.delegated.length,
    stallCount: timing.stalls.length,
    totals: timing.totals,
    delegatedBy: timing.delegatedBy,
    slowestRuns: slowest(timing.runs, limit),
    slowestDelegated: slowest(timing.delegated, limit),
    longestStalls: timing.stalls
      .toSorted((left, right) => right.durationMs - left.durationMs)
      .slice(0, limit),
    ledgerItems: timing.ledgerItems
      .toSorted((left, right) => right.inProgressMs - left.inProgressMs)
      .slice(0, SUMMARY_LEDGER_ITEMS),
  };
}
