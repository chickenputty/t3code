import {
  CommandId,
  type Ledger,
  MessageId,
  type OrchestrationV2Run,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { decideLedgerAutoContinue } from "@t3tools/shared/taskLedger";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Orchestrator from "./Orchestrator.ts";

const NON_TERMINAL_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

type LedgerContinuationOrchestrator = Pick<
  Orchestrator.OrchestratorV2["Service"],
  "dispatch" | "getThreadRecords"
>;

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

/**
 * Called once a run's checkpoint is durable. Every skip below leaves the ledger as it is: the
 * user, or a later run's own finalization, decides what happens next.
 */
export const continueLedgerAfterRun = Effect.fn("LedgerAutoContinue.continueAfterRun")(function* (
  orchestrator: LedgerContinuationOrchestrator,
  input: { readonly threadId: ThreadId; readonly runId: RunId },
) {
  const records = yield* orchestrator.getThreadRecords(
    input.threadId,
    ["runs", "messages", "runtimeRequests", "ledger", "turnItems"],
    {
      messageRoles: ["user"],
      turnItemTypes: ["run_interrupt_request"],
      turnItemRunIds: [input.runId],
    },
  );
  const { thread, runs, messages, runtimeRequests, ledger, turnItems } = records;
  const run = runs.find((candidate) => candidate.id === input.runId);
  // Failed runs never reach checkpoint capture and a usage limit is a failure, so only a normal
  // completion gets here; a stopped or cancelled run must not be restarted behind the user.
  if (run?.status !== "completed") return;
  if (thread.archivedAt !== null || thread.deletedAt != null) return;
  if (thread.settledOverride === "settled") return;
  // A stop that raced the provider's own completion still means the user wants this to end.
  if (turnItems.length > 0) return;
  if (runtimeRequests.some((request) => request.status === "pending")) return;
  // Anything newer, queued or live, goes first; its own finalization decides what follows.
  if (runs.some((candidate) => candidate.ordinal > run.ordinal)) return;
  if (runs.some((candidate) => NON_TERMINAL_RUN_STATUSES.has(candidate.status))) return;

  const messageId = MessageId.make(`message:ledger-continue:${run.id}`);
  if (messages.some((message) => message.id === messageId)) return;

  // Run ordinals order messages exactly; timestamps tie within a millisecond.
  const ordinalOf = (message: (typeof messages)[number]) =>
    runs.find((candidate) => candidate.id === message.runId)?.ordinal ?? 0;
  const decision = decideLedgerAutoContinue({
    ledger,
    messages: messages.toSorted((a, b) => ordinalOf(a) - ordinalOf(b)),
  });
  if (decision.type === "idle" || ledger === undefined) return;
  if (decision.type === "stuck") {
    // Marking the thread unread is the existing "look at me" signal; whether it is stuck is
    // derived from the same decision, so nothing else needs clearing when the user acts.
    yield* orchestrator.dispatch({
      type: "thread.mark-unread",
      commandId: CommandId.make(`server:ledger-stuck:${run.id}`),
      threadId: input.threadId,
    });
    return;
  }
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make(`server:ledger-continue:${run.id}`),
    messageId,
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
    return {
      // The checkpoint is already durable, and a failed follow-up must not hold back the next
      // turn by failing finalization. The next completed run decides again.
      afterRun: (input) =>
        continueLedgerAfterRun(orchestrator, input).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logWarning("ledger auto-continue failed", { ...input, cause }),
          ),
        ),
    };
  }),
);
