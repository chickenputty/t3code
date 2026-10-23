import {
  CommandId,
  type Ledger,
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  decideLedgerAutoContinue,
  LEDGER_AUTO_CONTINUE_CAP,
  type LedgerAutoContinueDecision,
} from "@t3tools/shared/taskLedger";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";

import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";

const NON_TERMINAL_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

// Runs read per message batch while looking for the user's last message. The streak is at most
// the cap, so one batch covers the usual case.
const MESSAGE_BATCH_RUNS = LEDGER_AUTO_CONTINUE_CAP * 2 + 2;

export interface LedgerAutoContinueDeps {
  readonly orchestrator: Pick<
    Orchestrator.OrchestratorV2["Service"],
    "dispatch" | "getThreadRecords"
  >;
  readonly eventSink: Pick<EventSink.EventSinkV2["Service"], "commitCommand">;
  readonly ids: Pick<IdAllocator.IdAllocatorV2["Service"], "allocate" | "derive">;
}

const isClientUserMessage = (message: OrchestrationV2ConversationMessage) =>
  message.role === "user" && message.createdBy === "user" && message.creationSource !== "server";

function continuationText(
  ledger: Ledger,
  open: ReadonlyArray<Ledger["items"][number]>,
  round: number,
): string {
  const lines = open.map(
    (item) => `- ${item.id} [${item.status}] ${item.title}\n  Acceptance: ${item.acceptance}`,
  );
  return [
    `The task ledger "${ledger.title}" still has ${open.length} open ${open.length === 1 ? "item" : "items"} (automatic follow-up ${round}). Continue working through them. Close an item with evidence once its acceptance holds, or drop it with a reason if it no longer applies.`,
    ...lines,
  ].join("\n\n");
}

const NOTICE_TITLES_SHOWN = 3;
const NOTICE_TITLE_MAX_CHARS = 48;

function stopNoticeText(
  stuck: Extract<LedgerAutoContinueDecision, { type: "stuck" }>,
  ledger: Ledger,
): string {
  const count = stuck.openIds.length;
  const why =
    stuck.reason === "cap"
      ? `reached the limit of ${LEDGER_AUTO_CONTINUE_CAP} automatic follow-ups`
      : "no progress last round";
  const titles = stuck.openIds.map((id) => {
    const title = ledger.items.find((item) => item.id === id)?.title ?? id;
    return title.length > NOTICE_TITLE_MAX_CHARS
      ? `${title.slice(0, NOTICE_TITLE_MAX_CHARS - 1)}…`
      : title;
  });
  const hidden = titles.length - NOTICE_TITLES_SHOWN;
  const listed = titles.slice(0, NOTICE_TITLES_SHOWN).join(", ");
  return `Stopped continuing the task ledger: ${count} ${count === 1 ? "item" : "items"} still open (${why}): ${listed}${hidden > 0 ? ` and ${hidden} more` : ""}.`;
}
/**
 * Called once a run's checkpoint is durable. Every skip below leaves the ledger as it is: the
 * user, or a later run's own finalization, decides what happens next. This runs on the lane that
 * holds back the next run's start, so the cheap exits come before any message is read, and
 * messages are read only back to the user's last one.
 */
export const continueLedgerAfterRun = Effect.fn("LedgerAutoContinue.continueAfterRun")(function* (
  deps: LedgerAutoContinueDeps,
  input: { readonly threadId: ThreadId; readonly runId: RunId },
) {
  const { orchestrator } = deps;
  const records = yield* orchestrator.getThreadRecords(
    input.threadId,
    ["runs", "runtimeRequests", "ledger", "turnItems"],
    { turnItemTypes: ["run_interrupt_request"] },
  );
  const { thread, runs, runtimeRequests, ledger, turnItems } = records;
  const run = runs.find((candidate) => candidate.id === input.runId);
  // Failed runs never reach checkpoint capture and a usage limit is a failure, so only a normal
  // completion gets here; a stopped or cancelled run must not be restarted behind the user.
  if (run?.status !== "completed") return;
  if (
    ledger === undefined ||
    ledger.closedAt !== null ||
    !ledger.items.some((item) => item.status === "open" || item.status === "in_progress")
  ) {
    return;
  }
  // Anything newer, queued or live, goes first; its own finalization decides what follows.
  if (runs.some((candidate) => candidate.ordinal > run.ordinal)) return;
  if (runs.some((candidate) => NON_TERMINAL_RUN_STATUSES.has(candidate.status))) return;
  if (thread.archivedAt !== null || thread.deletedAt != null) return;
  if (thread.settledOverride === "settled") return;
  // A stop that raced the provider's own completion still means the user wants this to end.
  if (turnItems.some((item) => item.runId === run.id)) return;
  if (runtimeRequests.some((request) => request.status === "pending")) return;

  const ordinalByRun = new Map(runs.map((candidate) => [candidate.id, candidate.ordinal]));
  const newestFirst = runs.toSorted((a, b) => b.ordinal - a.ordinal);
  const messages: Array<OrchestrationV2ConversationMessage> = [];
  for (let start = 0; start < newestFirst.length; start += MESSAGE_BATCH_RUNS) {
    const batch = (yield* orchestrator.getThreadRecords(input.threadId, ["messages"], {
      messageRoles: ["user"],
      messageRunIds: newestFirst.slice(start, start + MESSAGE_BATCH_RUNS).map(({ id }) => id),
    })).messages;
    messages.push(...batch);
    if (batch.some(isClientUserMessage)) break;
  }

  const decision = decideLedgerAutoContinue({
    ledger,
    // Run ordinals order messages exactly; timestamps tie within a millisecond.
    messages: messages.toSorted(
      (a, b) => (ordinalByRun.get(a.runId!) ?? 0) - (ordinalByRun.get(b.runId!) ?? 0),
    ),
    // A follow-up the user cancelled or stopped means they want it off until they speak again.
    // `interrupted` alone does not say who stopped it (the provider can end a turn itself), so
    // it counts only with the user's interrupt request on the run.
    cancelledRunIds: new Set(
      runs
        .filter(
          (candidate) =>
            candidate.status === "cancelled" ||
            (candidate.status === "interrupted" &&
              turnItems.some((item) => item.runId === candidate.id)),
        )
        .map(({ id }) => id),
    ),
  });
  if (decision.type === "idle") return;
  if (decision.type === "stuck") {
    // The timeline notice says why; the unread mark is the existing "look at me" signal.
    const now = yield* DateTime.now;
    const noticeCommandId = CommandId.make(`server:ledger-stuck-notice:${run.id}`);
    yield* deps.eventSink.commitCommand({
      commandId: noticeCommandId,
      threadId: input.threadId,
      commandType: "ledger.auto-continue.stop",
      acceptedAt: now,
      effects: [],
      events: [
        {
          id: yield* deps.ids.allocate.event({
            threadId: input.threadId,
            commandId: noticeCommandId,
          }),
          type: "turn-item.updated",
          threadId: input.threadId,
          runId: run.id,
          ...(run.rootNodeId === null ? {} : { nodeId: run.rootNodeId }),
          providerInstanceId: run.providerInstanceId,
          occurredAt: now,
          payload: {
            id: deps.ids.derive.runSignalTurnItem({
              runId: run.id,
              signal: "ledger-auto-continue-stopped",
            }),
            threadId: input.threadId,
            runId: run.id,
            nodeId: run.rootNodeId,
            providerThreadId: run.providerThreadId,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            // Placeholder: EventSink assigns turn item positions when it commits.
            ordinal: 0,
            status: "completed",
            title: "Auto-continue stopped",
            startedAt: now,
            completedAt: now,
            updatedAt: now,
            type: "system_notice",
            message: stopNoticeText(decision, ledger),
          },
        },
      ],
    });
    yield* markUnread(orchestrator, input.threadId, run.id);
    return;
  }
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make(`server:ledger-continue:${run.id}`),
    messageId: MessageId.make(`message:ledger-continue:${run.id}`),
    threadId: input.threadId,
    text: continuationText(ledger, decision.open, decision.round),
    notification: {
      source: { kind: "ledger_continue", round: decision.round, items: [...decision.items] },
      outcome: "updated",
      summary: `Task ledger: ${decision.open.length} open ${decision.open.length === 1 ? "item" : "items"}`,
    },
    attachments: [],
    dispatchMode: { type: "queue_after_active" },
    createdBy: "agent",
    creationSource: "server",
  });
});

const markUnread = (
  orchestrator: LedgerAutoContinueDeps["orchestrator"],
  threadId: ThreadId,
  runId: RunId,
) =>
  orchestrator.dispatch({
    type: "thread.mark-unread",
    commandId: CommandId.make(`server:ledger-stuck:${runId}`),
    threadId,
  });

/**
 * The checkpoint is already durable, and a failed follow-up must not hold back the next turn by
 * failing finalization. The round is lost, so the thread is marked unread rather than left
 * looking finished.
 */
export const continueLedgerAfterRunSafely = Effect.fn("LedgerAutoContinue.continueAfterRunSafely")(
  function* (
    deps: LedgerAutoContinueDeps,
    input: { readonly threadId: ThreadId; readonly runId: RunId },
  ) {
    yield* continueLedgerAfterRun(deps, input).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("ledger auto-continue failed", { ...input, cause }).pipe(
              Effect.andThen(
                markUnread(deps.orchestrator, input.threadId, input.runId).pipe(Effect.ignore),
              ),
            ),
      ),
    );
  },
);

/**
 * Defaults to doing nothing so a layer tree that has no orchestrator, such as a finalization
 * unit test, still builds; the runtime layers provide the real one.
 */
export class LedgerAutoContinue extends Context.Reference<{
  readonly afterRun: (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) => Effect.Effect<void>;
}>("t3/orchestration-v2/LedgerAutoContinue", {
  defaultValue: () => ({ afterRun: () => Effect.void }),
}) {}

export const layer = Layer.effect(
  LedgerAutoContinue,
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const eventSink = yield* EventSink.EventSinkV2;
    const ids = yield* IdAllocator.IdAllocatorV2;
    return {
      afterRun: (input) => continueLedgerAfterRunSafely({ orchestrator, eventSink, ids }, input),
    };
  }),
);
