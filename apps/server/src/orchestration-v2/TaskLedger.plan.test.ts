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
