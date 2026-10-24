import { assert, it } from "@effect/vitest";
import {
  EventId,
  LedgerId,
  LedgerItemId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type LedgerItem,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as TaskTimingService from "./TaskTimingService.ts";

const layerTest = TaskTimingService.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(ProjectionStore.layer, EventStore.layer, ProjectStore.layer)),
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const T0 = Date.UTC(2026, 9, 1);
const at = (seconds: number) => DateTime.makeUnsafe(T0 + seconds * 1000);
const iso = (seconds: number) => DateTime.formatIso(at(seconds));
const seconds = (count: number) => count * 1000;

const instanceId = ProviderInstanceId.make("claudeAgent");
const driver = ProviderDriverKind.make("claudeAgent");
const projectId = ProjectId.make("project:timing");
const parentId = ThreadId.make("thread:timing-parent");
const childId = ThreadId.make("thread:timing-child");
const ledgerId = LedgerId.make("ledger:timing");
const taskId = NodeId.make("node:timing-task");

const envelope = (threadId: ThreadId, name: string, whenSeconds: number) => ({
  id: EventId.make(`${name}:${threadId}`),
  threadId,
  providerInstanceId: instanceId,
  occurredAt: at(whenSeconds),
});

const thread = (id: ThreadId): OrchestrationV2DomainEvent => ({
  ...envelope(id, "created", 0),
  type: "thread.created",
  payload: {
    createdBy: "user",
    creationSource: "web",
    id,
    projectId,
    title: id,
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "opus" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    forkedFrom: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  } satisfies OrchestrationV2AppThread,
});

const message = (
  threadId: ThreadId,
  id: string,
  creationSource: "web" | "server",
  whenSeconds: number,
): OrchestrationV2DomainEvent => ({
  ...envelope(threadId, `message:${id}`, whenSeconds),
  type: "message.updated",
  payload: {
    createdBy: creationSource === "web" ? "user" : "system",
    creationSource,
    id: MessageId.make(id),
    threadId,
    runId: null,
    nodeId: null,
    role: "user",
    text: id,
    attachments: [],
    streaming: false,
    createdAt: at(whenSeconds),
    updatedAt: at(whenSeconds),
  },
});

const runEvent = (
  threadId: ThreadId,
  ordinal: number,
  times: { requested: number; started: number; completed: number },
  extra: Partial<OrchestrationV2Run> = {},
): OrchestrationV2DomainEvent => ({
  ...envelope(threadId, `run:${ordinal}`, times.requested),
  type: "run.created",
  payload: {
    id: RunId.make(`run:${threadId}:${ordinal}`),
    threadId,
    ordinal,
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "opus" },
    providerThreadId: null,
    userMessageId: MessageId.make(`message:${threadId}:${ordinal}`),
    rootNodeId: null,
    activeAttemptId: null,
    status: "completed",
    requestedAt: at(times.requested),
    startedAt: at(times.started),
    completedAt: at(times.completed),
    checkpointId: null,
    contextHandoffId: null,
    ...extra,
  },
});

const item = (patch: Partial<LedgerItem>): LedgerItem => ({
  id: LedgerItemId.make("L1"),
  title: "Ship it",
  acceptance: "",
  status: "open",
  evidence: null,
  dropReason: null,
  verdict: null,
  createdAt: at(20),
  updatedAt: at(20),
  closedAt: null,
  ...patch,
});

const itemUpdated = (whenSeconds: number, next: LedgerItem): OrchestrationV2DomainEvent => ({
  ...envelope(parentId, `ledger-item:${whenSeconds}`, whenSeconds),
  type: "ledger.item.updated",
  payload: { ledgerId, item: next, updatedAt: at(whenSeconds) },
});

it.layer(layerTest)("TaskTimingService", (it) => {
  it.effect("derives runs, a delegated task and ledger item timing from the stores", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const events = yield* EventStore.EventStoreV2;
      const projects = yield* ProjectStore.ProjectStoreV2;
      const timing = yield* TaskTimingService.TaskTimingService;
      yield* projects.apply({
        sequence: 0,
        eventId: EventId.make("created:project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: iso(0),
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "project.created",
        payload: {
          projectId,
          title: projectId,
          workspaceRoot: "/work/timing",
          defaultModelSelection: null,
          scripts: [],
          createdAt: iso(0),
          updatedAt: iso(0),
        },
      });

      const childRun = runEvent(
        childId,
        1,
        { requested: 10, started: 20, completed: 80 },
        { delegatedTaskId: taskId },
      );
      const ledgerEvents: ReadonlyArray<OrchestrationV2DomainEvent> = [
        {
          ...envelope(parentId, "ledger-created", 20),
          type: "ledger.created",
          payload: {
            id: ledgerId,
            threadId: parentId,
            title: "Timing",
            startState: "",
            checkpoints: [],
            winConditions: [],
            items: [item({})],
            createdAt: at(20),
            updatedAt: at(20),
            closedAt: null,
          },
        },
        itemUpdated(40, item({ status: "in_progress", updatedAt: at(40) })),
        itemUpdated(
          100,
          item({
            status: "closed",
            evidence: "done",
            updatedAt: at(100),
            closedAt: at(100),
          }),
        ),
      ];
      const fixtures: ReadonlyArray<OrchestrationV2DomainEvent> = [
        thread(parentId),
        thread(childId),
        message(parentId, `message:${parentId}:1`, "web", 0),
        message(parentId, `message:${parentId}:2`, "server", 305),
        runEvent(parentId, 1, { requested: 0, started: 5, completed: 125 }),
        runEvent(parentId, 2, { requested: 305, started: 305, completed: 365 }),
        childRun,
        {
          ...envelope(parentId, "task", 10),
          type: "subagent.updated",
          payload: {
            id: taskId,
            threadId: parentId,
            runId: RunId.make(`run:${parentId}:1`),
            parentNodeId: NodeId.make("node:timing-root"),
            origin: "app_owned",
            createdBy: "agent",
            driver,
            providerInstanceId: instanceId,
            providerThreadId: null,
            childThreadId: childId,
            nativeTaskRef: null,
            prompt: "Do the work.",
            title: null,
            model: "sonnet",
            role: "worker",
            status: "completed",
            result: null,
            startedAt: at(10),
            completedAt: at(80),
            updatedAt: at(80),
          },
        },
        ...ledgerEvents,
      ];
      yield* Effect.forEach(fixtures, projections.apply, { discard: true });
      yield* events.append({ events: ledgerEvents });
      yield* TestClock.setTime(T0 + seconds(700));

      const record = yield* timing.forThread(parentId);

      assert.deepEqual(
        record.runs.map((entry) => [entry.ordinal, entry.durationMs, entry.serverInitiated]),
        [
          [1, seconds(120), false],
          [2, seconds(60), true],
        ],
      );
      assert.deepEqual(
        record.delegated.map((entry) => [entry.role, entry.model, entry.durationMs, entry.waitMs]),
        [["worker", "sonnet", seconds(60), seconds(10)]],
      );
      // The item changes come from the event log; the projection keeps only the last state.
      assert.deepEqual(
        record.ledgerItems.map((entry) => [
          entry.startedAt,
          entry.inProgressMs,
          entry.openToCloseMs,
        ]),
        [[iso(40), seconds(60), seconds(80)]],
      );
      assert.deepEqual(
        record.stalls.map((stall) => [stall.kind, stall.durationMs]),
        // Run 2 moved nothing, but the only item had closed, so there was nothing to move.
        [["idle_between_runs", seconds(180)]],
      );
      assert.equal(record.totals.wallMs, seconds(365));
    }),
  );
});
