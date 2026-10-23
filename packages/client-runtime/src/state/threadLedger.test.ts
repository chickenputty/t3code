import {
  EnvironmentId,
  EventId,
  LedgerId,
  LedgerItemId,
  MessageId,
  type Ledger,
  type LedgerItem,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { applyOrchestrationV2ProjectionEvent } from "./orchestrationV2Projection.ts";
import { v2Now, v2Projection, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import { createEnvironmentThreadDetailAtoms } from "./threadDetail.ts";
import { deriveLedgerProgress, formatLedgerProgress } from "./threadLedger.ts";
import { EMPTY_ENVIRONMENT_THREAD_STATE } from "./threadState.ts";

const item = (id: string, status: LedgerItem["status"]): LedgerItem => ({
  id: LedgerItemId.make(id),
  title: id,
  acceptance: "",
  status,
  evidence: null,
  dropReason: null,
  verdict: null,
  createdAt: v2Now,
  updatedAt: v2Now,
  closedAt: null,
});

const ledgerOf = (statuses: ReadonlyArray<LedgerItem["status"]>, closed = false): Ledger => ({
  id: LedgerId.make("ledger"),
  threadId: v2ThreadId,
  title: "Ledger",
  startState: "",
  checkpoints: [],
  winConditions: [],
  items: statuses.map((status, index) => item(`item-${index}`, status)),
  createdAt: v2Now,
  updatedAt: v2Now,
  closedAt: closed ? v2Now : null,
});

describe("deriveLedgerProgress", () => {
  it("counts each status and treats open and in progress as remaining", () => {
    const progress = deriveLedgerProgress(
      ledgerOf(["closed", "closed", "in_progress", "open", "dropped"]),
    );
    expect(progress).toMatchObject({
      total: 5,
      closed: 2,
      dropped: 1,
      remaining: 2,
      active: true,
    });
  });

  it("is not active once every item is closed or dropped", () => {
    expect(deriveLedgerProgress(ledgerOf(["closed", "dropped"])).active).toBe(false);
  });

  it("is not active when the ledger is closed with items still open", () => {
    expect(deriveLedgerProgress(ledgerOf(["open"], true)).active).toBe(false);
  });
});

describe("formatLedgerProgress", () => {
  it("reads as done out of the items still in scope", () => {
    expect(formatLedgerProgress(deriveLedgerProgress(ledgerOf(Array(8).fill("open"))))).toBe(
      "0 of 8 done",
    );
    expect(
      formatLedgerProgress(
        deriveLedgerProgress(ledgerOf(["closed", "closed", "closed", "closed", "closed", "open"])),
      ),
    ).toBe("5 of 6 done");
  });

  it("leaves dropped items out of the total and says so", () => {
    expect(
      formatLedgerProgress(deriveLedgerProgress(ledgerOf(["closed", "open", "dropped"]))),
    ).toBe("1 of 2 done · 1 dropped");
  });

  it("handles a ledger with no items and one where everything was dropped", () => {
    expect(formatLedgerProgress(deriveLedgerProgress(ledgerOf([])))).toBe("No items yet");
    expect(formatLedgerProgress(deriveLedgerProgress(ledgerOf(["dropped", "dropped"])))).toBe(
      "All 2 dropped",
    );
  });
});

describe("ledgerAtom", () => {
  it("keeps its value through updates that leave the ledger alone", () => {
    const ledger = ledgerOf(["open"]);
    const projection: OrchestrationV2ThreadProjection = { ...v2Projection, ledger };
    const state = Atom.make(
      AsyncResult.success({ ...EMPTY_ENVIRONMENT_THREAD_STATE, data: Option.some(projection) }),
    );
    const details = createEnvironmentThreadDetailAtoms(() => state);
    const ref = { environmentId: EnvironmentId.make("env"), threadId: v2ThreadId };
    const registry = AtomRegistry.make();
    const seen: Array<Ledger | null> = [];
    const unmount = registry.subscribe(details.ledgerAtom(ref), (value) => seen.push(value), {
      immediate: true,
    });

    // A real message event produces a new projection that carries the same ledger object.
    const afterMessage = applyOrchestrationV2ProjectionEvent(projection, {
      id: EventId.make("event-message"),
      type: "message.updated",
      threadId: v2ThreadId,
      occurredAt: DateTime.add(v2Now, { seconds: 1 }),
      payload: {
        id: MessageId.make("message-1"),
        threadId: v2ThreadId,
        runId: null,
        nodeId: null,
        role: "assistant",
        text: "Streaming",
        streaming: true,
        attachments: [],
        createdBy: "agent",
        creationSource: "provider",
        createdAt: v2Now,
        updatedAt: v2Now,
      },
    } as OrchestrationV2DomainEvent);
    expect(afterMessage).not.toBe(projection);
    expect(afterMessage?.ledger).toBe(ledger);
    registry.set(
      state,
      AsyncResult.success({
        ...EMPTY_ENVIRONMENT_THREAD_STATE,
        data: Option.some(afterMessage!),
      }),
    );
    expect(seen).toEqual([ledger]);

    const updated = ledgerOf(["closed"]);
    registry.set(
      state,
      AsyncResult.success({
        ...EMPTY_ENVIRONMENT_THREAD_STATE,
        data: Option.some({ ...projection, ledger: updated }),
      }),
    );
    expect(seen).toEqual([ledger, updated]);
    unmount();
    registry.dispose();
  });

  it("is null for a thread without a ledger", () => {
    const state = Atom.make(
      AsyncResult.success({
        ...EMPTY_ENVIRONMENT_THREAD_STATE,
        data: Option.some(v2Projection),
      }),
    );
    const details = createEnvironmentThreadDetailAtoms(() => state);
    const ref = { environmentId: EnvironmentId.make("env"), threadId: v2ThreadId };
    const registry = AtomRegistry.make();
    const unmount = registry.mount(details.ledgerAtom(ref));
    expect(registry.get(details.ledgerAtom(ref))).toBeNull();
    unmount();
    registry.dispose();
  });
});
