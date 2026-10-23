import { expect, it } from "@effect/vitest";
import {
  type Ledger,
  type LedgerItem,
  type LedgerItemVerdict,
  LedgerId,
  LedgerItemId,
  type NodeId,
  type OrchestratorMcpFailure,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { type JudgeRun, type JudgementPorts, requestJudgement } from "./LedgerJudgement.ts";

const at = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
const itemId = LedgerItemId.make("L1");

const item = (overrides: Partial<LedgerItem> = {}): LedgerItem => ({
  id: itemId,
  title: "Wire the CLI",
  acceptance: "CLI smoke test passes",
  status: "in_progress",
  evidence: "smoke.test.ts: 3 passed",
  dropReason: null,
  verdict: null,
  createdAt: at,
  updatedAt: at,
  closedAt: null,
  ...overrides,
});

const ledgerOf = (overrides: Partial<Ledger> = {}, items = [item()]): Ledger => ({
  id: LedgerId.make("ledger:judged"),
  threadId: ThreadId.make("thread:judged"),
  title: "Ship the CLI",
  startState: "",
  checkpoints: [],
  winConditions: [],
  items,
  requiresJudge: true,
  createdAt: at,
  updatedAt: at,
  closedAt: null,
  ...overrides,
});

const judge = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-5-5" };
const run = (overrides: Partial<JudgeRun> = {}): JudgeRun => ({
  taskId: "task:judge" as NodeId,
  childThreadId: ThreadId.make("thread:judge"),
  status: "completed",
  summary: "Ran the smoke test myself.\nVERDICT: PASS",
  waitTimedOut: false,
  judge,
  ...overrides,
});

const harness = (options: { run?: JudgeRun; userMessages?: number } = {}) => {
  const delegated: Array<{ prompt: string; keySource: string }> = [];
  const recorded: Array<{
    itemId: string;
    judgedEvidence: string | null;
    verdict: LedgerItemVerdict;
    taskId: string;
  }> = [];
  const ports: JudgementPorts = {
    delegate: (input) =>
      Effect.sync(() => {
        delegated.push(input);
        return options.run ?? run();
      }),
    userMessageCount: () => Effect.succeed(options.userMessages ?? 1),
    recordVerdict: (input) =>
      Effect.sync(() => {
        recorded.push(input);
        return 7;
      }),
  };
  return { ports, delegated, recorded };
};

const failureOf = <A>(exit: Exit.Exit<A, OrchestratorMcpFailure>) =>
  Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
    ? exit.cause.reasons[0].error
    : undefined;

it.effect("records the judge's pass verdict, server side, against the evidence it saw", () => {
  const { ports, delegated, recorded } = harness();
  return Effect.gen(function* () {
    const result = yield* requestJudgement({ ledger: ledgerOf(), itemId, ports });
    expect(result).toMatchObject({ outcome: "pass", judge, sequence: 7 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      itemId: "L1",
      judgedEvidence: "smoke.test.ts: 3 passed",
      taskId: "task:judge",
      verdict: { outcome: "pass", judge },
    });
    // The judge is shown what done means and the claim, and told how to answer.
    expect(delegated[0]?.prompt).toContain("CLI smoke test passes");
    expect(delegated[0]?.prompt).toContain("smoke.test.ts: 3 passed");
    expect(delegated[0]?.prompt).toContain("VERDICT: PASS");
    expect(delegated[0]?.keySource).toContain("smoke.test.ts: 3 passed");
  });
});

it.effect("records a fail verdict so the item stays open", () => {
  const { ports, recorded } = harness({
    run: run({ summary: "No CLI entry exists.\nVERDICT: FAIL" }),
  });
  return Effect.gen(function* () {
    expect(yield* requestJudgement({ ledger: ledgerOf(), itemId, ports })).toMatchObject({
      outcome: "fail",
    });
    expect(recorded[0]?.verdict.outcome).toBe("fail");
    expect(recorded[0]?.verdict.notes).toContain("No CLI entry exists.");
  });
});

it.effect("fails closed when the judge gives no parseable verdict", () => {
  const { ports, recorded } = harness({ run: run({ summary: "Seems fine, ship it." }) });
  return Effect.gen(function* () {
    expect(yield* requestJudgement({ ledger: ledgerOf(), itemId, ports })).toMatchObject({
      outcome: "fail",
    });
    expect(recorded[0]?.verdict.notes).toContain("did not end with a verdict line");
  });
});

it.effect(
  "records fail, not the judge's pass, when the judged agent talked to the judge thread",
  () => {
    const { ports, recorded } = harness({ userMessages: 2 });
    return Effect.gen(function* () {
      const result = yield* requestJudgement({ ledger: ledgerOf(), itemId, ports });
      expect(result.outcome).toBe("fail");
      expect(recorded[0]?.verdict.outcome).toBe("fail");
      expect(recorded[0]?.verdict.notes).toContain("received messages");
    });
  },
);

it.effect(
  "records nothing while the judge is still running or when its task did not finish",
  () => {
    const cases: ReadonlyArray<Partial<JudgeRun>> = [
      { status: "running", summary: null, waitTimedOut: true },
      { status: "failed", summary: null },
      { status: "cancelled", summary: null },
    ];
    return Effect.gen(function* () {
      for (const override of cases) {
        const { ports, recorded } = harness({ run: run(override) });
        const exit = yield* Effect.exit(requestJudgement({ ledger: ledgerOf(), itemId, ports }));
        expect(failureOf(exit)?.message, override.status).toContain("ledger_request_judgement");
        expect(recorded).toEqual([]);
      }
    });
  },
);

it.effect("refuses before delegating when there is nothing to judge", () => {
  const cases: ReadonlyArray<readonly [string, Ledger | undefined, string]> = [
    ["no ledger", undefined, "no ledger"],
    ["no gate", ledgerOf({ requiresJudge: false }), "does not require a judge"],
    [
      "unset gate",
      (({ requiresJudge: _unset, ...older }) => older)(ledgerOf()),
      "does not require a judge",
    ],
    ["unknown item", ledgerOf({}, []), "Unknown item L1"],
    ["closed item", ledgerOf({}, [item({ status: "closed", closedAt: at })]), "is closed"],
    ["no evidence", ledgerOf({}, [item({ evidence: null })]), "needs evidence"],
    ["blank evidence", ledgerOf({}, [item({ evidence: "  " })]), "needs evidence"],
  ];
  return Effect.gen(function* () {
    for (const [name, ledger, message] of cases) {
      const { ports, delegated, recorded } = harness();
      const exit = yield* Effect.exit(requestJudgement({ ledger, itemId, ports }));
      expect(failureOf(exit)?.message, name).toContain(message);
      expect(failureOf(exit)?.code, name).toBe("invalid_request");
      expect(delegated, name).toEqual([]);
      expect(recorded, name).toEqual([]);
    }
  });
});
