import { assert, it } from "@effect/vitest";
import {
  CommandId,
  LedgerCheckpointId,
  LedgerId,
  LedgerItemId,
  type Ledger,
  type LedgerItemStatus,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ThreadLoadout,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventStore from "./EventStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { planLedgerCommand } from "./TaskLedger.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Ledger commands never reach a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const claudeInstanceId = ProviderInstanceId.make("claudeAgent");
const claudeAdapter = {
  ...adapter,
  instanceId: claudeInstanceId,
  driver: ProviderDriverKind.make("claudeAgent"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerWith = (adapters: ReadonlyArray<ProviderAdapter.ProviderAdapterV2["Service"]>) =>
  Layer.mergeAll(
    layerDatabase,
    ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
    EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
    ProjectionMaintenance.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          layerDatabase,
          EventStore.layer.pipe(Layer.provide(layerDatabase)),
          ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
        ),
      ),
    ),
    ProviderReplayHarness.layerWithRegistry(
      { name: "task-ledger" },
      ProviderAdapterRegistry.layerFromAdapters(adapters),
      { databaseLayer: layerDatabase, runEffectWorker: false },
    ),
  );
const layerTest = layerWith([adapter, claudeAdapter]);
const layerWithoutJudgeInstance = layerWith([adapter]);

const ledgerId = LedgerId.make("ledger:main");
const itemId = (name: string) => LedgerItemId.make(`item:${name}`);
const checkpointId = (name: string) => LedgerCheckpointId.make(`checkpoint:${name}`);
const draft = (name: string) => ({
  id: itemId(name),
  title: `Item ${name}`,
  acceptance: `${name} works`,
});

let commandCounter = 0;
const nextCommandId = () => CommandId.make(`command:ledger:${commandCounter++}`);

const createThread = (name: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make(`thread:ledger:${name}`);
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: nextCommandId(),
      threadId,
      projectId: ProjectId.make("project:ledger"),
      title: name,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    return threadId;
  });

const ledgerOf = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return (yield* orchestrator.getThreadProjection(threadId)).ledger;
  });

const itemOf = (ledger: Ledger | undefined, name: string) =>
  ledger?.items.find((item) => item.id === itemId(name));

const createLedger = (
  threadId: ThreadId,
  overrides: { readonly id?: LedgerId; readonly items?: ReadonlyArray<string> } = {},
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "ledger.create",
      commandId: nextCommandId(),
      threadId,
      ledgerId: overrides.id ?? ledgerId,
      title: "Ship the ledger",
      startState: "nothing exists",
      checkpoints: [
        { id: checkpointId("contract"), title: "Contract merged" },
        { id: checkpointId("server"), title: "Server merged" },
      ],
      winConditions: ["tests pass"],
      items: (overrides.items ?? ["a", "b"]).map(draft),
    });
  });

const updateItem = (
  threadId: ThreadId,
  name: string,
  change: {
    readonly status?: LedgerItemStatus;
    readonly evidence?: string | null;
    readonly dropReason?: string | null;
  },
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "ledger.item.update",
      commandId: nextCommandId(),
      threadId,
      ledgerId,
      itemId: itemId(name),
      ...change,
    });
  });

const closeLedger = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "ledger.close",
      commandId: nextCommandId(),
      threadId,
      ledgerId,
    });
  });

const reopenLedger = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "ledger.reopen",
      commandId: nextCommandId(),
      threadId,
      ledgerId,
    });
  });

const addItems = (threadId: ThreadId, names: ReadonlyArray<string>, id: LedgerId = ledgerId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "ledger.item.add",
      commandId: nextCommandId(),
      threadId,
      ledgerId: id,
      items: names.map(draft),
    });
  });

const recordVerdict = (threadId: ThreadId, name: string, outcome: "pass" | "fail") =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "ledger.item.verdict.record",
      commandId: nextCommandId(),
      threadId,
      ledgerId,
      itemId: itemId(name),
      verdict: {
        outcome,
        judge: { instanceId, model: "gpt-5.1-codex" },
        notes: `${outcome} notes`,
        at: yield* DateTime.now,
      },
    });
  });

/** Asserts the command is rejected before commit and the ledger is unchanged. */
const assertRejected = (
  threadId: ThreadId,
  command: Effect.Effect<
    Orchestrator.OrchestratorV2DispatchResult,
    Orchestrator.OrchestratorV2Error,
    Orchestrator.OrchestratorV2
  >,
  detail: string,
) =>
  Effect.gen(function* () {
    const before = yield* ledgerOf(threadId);
    const exit = yield* Effect.exit(command);
    if (Exit.isSuccess(exit)) return assert.fail("Expected the command to be rejected");
    const error = Cause.squash(exit.cause) as Orchestrator.OrchestratorV2Error;
    assert.equal(error._tag, "OrchestratorDispatchError");
    assert.include(String((error as { readonly cause?: unknown }).cause), detail);
    assert.deepEqual(yield* ledgerOf(threadId), before);
  });

it.effect("creates a ledger with open items and unreached checkpoints at the command time", () =>
  Effect.gen(function* () {
    yield* TestClock.adjust("5 seconds");
    const now = yield* DateTime.now;
    const threadId = yield* createThread("create");
    yield* createLedger(threadId);
    const ledger = yield* ledgerOf(threadId);
    assert.ok(ledger);
    assert.equal(ledger.title, "Ship the ledger");
    assert.deepEqual(ledger.winConditions, ["tests pass"]);
    assert.deepEqual(
      ledger.items.map((item) => [item.id, item.status, item.evidence, item.closedAt]),
      [
        [itemId("a"), "open", null, null],
        [itemId("b"), "open", null, null],
      ],
    );
    assert.deepEqual(
      ledger.checkpoints.map((checkpoint) => [checkpoint.reached, checkpoint.reachedAt]),
      [
        [false, null],
        [false, null],
      ],
    );
    assert.deepEqual(ledger.createdAt, now);
    assert.deepEqual(ledger.updatedAt, now);
    assert.isNull(ledger.closedAt);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("allows one open ledger per thread and a replacement only after close", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("one-ledger");
    yield* createLedger(threadId, { items: [] });
    yield* assertRejected(
      threadId,
      createLedger(threadId, { id: LedgerId.make("ledger:second") }),
      "open ledger",
    );
    yield* closeLedger(threadId);
    yield* assertRejected(threadId, createLedger(threadId), "already used");
    yield* createLedger(threadId, { id: LedgerId.make("ledger:second"), items: ["x"] });
    const replaced = yield* ledgerOf(threadId);
    assert.equal(replaced?.id, LedgerId.make("ledger:second"));
    assert.deepEqual(
      replaced?.items.map((item) => item.id),
      [itemId("x")],
    );
    assert.isNull(replaced?.closedAt);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rejects duplicate ids when creating", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("create-duplicates");
    yield* assertRejected(threadId, createLedger(threadId, { items: ["a", "a"] }), "Duplicate");
    assert.isUndefined(yield* ledgerOf(threadId));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("adds items, rejecting unknown ledgers and duplicate item ids", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("add");
    yield* assertRejected(threadId, addItems(threadId, ["c"]), "no ledger");
    yield* createLedger(threadId);
    yield* addItems(threadId, ["c", "d"]);
    assert.deepEqual(
      (yield* ledgerOf(threadId))?.items.map((item) => item.id),
      ["a", "b", "c", "d"].map(itemId),
    );
    yield* assertRejected(threadId, addItems(threadId, ["a"]), "Duplicate");
    yield* assertRejected(threadId, addItems(threadId, ["e", "e"]), "Duplicate");
    yield* assertRejected(
      threadId,
      addItems(threadId, ["f"], LedgerId.make("ledger:other")),
      "Unknown",
    );
    yield* assertRejected(threadId, addItems(threadId, []), "at least one");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("walks an item through its legal transitions and stamps times", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("legal");
    yield* createLedger(threadId);

    yield* TestClock.adjust("1 second");
    const started = yield* DateTime.now;
    yield* updateItem(threadId, "a", { status: "in_progress" });
    assert.equal(itemOf(yield* ledgerOf(threadId), "a")?.status, "in_progress");
    assert.deepEqual(itemOf(yield* ledgerOf(threadId), "a")?.updatedAt, started);

    yield* TestClock.adjust("1 second");
    const closedAt = yield* DateTime.now;
    yield* updateItem(threadId, "a", { status: "closed", evidence: "vp test run passed" });
    const closed = itemOf(yield* ledgerOf(threadId), "a");
    assert.equal(closed?.status, "closed");
    assert.equal(closed?.evidence, "vp test run passed");
    assert.deepEqual(closed?.closedAt, closedAt);
    assert.deepEqual((yield* ledgerOf(threadId))?.updatedAt, closedAt);

    yield* updateItem(threadId, "a", { status: "open" });
    const reopened = itemOf(yield* ledgerOf(threadId), "a");
    assert.equal(reopened?.status, "open");
    assert.isNull(reopened?.closedAt);
    assert.isNull(reopened?.evidence);

    yield* updateItem(threadId, "a", { status: "in_progress" });
    yield* updateItem(threadId, "a", { status: "dropped", dropReason: "out of scope" });
    const dropped = itemOf(yield* ledgerOf(threadId), "a");
    assert.equal(dropped?.status, "dropped");
    assert.equal(dropped?.dropReason, "out of scope");
    assert.isNull(dropped?.closedAt);

    yield* updateItem(threadId, "a", { status: "open" });
    assert.isNull(itemOf(yield* ledgerOf(threadId), "a")?.dropReason);

    yield* updateItem(threadId, "b", { status: "dropped", dropReason: "duplicate of a" });
    assert.equal(itemOf(yield* ledgerOf(threadId), "b")?.status, "dropped");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("closes an open item in one update with evidence, and un-starts an in-progress one", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("shortcuts");
    yield* createLedger(threadId, { items: ["a", "b"] });
    yield* assertRejected(
      threadId,
      updateItem(threadId, "a", { status: "closed" }),
      "evidence in the same update",
    );
    yield* assertRejected(
      threadId,
      updateItem(threadId, "a", { status: "closed", evidence: " " }),
      "evidence",
    );
    yield* updateItem(threadId, "a", { status: "closed", evidence: "one-step fix, suite green" });
    const closed = itemOf(yield* ledgerOf(threadId), "a");
    assert.equal(closed?.status, "closed");
    assert.ok(closed?.closedAt);

    yield* updateItem(threadId, "b", { status: "in_progress", evidence: "half done" });
    yield* updateItem(threadId, "b", { status: "open" });
    const unstarted = itemOf(yield* ledgerOf(threadId), "b");
    assert.equal(unstarted?.status, "open");
    assert.equal(unstarted?.evidence, "half done");
  }).pipe(Effect.provide(layerTest)),
);

it.effect.each([
  ["closed", "in_progress"],
  ["closed", "dropped"],
  ["dropped", "in_progress"],
  ["dropped", "closed"],
] as const)("rejects the illegal transition %s -> %s", ([from, to]) =>
  Effect.gen(function* () {
    const threadId = yield* createThread(`illegal-${from}-${to}`);
    yield* createLedger(threadId, { items: ["a"] });
    yield* updateItem(threadId, "a", { status: "in_progress" });
    if (from === "closed") yield* updateItem(threadId, "a", { status: "closed", evidence: "done" });
    if (from === "dropped")
      yield* updateItem(threadId, "a", { status: "dropped", dropReason: "no" });
    yield* assertRejected(
      threadId,
      updateItem(threadId, "a", { status: to, evidence: "evidence", dropReason: "reason" }),
      `${from} to ${to}`,
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("requires evidence to close and a reason to drop", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("evidence");
    yield* createLedger(threadId, { items: ["a"] });
    yield* updateItem(threadId, "a", { status: "in_progress" });
    yield* assertRejected(threadId, updateItem(threadId, "a", { status: "closed" }), "evidence");
    yield* assertRejected(
      threadId,
      updateItem(threadId, "a", { status: "closed", evidence: "   " }),
      "evidence",
    );
    yield* assertRejected(
      threadId,
      updateItem(threadId, "a", { status: "closed", evidence: null }),
      "evidence",
    );
    yield* assertRejected(threadId, updateItem(threadId, "a", { status: "dropped" }), "dropReason");
    yield* assertRejected(
      threadId,
      updateItem(threadId, "a", { status: "dropped", dropReason: " " }),
      "dropReason",
    );
    // Evidence recorded earlier counts when the close itself carries none.
    yield* updateItem(threadId, "a", { evidence: "ran the suite" });
    yield* updateItem(threadId, "a", { status: "closed" });
    assert.equal(itemOf(yield* ledgerOf(threadId), "a")?.evidence, "ran the suite");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rejects updates to unknown ledgers and items", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("unknown");
    yield* assertRejected(
      threadId,
      updateItem(threadId, "a", { status: "in_progress" }),
      "no ledger",
    );
    yield* createLedger(threadId, { items: ["a"] });
    yield* assertRejected(
      threadId,
      updateItem(threadId, "missing", { status: "in_progress" }),
      "Unknown",
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("sets and clears checkpoints, rejecting unknown ones", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* createThread("checkpoints");
    yield* createLedger(threadId);
    const setReached = (id: LedgerCheckpointId, reached: boolean) =>
      orchestrator.dispatch({
        type: "ledger.checkpoint.set",
        commandId: nextCommandId(),
        threadId,
        ledgerId,
        checkpointId: id,
        reached,
      });
    yield* TestClock.adjust("2 seconds");
    const reachedAt = yield* DateTime.now;
    yield* setReached(checkpointId("contract"), true);
    const reached = (yield* ledgerOf(threadId))?.checkpoints[0];
    assert.equal(reached?.reached, true);
    assert.deepEqual(reached?.reachedAt, reachedAt);
    assert.equal((yield* ledgerOf(threadId))?.checkpoints[1]?.reached, false);

    yield* setReached(checkpointId("contract"), false);
    const cleared = (yield* ledgerOf(threadId))?.checkpoints[0];
    assert.equal(cleared?.reached, false);
    assert.isNull(cleared?.reachedAt);

    yield* assertRejected(threadId, setReached(checkpointId("missing"), true), "Unknown");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("closes only when every item is closed or dropped, then freezes the ledger", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("close");
    yield* createLedger(threadId);
    yield* assertRejected(threadId, closeLedger(threadId), "still open");
    yield* updateItem(threadId, "a", { status: "in_progress" });
    yield* updateItem(threadId, "a", { status: "closed", evidence: "done" });
    yield* assertRejected(threadId, closeLedger(threadId), "still open");
    yield* updateItem(threadId, "b", { status: "in_progress" });
    yield* assertRejected(threadId, closeLedger(threadId), "still open");
    yield* updateItem(threadId, "b", { status: "dropped", dropReason: "not needed" });

    yield* TestClock.adjust("3 seconds");
    const closedAt = yield* DateTime.now;
    yield* closeLedger(threadId);
    const closed = yield* ledgerOf(threadId);
    assert.deepEqual(closed?.closedAt, closedAt);
    assert.deepEqual(closed?.updatedAt, closedAt);

    yield* assertRejected(threadId, closeLedger(threadId), "already closed");
    yield* assertRejected(threadId, addItems(threadId, ["c"]), "closed");
    yield* assertRejected(threadId, updateItem(threadId, "a", { status: "open" }), "closed");
    yield* assertRejected(threadId, recordVerdict(threadId, "a", "pass"), "closed");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("reopens a closed ledger so it accepts changes again", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("reopen");
    yield* createLedger(threadId, { items: [] });
    yield* assertRejected(threadId, reopenLedger(threadId), "not closed");
    yield* closeLedger(threadId);
    yield* reopenLedger(threadId);
    assert.isNull((yield* ledgerOf(threadId))?.closedAt);
    yield* addItems(threadId, ["late"]);
    assert.deepEqual(
      (yield* ledgerOf(threadId))?.items.map((item) => item.id),
      [itemId("late")],
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("records a verdict without closing the item, and clears it on reopen", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("verdict");
    yield* createLedger(threadId, { items: ["a"] });
    yield* updateItem(threadId, "a", { status: "in_progress" });
    yield* recordVerdict(threadId, "a", "pass");
    const judged = itemOf(yield* ledgerOf(threadId), "a");
    assert.equal(judged?.verdict?.outcome, "pass");
    assert.equal(judged?.status, "in_progress");

    yield* recordVerdict(threadId, "a", "fail");
    assert.equal(itemOf(yield* ledgerOf(threadId), "a")?.verdict?.outcome, "fail");

    yield* updateItem(threadId, "a", { status: "closed", evidence: "done" });
    yield* assertRejected(threadId, recordVerdict(threadId, "a", "pass"), "closed");
    yield* updateItem(threadId, "a", { status: "open" });
    assert.isNull(itemOf(yield* ledgerOf(threadId), "a")?.verdict);

    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* assertRejected(
      threadId,
      orchestrator.dispatch({
        type: "ledger.item.verdict.record",
        commandId: nextCommandId(),
        threadId,
        ledgerId,
        itemId: itemId("missing"),
        verdict: {
          outcome: "pass",
          judge: { instanceId, model: "gpt-5.1-codex" },
          notes: "",
          at: yield* DateTime.now,
        },
      }),
      "Unknown",
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rebuilding the projection from events yields the same ledger", () =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const threadId = yield* createThread("replay");
    const otherThreadId = yield* createThread("replay-other");
    const withoutLedger = yield* projections.getThreadProjection(threadId);
    const stored: Array<OrchestrationV2DomainEvent> = [];
    const track = <E, R>(
      step: Effect.Effect<Orchestrator.OrchestratorV2DispatchResult, E, R>,
    ): Effect.Effect<void, E, R> =>
      Effect.map(step, (result) => {
        stored.push(...result.storedEvents.map(({ event }) => event));
      });
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* track(createLedger(threadId));
    yield* track(addItems(threadId, ["c"]));
    yield* TestClock.adjust("1 second");
    yield* track(updateItem(threadId, "a", { status: "in_progress" }));
    yield* track(recordVerdict(threadId, "a", "pass"));
    yield* track(updateItem(threadId, "a", { status: "closed", evidence: "done" }));
    yield* track(updateItem(threadId, "b", { status: "dropped", dropReason: "nope" }));
    yield* track(updateItem(threadId, "c", { status: "dropped", dropReason: "nope" }));
    yield* track(
      orchestrator.dispatch({
        type: "ledger.checkpoint.set",
        commandId: nextCommandId(),
        threadId,
        ledgerId,
        checkpointId: checkpointId("server"),
        reached: true,
      }),
    );
    yield* track(closeLedger(threadId));
    yield* track(reopenLedger(threadId));
    yield* track(closeLedger(threadId));
    const before = yield* ledgerOf(threadId);
    assert.ok(before?.closedAt);
    assert.deepEqual(
      stored.map((event) => event.type),
      [
        "ledger.created",
        "ledger.item.added",
        "ledger.item.updated",
        "ledger.item.updated",
        "ledger.item.updated",
        "ledger.item.updated",
        "ledger.item.updated",
        "ledger.checkpoint.updated",
        "ledger.closed",
        "ledger.reopened",
        "ledger.closed",
      ],
    );

    // The in-memory projection the replay state uses reaches the same ledger as the SQL rows.
    const folded = stored.reduce(ProjectionStore.applyToProjection, withoutLedger);
    assert.deepEqual(folded.ledger, before);

    const verification = yield* maintenance.rebuild;
    assert.isTrue(verification.valid);
    assert.deepEqual((yield* projections.getThreadProjection(threadId)).ledger, before);
    assert.isUndefined((yield* projections.getThreadProjection(otherThreadId)).ledger);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("accepts a redundant checkpoint command with no events and replays its receipt", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* createThread("redundant");
    yield* createLedger(threadId);
    const command = {
      type: "ledger.checkpoint.set" as const,
      commandId: nextCommandId(),
      threadId,
      ledgerId,
      checkpointId: checkpointId("contract"),
      reached: false,
    };
    const before = yield* ledgerOf(threadId);
    yield* TestClock.adjust("1 second");
    const first = yield* orchestrator.dispatch(command);
    assert.deepEqual(first.storedEvents, []);
    assert.deepEqual(yield* ledgerOf(threadId), before);

    yield* TestClock.adjust("1 second");
    const second = yield* orchestrator.dispatch(command);
    assert.deepEqual(second.storedEvents, []);
    assert.equal(second.sequence, first.sequence);
    assert.deepEqual(yield* ledgerOf(threadId), before);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("leaves the thread's updatedAt alone for every ledger event", () =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = yield* createThread("activity");
    const threadUpdatedAt = () =>
      Effect.map(
        orchestrator.getThreadProjection(threadId),
        (projection) => projection.thread.updatedAt,
      );
    const shellUpdatedAt = () =>
      Effect.map(projections.getThreadShell(threadId), (shell) => shell?.updatedAt);
    const baseline = yield* threadUpdatedAt();
    const baselineShell = yield* shellUpdatedAt();

    yield* TestClock.adjust("1 minute");
    yield* createLedger(threadId, { items: ["a"] });
    yield* updateItem(threadId, "a", { status: "in_progress" });
    yield* recordVerdict(threadId, "a", "pass");
    yield* updateItem(threadId, "a", { status: "closed", evidence: "done" });
    yield* closeLedger(threadId);
    yield* reopenLedger(threadId);

    assert.deepEqual(yield* threadUpdatedAt(), baseline);
    assert.deepEqual(yield* shellUpdatedAt(), baselineShell);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps a cheap open item count in step with the ledger, through a rebuild", () =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const threadId = yield* createThread("open-count");
    const count = () => projections.getOpenLedgerItemCount(threadId);
    assert.equal(yield* count(), 0);

    yield* createLedger(threadId, { items: ["a", "b"] });
    assert.equal(yield* count(), 2);
    yield* addItems(threadId, ["c"]);
    assert.equal(yield* count(), 3);
    yield* updateItem(threadId, "a", { status: "in_progress" });
    assert.equal(yield* count(), 3);
    yield* updateItem(threadId, "a", { status: "closed", evidence: "done" });
    assert.equal(yield* count(), 2);
    yield* updateItem(threadId, "b", { status: "dropped", dropReason: "no" });
    assert.equal(yield* count(), 1);
    yield* updateItem(threadId, "b", { status: "open" });
    assert.equal(yield* count(), 2);
    yield* updateItem(threadId, "b", { status: "dropped", dropReason: "no" });
    yield* updateItem(threadId, "c", { status: "closed", evidence: "done" });
    assert.equal(yield* count(), 0);
    yield* updateItem(threadId, "c", { status: "open" });
    assert.equal(yield* count(), 1);

    assert.isTrue((yield* maintenance.rebuild).valid);
    assert.equal(yield* count(), 1);

    // A ledger only closes with nothing unfinished, so closing reads 0 and reopening the ledger
    // keeps that; reopening an item then brings the count back.
    yield* updateItem(threadId, "c", { status: "closed", evidence: "done" });
    yield* closeLedger(threadId);
    assert.equal(yield* count(), 0);
    yield* reopenLedger(threadId);
    assert.equal(yield* count(), 0);
    yield* updateItem(threadId, "c", { status: "open" });
    assert.equal(yield* count(), 1);

    // Replacing a closed ledger counts only the new ledger's items.
    yield* updateItem(threadId, "c", { status: "closed", evidence: "done" });
    yield* closeLedger(threadId);
    yield* createLedger(threadId, { id: LedgerId.make("ledger:replacement"), items: ["x", "y"] });
    assert.equal(yield* count(), 2);
    assert.isTrue((yield* maintenance.rebuild).valid);
    assert.equal(yield* count(), 2);
  }).pipe(Effect.provide(layerTest)),
);

const setLoadout = (threadId: ThreadId, loadout: ThreadLoadout | null) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: nextCommandId(),
      threadId,
      loadout,
    });
  });

const loadoutOf = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return (yield* orchestrator.getThreadProjection(threadId)).thread.loadout ?? null;
  });

const judged: ThreadLoadout = {
  id: "planner-workers-judge",
  reason: "four independent modules",
  setBy: "agent",
};

it.effect("a user's loadout choice outranks an agent proposal, which can fill an empty slot", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("loadout-precedence");
    assert.isNull(yield* loadoutOf(threadId));

    yield* setLoadout(threadId, judged);
    assert.deepEqual(yield* loadoutOf(threadId), judged);

    const user: ThreadLoadout = { id: "read-only-sweep", reason: null, setBy: "user" };
    yield* setLoadout(threadId, user);
    assert.deepEqual(yield* loadoutOf(threadId), user);

    // The agent proposes again; the user's choice stands and the rejection says why.
    const exit = yield* Effect.exit(setLoadout(threadId, judged));
    assert.isTrue(Exit.isFailure(exit));
    assert.include(
      String(
        (Cause.squash((exit as Exit.Failure<unknown, unknown>).cause) as { cause?: unknown }).cause,
      ),
      "chose",
    );
    assert.deepEqual(yield* loadoutOf(threadId), user);

    // Only the user can hand the slot back.
    yield* setLoadout(threadId, null);
    assert.isNull(yield* loadoutOf(threadId));
    yield* setLoadout(threadId, judged);
    assert.deepEqual(yield* loadoutOf(threadId), judged);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rejects a loadout the project's settings do not list", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("loadout-unknown");
    const exit = yield* Effect.exit(
      setLoadout(threadId, { id: "no-such-loadout", reason: null, setBy: "user" }),
    );
    assert.isTrue(Exit.isFailure(exit));
    assert.include(
      String(
        (Cause.squash((exit as Exit.Failure<unknown, unknown>).cause) as { cause?: unknown }).cause,
      ),
      "Unknown loadout",
    );
    assert.isNull(yield* loadoutOf(threadId));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("does not stamp a gate no judge can satisfy", () =>
  Effect.gen(function* () {
    // The loadout names a judge on claudeAgent, but this environment has no such instance.
    const threadId = yield* createThread("judge-unresolvable");
    yield* setLoadout(threadId, judged);
    yield* createLedger(threadId, { items: ["a"] });
    assert.notOk((yield* ledgerOf(threadId))?.requiresJudge);
    yield* updateItem(threadId, "a", { status: "closed", evidence: "tests pass" });
    assert.equal(itemOf(yield* ledgerOf(threadId), "a")?.status, "closed");
  }).pipe(Effect.provide(layerWithoutJudgeInstance)),
);

it.effect("round trips the precedence rule: user sets, user clears, agent proposes", () =>
  Effect.gen(function* () {
    const threadId = yield* createThread("loadout-round-trip");
    const user: ThreadLoadout = { id: "solo", reason: null, setBy: "user" };
    yield* setLoadout(threadId, user);
    assert.isTrue(Exit.isFailure(yield* Effect.exit(setLoadout(threadId, judged))));
    yield* setLoadout(threadId, null);
    assert.isNull(yield* loadoutOf(threadId));
    yield* setLoadout(threadId, judged);
    assert.deepEqual(yield* loadoutOf(threadId), judged);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("fixes requiresJudge when the ledger is created and gates closing on a verdict", () =>
  Effect.gen(function* () {
    // Solo: no judge role, so an item closes on evidence alone.
    const solo = yield* createThread("judge-solo");
    yield* createLedger(solo, { items: ["a"] });
    assert.notOk((yield* ledgerOf(solo))?.requiresJudge);
    yield* updateItem(solo, "a", { status: "closed", evidence: "tests pass" });
    assert.equal(itemOf(yield* ledgerOf(solo), "a")?.status, "closed");

    // A loadout with a judge role: the ledger is born gated.
    const org = yield* createThread("judge-org");
    yield* setLoadout(org, judged);
    yield* createLedger(org, { items: ["a"] });
    assert.isTrue((yield* ledgerOf(org))?.requiresJudge);
    yield* assertRejected(
      org,
      updateItem(org, "a", { status: "closed", evidence: "tests pass" }),
      "passing judge verdict",
    );
    yield* updateItem(org, "a", { status: "in_progress", evidence: "tests pass" });
    yield* recordVerdict(org, "a", "fail");
    yield* assertRejected(org, updateItem(org, "a", { status: "closed" }), "passing judge verdict");
    yield* recordVerdict(org, "a", "pass");
    yield* updateItem(org, "a", { status: "closed" });
    assert.equal(itemOf(yield* ledgerOf(org), "a")?.status, "closed");

    // Switching to solo later does not un-gate a ledger that already exists.
    const switched = yield* createThread("judge-switched");
    yield* setLoadout(switched, judged);
    yield* createLedger(switched, { items: ["a"] });
    yield* setLoadout(switched, { id: "solo", reason: null, setBy: "user" });
    assert.isTrue((yield* ledgerOf(switched))?.requiresJudge);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "rejects a one-step close under the judge gate because new evidence clears the verdict",
  () =>
    Effect.gen(function* () {
      const threadId = yield* createThread("judge-one-step");
      yield* createLedger(threadId, { items: ["a"] });
      yield* updateItem(threadId, "a", { status: "in_progress", evidence: "first run" });
      yield* recordVerdict(threadId, "a", "pass");
      yield* updateItem(threadId, "a", { status: "open" });
      // Un-starting keeps the evidence and the verdict that judged it.
      assert.equal(itemOf(yield* ledgerOf(threadId), "a")?.verdict?.outcome, "pass");
      const result = planLedgerCommand({
        command: {
          type: "ledger.item.update",
          commandId: nextCommandId(),
          threadId,
          ledgerId,
          itemId: itemId("a"),
          status: "closed",
          evidence: "a second run",
        },
        ledger: yield* ledgerOf(threadId),
        now: yield* DateTime.now,
        requiresJudge: true,
      });
      assert.isTrue(Result.isFailure(result));
      assert.include(Result.isFailure(result) ? result.failure : "", "passing judge verdict");
    }).pipe(Effect.provide(layerTest)),
);
