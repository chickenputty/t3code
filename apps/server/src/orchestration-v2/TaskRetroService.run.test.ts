import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type TaskRetro,
  type TaskTimingSummary,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TaskRetros from "../persistence/TaskRetros.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as TaskRetroService from "./TaskRetroService.ts";
import * as TaskTimingService from "./TaskTimingService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const codex = ProviderInstanceId.make("codex");
const adapter = {
  instanceId: codex,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  // The provider never answers, which is how a failed retro run looks to the service.
  openSession: () => Effect.die("The retro model is unavailable"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const snapshot: ServerProvider = {
  instanceId: codex,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-06-17T00:00:00.000Z",
  models: [{ slug: "gpt-5.4", name: "gpt-5.4", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
};

const projectId = ProjectId.make("project:retro-run");
const subjectId = ThreadId.make("thread:retro-run-subject");

const timing: TaskTimingSummary = {
  threadId: subjectId,
  generatedAt: "2026-01-01T00:00:00.000Z",
  stallThresholdMs: 60_000,
  runCount: 1,
  delegatedCount: 0,
  stallCount: 0,
  totals: { wallMs: 1, agentMs: 1, queueMs: 0, delegatedMs: 0, stalledMs: 0, waitingOnUserMs: 0 },
  delegatedBy: [],
  slowestRuns: [],
  slowestDelegated: [],
  longestStalls: [],
  ledgerItems: [],
};

const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
  { name: "task-retro-run" },
  ProviderAdapterRegistry.layerFromAdapters([adapter]),
  { databaseLayer: SqlitePersistence.layerMemory, runEffectWorker: false },
);
const layerSettings = ServerSettings.layerTest();
const layerThreads = ThreadManagementService.layer.pipe(
  Layer.provideMerge(layerOrchestrator),
  Layer.provide(layerSettings),
  Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory))),
);
// The retro's own wait is the only one that gets a reply here: the model never answers, so it
// reports the timeout it would have hit after five minutes, without the test waiting for it.
const layerTimedOutThreads = Layer.effect(
  ThreadManagementService.ThreadManagementService,
  Effect.gen(function* () {
    const real = yield* ThreadManagementService.ThreadManagementService;
    return ThreadManagementService.ThreadManagementService.of({
      ...real,
      waitForThread: (input) =>
        Effect.succeed({ threadId: input.threadId, run: null, timedOut: true }),
    });
  }),
).pipe(Layer.provide(layerThreads));
const layerTest = TaskRetroService.layer.pipe(
  Layer.provide(layerTimedOutThreads),
  Layer.provideMerge(layerThreads),
  Layer.provide(TaskRetros.layer),
  Layer.provide(
    Layer.mock(TaskTimingService.TaskTimingService)({ summary: () => Effect.succeed(timing) }),
  ),
  Layer.provide(ProviderRegistryMock.layer([snapshot])),
  Layer.provide(layerSettings),
  Layer.provide(NodeCrypto.layer),
  Layer.provideMerge(TaskRetros.layer),
  Layer.provide(SqlitePersistence.layerMemory),
);

const create = (
  threadId: ThreadId,
  who: {
    createdBy: "user" | "agent" | "system";
    creationSource: "web" | "mobile" | "mcp" | "server";
  },
  lineage?: { parentThreadId: ThreadId; relationshipToParent: "subagent" },
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`command:retro-run:${threadId}`),
      threadId,
      projectId,
      title: "Subject",
      modelSelection: { instanceId: codex, model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      ...who,
      ...(lineage === undefined ? {} : { lineage }),
    });
  });

const setup = Effect.gen(function* () {
  yield* create(subjectId, { createdBy: "user", creationSource: "web" });
  return {
    service: yield* TaskRetroService.TaskRetroService,
    threads: yield* ThreadManagementService.ThreadManagementService,
    store: yield* TaskRetros.TaskRetroRepository,
  };
});

const retroThreads = (threads: ThreadManagementService.ThreadManagementService["Service"]) =>
  threads.getShellSnapshot().pipe(
    Effect.map(({ threads: active, archivedThreads }) => ({
      active: active.filter(({ id }) => id.startsWith("thread:retro:")),
      archived: archivedThreads.filter(({ id }) => id.startsWith("thread:retro:")),
    })),
  );

it.effect("a client cannot give a new thread a parent, but the server can", () =>
  Effect.gen(function* () {
    yield* setup;
    const lineage = { parentThreadId: subjectId, relationshipToParent: "subagent" } as const;
    // Only system/server may set it: every other actor and source pair is refused, including a
    // client claiming to be the server (the server rewrites a client's provenance to user).
    const others = [
      { createdBy: "user", creationSource: "web" },
      { createdBy: "user", creationSource: "mobile" },
      { createdBy: "user", creationSource: "server" },
      { createdBy: "agent", creationSource: "mcp" },
      { createdBy: "agent", creationSource: "server" },
      { createdBy: "system", creationSource: "web" },
    ] as const;
    for (const [index, who] of others.entries()) {
      const refused = yield* Effect.exit(
        create(ThreadId.make(`thread:hide-me-${index}`), who, lineage),
      );
      expect(Exit.isFailure(refused)).toBe(true);
    }

    const childId = ThreadId.make("thread:retro:child");
    yield* create(childId, { createdBy: "system", creationSource: "server" }, lineage);
    const threads = yield* ThreadManagementService.ThreadManagementService;
    expect((yield* threads.getThreadShell(childId))?.lineage).toEqual({
      parentThreadId: subjectId,
      relationshipToParent: "subagent",
      rootThreadId: subjectId,
    });
    // A thread created the old way, with no lineage field, is a plain top-level thread.
    expect((yield* threads.getThreadShell(subjectId))?.lineage).toEqual({
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: subjectId,
    });
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "a retro whose model fails stores nothing and leaves its thread hidden and archived",
  () =>
    Effect.gen(function* () {
      const { service, threads, store } = yield* setup;
      const exit = yield* Effect.exit(service.run(subjectId, "user"));
      expect(Exit.isFailure(exit)).toBe(true);
      expect((yield* store.list({})).length).toBe(0);

      const { active, archived } = yield* retroThreads(threads);
      expect(active).toEqual([]);
      expect(archived).toHaveLength(1);
      // The retro thread is the subject's hidden subagent child, not a top-level thread.
      expect(archived[0]!.lineage).toMatchObject({
        parentThreadId: subjectId,
        relationshipToParent: "subagent",
      });
    }).pipe(Effect.provide(layerTest)),
);

it.effect("a user's retry right after a failed retro starts a fresh retro thread", () =>
  Effect.gen(function* () {
    const { service, threads } = yield* setup;
    expect(Exit.isFailure(yield* Effect.exit(service.run(subjectId, "user")))).toBe(true);
    expect(Exit.isFailure(yield* Effect.exit(service.run(subjectId, "user")))).toBe(true);
    // Each press made its own thread. Rejoining the first would have replayed its stopped run.
    const { active, archived } = yield* retroThreads(threads);
    expect(active).toEqual([]);
    expect(new Set(archived.map(({ id }) => id)).size).toBe(2);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("the startup sweep archives a retro thread that nothing is running", () =>
  Effect.gen(function* () {
    const { service, threads } = yield* setup;
    yield* create(
      ThreadId.make("thread:retro:left-behind"),
      { createdBy: "system", creationSource: "server" },
      { parentThreadId: subjectId, relationshipToParent: "subagent" },
    );
    // A retro thread this young may be between its create and its send.
    expect(yield* service.sweep()).toBe(0);
    yield* TestClock.adjust("2 minutes");
    expect(yield* service.sweep()).toBe(1);
    expect((yield* retroThreads(threads)).archived).toHaveLength(1);
    expect(yield* service.sweep()).toBe(0);
    // The subject thread is not a retro thread and is left alone.
    expect((yield* threads.getThreadShell(subjectId))?.archivedAt ?? null).toBeNull();
  }).pipe(Effect.provide(layerTest)),
);

it.effect("an agent is refused inside the cooldown, with no thread created", () =>
  Effect.gen(function* () {
    const { service, threads, store } = yield* setup;
    const recent: TaskRetro = {
      threadId: subjectId,
      projectId,
      run: 1,
      createdAt: DateTime.formatIso(yield* DateTime.now),
      judge: { instanceId: codex, model: "gpt-5.4" },
      summary: "",
      parsed: false,
      slowCauses: [],
      modelVerdicts: [],
      structure: null,
      recommendations: [],
    };
    yield* store.put(recent);
    const exit = yield* Effect.exit(service.run(subjectId, "agent"));
    expect(Exit.isFailure(exit)).toBe(true);
    const { active, archived } = yield* retroThreads(threads);
    expect([...active, ...archived]).toEqual([]);
    expect((yield* store.get(subjectId))._tag).toBe("Some");
  }).pipe(Effect.provide(layerTest)),
);
