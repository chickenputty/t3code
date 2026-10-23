import { describe, expect, it } from "vite-plus/test";
import {
  type Ledger,
  type LedgerItem,
  LedgerCheckpointId,
  LedgerId,
  LedgerItemId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { applyLedgerEvent, type LedgerDomainEvent } from "./taskLedger.ts";

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
