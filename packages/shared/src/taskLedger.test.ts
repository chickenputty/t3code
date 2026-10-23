import { describe, expect, it } from "vite-plus/test";
import {
  type Ledger,
  type LedgerItem,
  LedgerCheckpointId,
  LedgerId,
  LedgerItemId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  applyLedgerEvent,
  decideLedgerAutoContinue,
  LEDGER_AUTO_CONTINUE_CAP,
  type LedgerDomainEvent,
} from "./taskLedger.ts";

const at = (seconds: number) => DateTime.makeUnsafe(Date.UTC(2026, 0, 1, 0, 0, seconds));
const threadId = ThreadId.make("thread:ledger-reducer");
const ledgerId = LedgerId.make("ledger:reducer");
const base = { threadId, id: "event" as LedgerDomainEvent["id"], occurredAt: at(0) };

const item = (name: string, overrides: Partial<LedgerItem> = {}): LedgerItem => ({
  id: LedgerItemId.make(`item:${name}`),
  title: name,
  acceptance: "",
  status: "open",
  evidence: null,
  dropReason: null,
  verdict: null,
  createdAt: at(0),
  updatedAt: at(0),
  closedAt: null,
  ...overrides,
});

const created: Ledger = {
  id: ledgerId,
  threadId,
  title: "Reducer",
  startState: "",
  checkpoints: [
    {
      id: LedgerCheckpointId.make("checkpoint:one"),
      title: "One",
      reached: false,
      reachedAt: null,
    },
  ],
  winConditions: [],
  items: [item("a")],
  createdAt: at(0),
  updatedAt: at(0),
  closedAt: null,
};

describe("applyLedgerEvent", () => {
  it("folds every event kind into the ledger", () => {
    const events: ReadonlyArray<LedgerDomainEvent> = [
      { ...base, type: "ledger.created", payload: created },
      {
        ...base,
        type: "ledger.item.added",
        payload: { ledgerId, items: [item("b")], updatedAt: at(1) },
      },
      {
        ...base,
        type: "ledger.item.updated",
        payload: {
          ledgerId,
          item: item("a", {
            status: "closed",
            evidence: "done",
            closedAt: at(2),
            updatedAt: at(2),
          }),
          updatedAt: at(2),
        },
      },
      {
        ...base,
        type: "ledger.checkpoint.updated",
        payload: {
          ledgerId,
          checkpoint: { ...created.checkpoints[0]!, reached: true, reachedAt: at(3) },
          updatedAt: at(3),
        },
      },
      { ...base, type: "ledger.closed", payload: { ledgerId, closedAt: at(4), updatedAt: at(4) } },
    ];
    const ledger = events.reduce<Ledger | undefined>(applyLedgerEvent, undefined);
    expect(ledger?.items.map((entry) => [entry.id, entry.status])).toEqual([
      [LedgerItemId.make("item:a"), "closed"],
      [LedgerItemId.make("item:b"), "open"],
    ]);
    expect(ledger?.checkpoints[0]?.reached).toBe(true);
    expect(ledger?.closedAt).toEqual(at(4));
    expect(ledger?.updatedAt).toEqual(at(4));

    const reopened = applyLedgerEvent(ledger, {
      ...base,
      type: "ledger.reopened",
      payload: { ledgerId, updatedAt: at(5) },
    });
    expect(reopened?.closedAt).toBeNull();
    expect(reopened?.updatedAt).toEqual(at(5));
  });

  it("ignores events before a ledger exists and for a ledger it no longer holds", () => {
    const added: LedgerDomainEvent = {
      ...base,
      type: "ledger.item.added",
      payload: { ledgerId, items: [item("b")], updatedAt: at(1) },
    };
    expect(applyLedgerEvent(undefined, added)).toBeUndefined();
    expect(
      applyLedgerEvent(created, {
        ...added,
        payload: { ...added.payload, ledgerId: LedgerId.make("ledger:other") },
      } as LedgerDomainEvent),
    ).toBe(created);
  });

  it("replaces a closed ledger when a new one is created", () => {
    const replacement: Ledger = { ...created, id: LedgerId.make("ledger:next"), items: [] };
    expect(
      applyLedgerEvent(created, { ...base, type: "ledger.created", payload: replacement }),
    ).toBe(replacement);
  });
});

describe("decideLedgerAutoContinue", () => {
  type Message = Parameters<typeof decideLedgerAutoContinue>[0]["messages"][number];
  const userMessage: Message = { role: "user", createdBy: "user", creationSource: "web" };
  const followUp = (round: number, statuses: ReadonlyArray<[string, LedgerItem["status"]]>) =>
    ({
      role: "user",
      createdBy: "agent",
      creationSource: "server",
      notification: {
        source: {
          kind: "ledger_continue",
          round,
          items: statuses.map(([name, status]) => ({
            id: LedgerItemId.make(`item:${name}`),
            status,
          })),
        },
        outcome: "updated",
        summary: "open",
      },
    }) satisfies Message;
  const withItems = (...items: ReadonlyArray<LedgerItem>): Ledger => ({ ...created, items });

  it("is idle without open items", () => {
    expect(decideLedgerAutoContinue({ ledger: undefined, messages: [] })).toEqual({
      type: "idle",
    });
    expect(
      decideLedgerAutoContinue({
        ledger: withItems(item("a", { status: "closed" }), item("b", { status: "dropped" })),
        messages: [],
      }),
    ).toEqual({ type: "idle" });
    expect(
      decideLedgerAutoContinue({
        ledger: { ...withItems(item("a")), closedAt: at(1) },
        messages: [],
      }),
    ).toEqual({ type: "idle" });
  });

  it("starts at round one and names only the open items", () => {
    const decision = decideLedgerAutoContinue({
      ledger: withItems(
        item("a"),
        item("b", { status: "in_progress" }),
        item("c", { status: "closed" }),
      ),
      messages: [userMessage],
    });
    expect(decision).toMatchObject({ type: "continue", round: 1 });
    expect(decision.type === "continue" ? decision.open.map((entry) => entry.id) : []).toEqual([
      "item:a",
      "item:b",
    ]);
  });

  it("counts rounds since the user last spoke and ignores other server wakes", () => {
    const serverWake: Message = { role: "user", createdBy: "user", creationSource: "server" };
    const decision = decideLedgerAutoContinue({
      ledger: withItems(item("a"), item("b", { status: "in_progress" })),
      messages: [
        userMessage,
        followUp(1, [
          ["a", "open"],
          ["b", "open"],
        ]),
        serverWake,
        followUp(2, [
          ["a", "open"],
          ["b", "open"],
          ["c", "open"],
        ]),
      ],
    });
    expect(decision).toMatchObject({ type: "continue", round: 3 });
  });

  it("stops at the cap even while items keep moving", () => {
    const rounds = Array.from({ length: LEDGER_AUTO_CONTINUE_CAP }, (_, index) =>
      followUp(index + 1, [
        ["a", "open"],
        [`extra-${index}`, "open"],
      ]),
    );
    expect(
      decideLedgerAutoContinue({
        ledger: withItems(item("a")),
        messages: [userMessage, ...rounds],
      }),
    ).toEqual({ type: "stuck", reason: "cap", openIds: [LedgerItemId.make("item:a")] });
  });

  it("stops when no item changed since the previous follow-up", () => {
    expect(
      decideLedgerAutoContinue({
        ledger: withItems(item("a"), item("b", { status: "closed" })),
        messages: [
          userMessage,
          followUp(1, [
            ["a", "open"],
            ["b", "closed"],
          ]),
        ],
      }),
    ).toEqual({ type: "stuck", reason: "stalled", openIds: [LedgerItemId.make("item:a")] });
    expect(
      decideLedgerAutoContinue({
        ledger: withItems(item("a", { status: "in_progress" }), item("b", { status: "closed" })),
        messages: [
          userMessage,
          followUp(1, [
            ["a", "open"],
            ["b", "closed"],
          ]),
        ],
      }).type,
    ).toBe("continue");
  });

  it("stays quiet after the user cancels a follow-up, until they speak again", () => {
    const cancelled = { ...followUp(1, [["a", "open"]]), runId: RunId.make("run:cancelled") };
    const cancelledRunIds = new Set(["run:cancelled"]);
    const ledger = withItems(item("a", { status: "in_progress" }));
    expect(
      decideLedgerAutoContinue({ ledger, messages: [userMessage, cancelled], cancelledRunIds }),
    ).toEqual({ type: "idle" });
    expect(
      decideLedgerAutoContinue({
        ledger,
        messages: [cancelled, userMessage],
        cancelledRunIds,
      }).type,
    ).toBe("continue");
  });

  it("starts over after a user message", () => {
    expect(
      decideLedgerAutoContinue({
        ledger: withItems(item("a")),
        messages: [followUp(1, [["a", "open"]]), userMessage],
      }),
    ).toMatchObject({ type: "continue", round: 1 });
  });
});
