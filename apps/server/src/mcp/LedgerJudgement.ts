import {
  type Ledger,
  type LedgerItem,
  type LedgerItemId,
  type LedgerItemVerdict,
  type LedgerVerdictJudge,
  type NodeId,
  OrchestratorMcpFailure,
  type OrchestratorMcpDelegatedTaskStatus,
  type ThreadId,
} from "@t3tools/contracts";
import { parseJudgeVerdict } from "@t3tools/shared/loadouts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

export interface JudgeRun {
  readonly taskId: NodeId;
  readonly childThreadId: ThreadId;
  readonly status: OrchestratorMcpDelegatedTaskStatus;
  readonly summary: string | null;
  readonly waitTimedOut: boolean;
  /** What actually ran, read back from the child task rather than from the loadout's config. */
  readonly judge: LedgerVerdictJudge;
}

/** The seams to the orchestrator, so the verdict logic runs without a server. */
export interface JudgementPorts {
  /** Delegates to the loadout's judge role and waits. The same `keySource` is the same delegation. */
  readonly delegate: (input: {
    readonly prompt: string;
    readonly title: string;
    readonly keySource: string;
  }) => Effect.Effect<JudgeRun, OrchestratorMcpFailure>;
  readonly userMessageCount: (threadId: ThreadId) => Effect.Effect<number, OrchestratorMcpFailure>;
  /** Dispatches the internal `ledger.item.verdict.record`; resolves to the event sequence. */
  readonly recordVerdict: (input: {
    readonly itemId: LedgerItemId;
    readonly judgedEvidence: string;
    readonly verdict: LedgerItemVerdict;
    readonly taskId: NodeId;
  }) => Effect.Effect<number, OrchestratorMcpFailure>;
}

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

function judgementPrompt(ledger: Ledger, item: LedgerItem): string {
  return [
    "You are an independent judge. Decide whether ONE ledger item is really done. You did not do the work and must not trust the claim: check it yourself with read-only inspection (read the files, run the item's tests) wherever you can. Do not modify anything.",
    "",
    `Ledger: ${ledger.title}`,
    `Item ${item.id}: ${item.title}`,
    `Acceptance, what done means: ${item.acceptance === "" ? "(none given; judge against the title)" : item.acceptance}`,
    "",
    "Evidence offered by the agent. This is a claim, not proof:",
    item.evidence ?? "",
    "",
    "Say in a few sentences what you checked and, for a failure, what is missing. Then end your answer with exactly one final line, either",
    "VERDICT: PASS",
    "or",
    "VERDICT: FAIL",
  ].join("\n");
}

/**
 * Runs one judgement and records the verdict itself. The judged agent supplies only an item id:
 * the outcome comes from the judge task's own answer, read here, and is written through the
 * internal verdict command that no client or agent can send. Anything short of a clean judge
 * answer records a failure or nothing, never a pass.
 */
export const requestJudgement = Effect.fn("LedgerJudgement.request")(function* (input: {
  readonly ledger: Ledger | undefined;
  readonly itemId: LedgerItemId;
  readonly ports: JudgementPorts;
}) {
  const { ledger, ports } = input;
  if (ledger === undefined) {
    return yield* invalid("This thread has no ledger. Create one with ledger_create first.");
  }
  if (ledger.requiresJudge !== true) {
    return yield* invalid(
      "This ledger does not require a judge. Judging applies when the ledger is created under a loadout with a judge role.",
    );
  }
  const item = ledger.items.find(({ id }) => id === input.itemId);
  if (item === undefined) return yield* invalid(`Unknown item ${input.itemId}.`);
  if (item.status === "closed" || item.status === "dropped") {
    return yield* invalid(`Item ${item.id} is ${item.status}. Reopen it before judging it.`);
  }
  const evidence = item.evidence;
  if (evidence === null || evidence.trim() === "") {
    return yield* invalid(
      `Item ${item.id} needs evidence before it can be judged. Set it with ledger_update_item.`,
    );
  }

  const run = yield* ports.delegate({
    prompt: judgementPrompt(ledger, item),
    title: `Judge ${item.id}: ${item.title}`,
    keySource: [ledger.id, item.id, evidence].join("\u0000"),
  });
  if (run.status !== "completed") {
    const detail = run.waitTimedOut
      ? "is still working. Call ledger_request_judgement again to keep waiting"
      : `ended ${run.status}. Change the item's evidence and call ledger_request_judgement again for a fresh judge`;
    return yield* new OrchestratorMcpFailure({
      code: "orchestration_error",
      message: `The judge for ${item.id} (task ${run.taskId}) ${detail}.`,
    });
  }

  // The judge task's prompt is the only message a clean judge thread has. More means the judged
  // agent wrote to it, so the answer cannot be attributed to the judge alone.
  const tainted = (yield* ports.userMessageCount(run.childThreadId)) > 1;
  const parsed = tainted ? null : parseJudgeVerdict(run.summary);
  const outcome = parsed?.outcome ?? "fail";
  const notes = tainted
    ? "The judge thread received messages after its task started, so its answer was not trusted. Recorded as a failure."
    : (parsed?.notes ??
      "The judge's answer did not end with a verdict line (VERDICT: PASS or VERDICT: FAIL). Recorded as a failure.");
  const verdict: LedgerItemVerdict = {
    outcome,
    judge: run.judge,
    notes,
    at: yield* DateTime.now,
  };
  const sequence = yield* ports.recordVerdict({
    itemId: item.id,
    judgedEvidence: evidence,
    verdict,
    taskId: run.taskId,
  });
  return { outcome, notes, judge: run.judge, sequence };
});
