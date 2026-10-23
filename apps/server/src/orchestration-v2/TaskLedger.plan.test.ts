import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  type Ledger,
  LedgerId,
  LedgerItemId,
  type LedgerItem,
  type LedgerItemVerdict,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

import { type LedgerCommand, planLedgerCommand } from "./TaskLedger.ts";

const earlier = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
const now = DateTime.makeUnsafe("2026-01-01T00:05:00.000Z");
const threadId = ThreadId.make("thread:ledger-plan");
const ledgerId = LedgerId.make("ledger:plan");
const itemId = LedgerItemId.make("item:plan");

const verdict = (outcome: "pass" | "fail"): LedgerItemVerdict => ({
  outcome,
  judge: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.1-codex" },
  notes: "",
  at: earlier,
});

const item = (overrides: Partial<LedgerItem> = {}): LedgerItem => ({
  id: itemId,
  title: "Plan item",
  acceptance: "works",
  status: "in_progress",
  evidence: "ran the suite",
  dropReason: null,
  verdict: null,
  createdAt: earlier,
  updatedAt: earlier,
  closedAt: null,
  ...overrides,
});

const ledgerWith = (overrides: Partial<LedgerItem> = {}): Ledger => ({
  id: ledgerId,
  threadId,
  title: "Plan",
  startState: "",
  checkpoints: [],
  winConditions: [],
  items: [item(overrides)],
  createdAt: earlier,
  updatedAt: earlier,
  closedAt: null,
});

const closeItem: LedgerCommand = {
  type: "ledger.item.update",
  commandId: CommandId.make("command:plan:close"),
  threadId,
  ledgerId,
  itemId,
  status: "closed",
};

describe("planLedgerCommand judge gate", () => {
  it("lets an item close without a verdict when the ledger does not require a judge", () => {
    const planned = planLedgerCommand({ command: closeItem, ledger: ledgerWith(), now });
    assert.isTrue(Result.isSuccess(planned));
    const explicit = planLedgerCommand({
      command: closeItem,
      ledger: ledgerWith(),
      now,
      requiresJudge: false,
    });
    assert.isTrue(Result.isSuccess(explicit));
  });

  it("refuses to close without a verdict or after a failing one when a judge is required", () => {
    for (const verdictOnItem of [null, verdict("fail")]) {
      const planned = planLedgerCommand({
        command: closeItem,
        ledger: ledgerWith({ verdict: verdictOnItem }),
        now,
        requiresJudge: true,
      });
      assert.isTrue(Result.isFailure(planned));
      assert.include(Result.isFailure(planned) ? planned.failure : "", "passing judge verdict");
    }
  });

  it("closes with a passing verdict when a judge is required, and the verdict alone closes nothing", () => {
    const closed = planLedgerCommand({
      command: closeItem,
      ledger: ledgerWith({ verdict: verdict("pass") }),
      now,
      requiresJudge: true,
    });
    assert.isTrue(Result.isSuccess(closed));
    const events = Result.isSuccess(closed) ? closed.success : [];
    assert.equal(events[0]?.type, "ledger.item.updated");
    assert.equal(
      events[0]?.type === "ledger.item.updated" ? events[0].payload.item.status : undefined,
      "closed",
    );

    const recorded = planLedgerCommand({
      command: {
        type: "ledger.item.verdict.record",
        commandId: CommandId.make("command:plan:verdict"),
        threadId,
        ledgerId,
        itemId,
        verdict: verdict("pass"),
      },
      ledger: ledgerWith(),
      now,
      requiresJudge: true,
    });
    const recordedItem =
      Result.isSuccess(recorded) && recorded.success[0]?.type === "ledger.item.updated"
        ? recorded.success[0].payload.item
        : undefined;
    assert.equal(recordedItem?.status, "in_progress");
    assert.equal(recordedItem?.verdict?.outcome, "pass");
  });

  it("invalidates the verdict when the evidence changes after it was given", () => {
    const planned = planLedgerCommand({
      command: {
        type: "ledger.item.update",
        commandId: CommandId.make("command:plan:evidence"),
        threadId,
        ledgerId,
        itemId,
        evidence: "a different run",
      },
      ledger: ledgerWith({ verdict: verdict("pass") }),
      now,
      requiresJudge: true,
    });
    const next =
      Result.isSuccess(planned) && planned.success[0]?.type === "ledger.item.updated"
        ? planned.success[0].payload.item
        : undefined;
    assert.equal(next?.evidence, "a different run");
    assert.isNull(next?.verdict);

    const closing = planLedgerCommand({
      command: { ...closeItem, evidence: "a different run" },
      ledger: ledgerWith({ verdict: verdict("pass") }),
      now,
      requiresJudge: true,
    });
    assert.isTrue(Result.isFailure(closing));
  });
});

describe("planLedgerCommand ledger-level judge requirement", () => {
  it("gates a close on the ledger's own requiresJudge with no parameter passed", () => {
    const refused = planLedgerCommand({
      command: closeItem,
      ledger: { ...ledgerWith(), requiresJudge: true },
      now,
    });
    assert.isTrue(Result.isFailure(refused));
    assert.include(Result.isFailure(refused) ? refused.failure : "", "passing judge verdict");

    const passed = planLedgerCommand({
      command: closeItem,
      ledger: { ...ledgerWith({ verdict: verdict("pass") }), requiresJudge: true },
      now,
    });
    assert.isTrue(Result.isSuccess(passed));

    // Older records carry no field and close as before.
    assert.isTrue(
      Result.isSuccess(planLedgerCommand({ command: closeItem, ledger: ledgerWith(), now })),
    );
  });

  it("stamps the new ledger from the value the server decided at creation", () => {
    const create: LedgerCommand = {
      type: "ledger.create",
      commandId: CommandId.make("command:plan:create"),
      threadId,
      ledgerId,
      title: "Judged",
      startState: "",
      checkpoints: [],
      winConditions: [],
      items: [],
    };
    const stamped = (requiresJudge?: boolean) => {
      const planned = planLedgerCommand({
        command: create,
        ledger: undefined,
        now,
        ...(requiresJudge === undefined ? {} : { requiresJudge }),
      });
      return (
        Result.isSuccess(planned) &&
        planned.success[0]?.type === "ledger.created" &&
        planned.success[0].payload.requiresJudge === true
      );
    };
    assert.isTrue(stamped(true));
    assert.isFalse(stamped(false));
    assert.isFalse(stamped());

    // A replacement ledger never inherits the closed one's requirement.
    const replaced = planLedgerCommand({
      command: { ...create, ledgerId: LedgerId.make("ledger:next") },
      ledger: { ...ledgerWith(), requiresJudge: true, closedAt: earlier },
      now,
    });
    assert.isTrue(
      Result.isSuccess(replaced) &&
        replaced.success[0]?.type === "ledger.created" &&
        replaced.success[0].payload.requiresJudge !== true,
    );
  });

  it("counts every recorded verdict, across new evidence and reopening", () => {
    const record = (ledger: Ledger, outcome: "pass" | "fail") => {
      const planned = planLedgerCommand({
        command: {
          type: "ledger.item.verdict.record",
          commandId: CommandId.make(`command:plan:count:${outcome}`),
          threadId,
          ledgerId,
          itemId,
          verdict: verdict(outcome),
        },
        ledger,
        now,
      });
      return Result.isSuccess(planned) && planned.success[0]?.type === "ledger.item.updated"
        ? planned.success[0].payload.item
        : undefined;
    };
    const first = record(ledgerWith(), "fail");
    assert.equal(first?.judgements, 1);
    const second = record(
      { ...ledgerWith(), items: [item({ ...first, evidence: "second run", verdict: null })] },
      "fail",
    );
    assert.equal(second?.judgements, 2);
  });

  it("refuses a verdict for evidence that changed while the judge was working", () => {
    const record = (judgedEvidence: string | null): LedgerCommand => ({
      type: "ledger.item.verdict.record",
      commandId: CommandId.make("command:plan:judged"),
      threadId,
      ledgerId,
      itemId,
      verdict: verdict("pass"),
      judgedEvidence,
    });
    const stale = planLedgerCommand({ command: record("an older run"), ledger: ledgerWith(), now });
    assert.isTrue(Result.isFailure(stale));
    assert.include(Result.isFailure(stale) ? stale.failure : "", "evidence changed");
    assert.isTrue(
      Result.isSuccess(
        planLedgerCommand({ command: record("ran the suite"), ledger: ledgerWith(), now }),
      ),
    );
  });
});

describe("planLedgerCommand no-ops", () => {
  it("plans nothing for a checkpoint already in the requested state or an unchanged item", () => {
    const ledger: Ledger = {
      ...ledgerWith(),
      checkpoints: [
        {
          id: "checkpoint:plan" as Ledger["checkpoints"][number]["id"],
          title: "Reached",
          reached: true,
          reachedAt: earlier,
        },
      ],
    };
    const checkpoint = planLedgerCommand({
      command: {
        type: "ledger.checkpoint.set",
        commandId: CommandId.make("command:plan:checkpoint"),
        threadId,
        ledgerId,
        checkpointId: ledger.checkpoints[0]!.id,
        reached: true,
      },
      ledger,
      now,
    });
    assert.deepEqual(Result.isSuccess(checkpoint) ? checkpoint.success : "failed", []);

    const unchanged = planLedgerCommand({
      command: { ...closeItem, status: "in_progress" },
      ledger,
      now,
    });
    assert.deepEqual(Result.isSuccess(unchanged) ? unchanged.success : "failed", []);
  });
});
