import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  LedgerId,
  LedgerItemId,
  MessageId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import { LEDGER_AUTO_CONTINUE_CAP } from "@t3tools/shared/taskLedger";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventSink from "./EventSink.ts";
import { continueLedgerAfterRun, continueLedgerAfterRunSafely } from "./LedgerAutoContinue.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Auto-continue decisions never reach a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  IdAllocator.layer,
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "ledger-auto-continue" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

const ledgerId = LedgerId.make("ledger:auto");
const itemId = (name: string) => LedgerItemId.make(`item:${name}`);

let counter = 0;
const nextId = (prefix: string) => `${prefix}:${counter++}`;

const afterRun = (event: OrchestrationV2DomainEvent) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const eventSink = yield* EventSink.EventSinkV2;
    const ids = yield* IdAllocator.IdAllocatorV2;
    yield* continueLedgerAfterRun(
      { orchestrator, eventSink, ids },
      { threadId: event.threadId, runId: event.runId! },
    );
  });

const setup = (name: string, items: ReadonlyArray<string> = ["a", "b"]) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make(`thread:auto-continue:${name}`);
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(nextId("create")),
      threadId,
      projectId: ProjectId.make("project:auto-continue"),
      title: name,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    if (items.length > 0) {
      yield* orchestrator.dispatch({
        type: "ledger.create",
        commandId: CommandId.make(nextId("ledger")),
        threadId,
        ledgerId,
        title: "Ship it",
        startState: "nothing exists",
        checkpoints: [],
        winConditions: [],
        items: items.map((id) => ({
          id: itemId(id),
          title: `Item ${id}`,
          acceptance: `${id} works`,
        })),
      });
    }
    return threadId;
  });

const sendUserMessage = (
  threadId: ThreadId,
  dispatchMode: "start_immediately" | "queue_after_active" = "start_immediately",
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const id = nextId("user-message");
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(id),
      threadId,
      messageId: MessageId.make(id),
      text: "Do the work",
      attachments: [],
      dispatchMode: { type: dispatchMode },
      createdBy: "user",
      creationSource: "web",
    });
  });

const updateItem = (
  threadId: ThreadId,
  name: string,
  status: "closed" | "dropped" | "in_progress",
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "ledger.item.update",
      commandId: CommandId.make(nextId("update")),
      threadId,
      ledgerId,
      itemId: itemId(name),
      status,
      ...(status === "closed" ? { evidence: "verified" } : {}),
      ...(status === "dropped" ? { dropReason: "not needed" } : {}),
    });
  });

const addItem = (threadId: ThreadId, name: string, title = `Item ${name}`) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "ledger.item.add",
      commandId: CommandId.make(nextId("add")),
      threadId,
      ledgerId,
      items: [{ id: itemId(name), title, acceptance: `${name} works` }],
    });
  });

const projectionRuns = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    return (yield* projections.getThreadRecords(threadId, ["runs"])).runs;
  });

const latestRun = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const { runs } = yield* projections.getThreadRecords(threadId, ["runs"]);
    return runs.toSorted((a, b) => b.ordinal - a.ordinal)[0]!;
  });

/** Persists the run's terminal state the way finalization does, and returns the event it emitted. */
const endRun = (run: OrchestrationV2Run, status: OrchestrationV2Run["status"] = "completed") =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    yield* TestClock.adjust("1 second");
    const now = yield* DateTime.now;
    const event = {
      id: EventId.make(nextId("event:run-ended")),
      type: "run.updated",
      threadId: run.threadId,
      runId: run.id,
      occurredAt: now,
      payload: { ...run, status, completedAt: now },
    } satisfies OrchestrationV2DomainEvent;
    yield* eventSink.write({ events: [event] });
    return event;
  });

/** Ends the thread's latest run and lets the reactor see it. */
const completeLatest = (threadId: ThreadId, status: OrchestrationV2Run["status"] = "completed") =>
  Effect.gen(function* () {
    const event = yield* endRun(yield* latestRun(threadId), status);
    yield* afterRun(event);
    return event;
  });

const autoContinues = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const { messages } = yield* projections.getThreadRecords(threadId, ["messages"]);
    return messages.filter(
      (message: OrchestrationV2ConversationMessage) =>
        message.notification?.source.kind === "ledger_continue",
    );
  });

const roundOf = (message: OrchestrationV2ConversationMessage | undefined) =>
  message?.notification?.source.kind === "ledger_continue"
    ? message.notification.source.round
    : undefined;

const stopNotices = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const { turnItems } = yield* projections.getThreadRecords(threadId, ["turnItems"], {
      turnItemTypes: ["system_notice"],
    });
    return turnItems.flatMap((item) =>
      item.type === "system_notice" && item.message.startsWith("Stopped continuing the task ledger")
        ? [item.message]
        : [],
    );
  });

const isMarkedStuck = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const shell = yield* projections.getThreadShell(threadId);
    return (
      shell?.lastVisitedAt != null &&
      shell.latestRunCompletedAt != null &&
      DateTime.toEpochMillis(shell.lastVisitedAt) ===
        DateTime.toEpochMillis(shell.latestRunCompletedAt) - 1
    );
  });

it.effect("enqueues one follow-up naming the open items after a completed run", () =>
  Effect.gen(function* () {
    const threadId = yield* setup("trigger");
    yield* updateItem(threadId, "b", "closed");
    yield* addItem(threadId, "c");
    yield* updateItem(threadId, "c", "in_progress");
    yield* sendUserMessage(threadId);
    yield* completeLatest(threadId);

    const followUps = yield* autoContinues(threadId);
    assert.equal(followUps.length, 1);
    const message = followUps[0]!;
    assert.equal(message.role, "user");
    assert.equal(message.createdBy, "agent");
    assert.equal(message.creationSource, "server");
    assert.equal(roundOf(message), 1);
    assert.include(message.text, "item:a");
    assert.include(message.text, "Item a");
    assert.include(message.text, "a works");
    assert.include(message.text, "item:c");
    assert.notInclude(message.text, "item:b");
    assert.isFalse(yield* isMarkedStuck(threadId));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("does nothing for a replayed finalization of the same run", () =>
  Effect.gen(function* () {
    const threadId = yield* setup("replay");
    yield* sendUserMessage(threadId);
    const event = yield* completeLatest(threadId);
    yield* afterRun(event);
    yield* afterRun(event);
    assert.equal((yield* autoContinues(threadId)).length, 1);
  }).pipe(Effect.provide(layerTest)),
);

it.effect.each(["interrupted", "cancelled"] as const)(
  "does nothing when the run ends %s",
  (status) =>
    Effect.gen(function* () {
      const threadId = yield* setup(`ended-${status}`);
      yield* sendUserMessage(threadId);
      yield* completeLatest(threadId, status);
      assert.equal((yield* autoContinues(threadId)).length, 0);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("does nothing when the user stopped a run that still completed", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* setup("stop-race");
    yield* sendUserMessage(threadId);
    const run = yield* latestRun(threadId);
    yield* orchestrator.dispatch({
      type: "run.interrupt",
      commandId: CommandId.make(nextId("interrupt")),
      threadId,
      runId: run.id,
    });
    yield* completeLatest(threadId);
    assert.equal((yield* autoContinues(threadId)).length, 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("lets a message the user already queued go first", () =>
  Effect.gen(function* () {
    const threadId = yield* setup("user-queued");
    yield* sendUserMessage(threadId);
    const first = yield* latestRun(threadId);
    yield* sendUserMessage(threadId, "queue_after_active");
    yield* afterRun(yield* endRun(first));
    assert.equal((yield* autoContinues(threadId)).length, 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("waits while the run has a pending question or approval", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const threadId = yield* setup("pending-request");
    yield* sendUserMessage(threadId);
    const run = yield* latestRun(threadId);
    const now = yield* DateTime.now;
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(nextId("event:pending")),
          type: "runtime-request.updated",
          threadId,
          runId: run.id,
          occurredAt: now,
          payload: {
            id: RuntimeRequestId.make(nextId("request")),
            nodeId: run.rootNodeId!,
            providerTurnId: null,
            nativeRequestRef: null,
            kind: "user_input",
            status: "pending",
            responseCapability: {
              type: "live",
              providerSessionId: ProviderSessionId.make("session:auto-continue"),
            },
            createdAt: now,
            resolvedAt: null,
          },
        },
      ],
    });
    yield* afterRun(yield* endRun(run));
    assert.equal((yield* autoContinues(threadId)).length, 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect.each([
  ["no ledger", [], false],
  ["every item closed", ["a", "b"], true],
] as const)("does nothing with %s", ([, items, closeAll]) =>
  Effect.gen(function* () {
    const threadId = yield* setup(`no-open-${items.length}`, items);
    if (closeAll) {
      for (const name of items) yield* updateItem(threadId, name, "closed");
    }
    yield* sendUserMessage(threadId);
    yield* completeLatest(threadId);
    assert.equal((yield* autoContinues(threadId)).length, 0);
    assert.isFalse(yield* isMarkedStuck(threadId));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("does nothing once the ledger is closed", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* setup("closed-ledger");
    for (const name of ["a", "b"]) yield* updateItem(threadId, name, "dropped");
    yield* orchestrator.dispatch({
      type: "ledger.close",
      commandId: CommandId.make(nextId("close")),
      threadId,
      ledgerId,
    });
    yield* sendUserMessage(threadId);
    yield* completeLatest(threadId);
    assert.equal((yield* autoContinues(threadId)).length, 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("stops at the cap and marks the thread stuck", () =>
  Effect.gen(function* () {
    const threadId = yield* setup("cap");
    yield* sendUserMessage(threadId);
    for (let round = 1; round <= LEDGER_AUTO_CONTINUE_CAP; round += 1) {
      yield* completeLatest(threadId);
      const followUps = yield* autoContinues(threadId);
      assert.equal(followUps.length, round);
      assert.equal(roundOf(followUps.at(-1)), round);
      assert.isFalse(yield* isMarkedStuck(threadId));
      // New work each round, so only the cap can stop it.
      yield* addItem(threadId, `extra-${round}`);
    }
    assert.deepEqual(yield* stopNotices(threadId), []);
    yield* completeLatest(threadId);
    assert.equal((yield* autoContinues(threadId)).length, LEDGER_AUTO_CONTINUE_CAP);
    assert.isTrue(yield* isMarkedStuck(threadId));
    const [notice, ...others] = yield* stopNotices(threadId);
    assert.equal(others.length, 0);
    assert.include(notice, "Stopped continuing the task ledger: 7 items still open");
    assert.include(notice, "limit of 5");
    assert.include(notice, "Item a, Item b, Item extra-1 and 4 more.");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("stops when a round made no ledger progress and marks the thread stuck", () =>
  Effect.gen(function* () {
    const threadId = yield* setup("stall");
    yield* sendUserMessage(threadId);
    yield* completeLatest(threadId);
    assert.equal((yield* autoContinues(threadId)).length, 1);
    assert.isFalse(yield* isMarkedStuck(threadId));

    assert.deepEqual(yield* stopNotices(threadId), []);

    const event = yield* completeLatest(threadId);
    yield* afterRun(event);
    assert.equal((yield* autoContinues(threadId)).length, 1);
    assert.isTrue(yield* isMarkedStuck(threadId));
    const notices = yield* stopNotices(threadId);
    assert.equal(notices.length, 1);
    assert.include(notices[0], "Stopped continuing the task ledger: 2 items still open");
    assert.include(notices[0], "no progress last round");
    assert.include(notices[0], "Item a, Item b.");
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "stays off after the user cancels the queued follow-up, even for a later server wake",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = yield* setup("cancel-queued");
      yield* sendUserMessage(threadId);
      // A follow-up only queues when a run became live between the server's check and its send,
      // so recreate that: the same message the server sends, queued behind an active run.
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(nextId("queued-follow-up")),
        messageId: MessageId.make(nextId("message:ledger-continue")),
        threadId,
        text: "Continue the ledger",
        notification: {
          source: { kind: "ledger_continue", round: 1, items: [] },
          outcome: "updated",
          summary: "Task ledger: 2 open items",
        },
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
        createdBy: "agent",
        creationSource: "server",
      });
      const queued = yield* latestRun(threadId);
      assert.equal(queued.status, "queued");
      yield* orchestrator.dispatch({
        type: "queued-run.cancel",
        commandId: CommandId.make(nextId("cancel")),
        threadId,
        runId: queued.id,
      });
      assert.equal((yield* latestRun(threadId)).status, "cancelled");
      const active = (yield* projectionRuns(threadId)).find((run) => run.status !== "cancelled")!;
      yield* afterRun(yield* endRun(active));
      // Still one (the hand-made follow-up) because the cancelled run is newer than this one, so
      // the newer-run exit applies. The server-wake step below is what isolates the cancel rule.
      assert.equal((yield* autoContinues(threadId)).length, 1);

      const id = nextId("server-wake");
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(id),
        threadId,
        messageId: MessageId.make(id),
        text: "A background task finished",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "server",
      });
      yield* addItem(threadId, "fresh");
      yield* completeLatest(threadId);
      assert.equal((yield* autoContinues(threadId)).length, 1);

      yield* sendUserMessage(threadId);
      yield* completeLatest(threadId);
      assert.deepEqual((yield* autoContinues(threadId)).map(roundOf), [1, 1]);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("marks the thread unread when the follow-up itself fails", () =>
  Effect.gen(function* () {
    const dispatched: Array<string> = [];
    const orchestrator = {
      getThreadRecords: () => Effect.die("projection unavailable"),
      dispatch: (command: { readonly type: string }) =>
        Effect.sync(() => {
          dispatched.push(command.type);
        }),
    } as unknown as Parameters<typeof continueLedgerAfterRunSafely>[0]["orchestrator"];
    const unused = {} as never;
    yield* continueLedgerAfterRunSafely(
      { orchestrator, eventSink: unused, ids: unused },
      { threadId: ThreadId.make("thread:failing"), runId: RunId.make("run:failing") },
    );
    assert.deepEqual(dispatched, ["thread.mark-unread"]);
  }),
);

it.effect("keeps going while each round moves an item", () =>
  Effect.gen(function* () {
    const threadId = yield* setup("progress", ["a", "b", "c"]);
    yield* sendUserMessage(threadId);
    yield* completeLatest(threadId);
    yield* updateItem(threadId, "a", "in_progress");
    yield* completeLatest(threadId);
    yield* updateItem(threadId, "a", "closed");
    yield* completeLatest(threadId);
    const followUps = yield* autoContinues(threadId);
    assert.deepEqual(followUps.map(roundOf), [1, 2, 3]);
    assert.isFalse(yield* isMarkedStuck(threadId));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("starts counting again after a message from the user", () =>
  Effect.gen(function* () {
    const threadId = yield* setup("reset");
    yield* sendUserMessage(threadId);
    yield* completeLatest(threadId);
    yield* addItem(threadId, "x");
    yield* completeLatest(threadId);
    assert.deepEqual((yield* autoContinues(threadId)).map(roundOf), [1, 2]);

    yield* endRun(yield* latestRun(threadId));
    yield* addItem(threadId, "y");
    yield* sendUserMessage(threadId);
    yield* completeLatest(threadId);
    assert.deepEqual((yield* autoContinues(threadId)).map(roundOf), [1, 2, 1]);
  }).pipe(Effect.provide(layerTest)),
);

const serverWake = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const id = nextId("server-wake");
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(id),
      threadId,
      messageId: MessageId.make(id),
      text: "A background task finished",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "agent",
      creationSource: "server",
    });
  });

/** Runs one auto-continue round, then ends the follow-up run the way `stop` says. */
const stopFollowUp = (name: string, stop: "cancelled" | "user-interrupt" | "provider-interrupt") =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* setup(`stopped-follow-up-${name}`);
    yield* sendUserMessage(threadId);
    yield* completeLatest(threadId);
    const followUp = (yield* autoContinues(threadId))[0]!;
    const followUpRun = yield* latestRun(threadId);
    assert.equal(followUpRun.userMessageId, followUp.id);
    if (stop === "user-interrupt") {
      // The real stop path records the user's interrupt request next to the status.
      yield* orchestrator.dispatch({
        type: "run.interrupt",
        commandId: CommandId.make(nextId("interrupt")),
        threadId,
        runId: followUpRun.id,
      });
    } else {
      yield* completeLatest(threadId, stop === "cancelled" ? "cancelled" : "interrupted");
    }
    assert.equal((yield* autoContinues(threadId)).length, 1);
    yield* serverWake(threadId);
    yield* addItem(threadId, "fresh");
    yield* completeLatest(threadId);
    return yield* autoContinues(threadId);
  });

it.effect.each(["cancelled", "user-interrupt"] as const)(
  "does not continue again after the user ends the follow-up run (%s)",
  (stop) =>
    Effect.gen(function* () {
      assert.equal((yield* stopFollowUp(stop, stop)).length, 1);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps going after the provider ends the follow-up turn on its own", () =>
  Effect.gen(function* () {
    const followUps = yield* stopFollowUp("provider", "provider-interrupt");
    assert.deepEqual(followUps.map(roundOf), [1, 2]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("truncates a long item title in the stop notice", () =>
  Effect.gen(function* () {
    const threadId = yield* setup("long-title", ["a"]);
    const longTitle = "Rework the whole onboarding flow so every step explains itself clearly";
    yield* addItem(threadId, "long", longTitle);
    yield* sendUserMessage(threadId);
    yield* completeLatest(threadId);
    yield* completeLatest(threadId);
    const [notice] = yield* stopNotices(threadId);
    assert.include(notice, `${longTitle.slice(0, 47)}…`);
    assert.notInclude(notice, longTitle);
  }).pipe(Effect.provide(layerTest)),
);
