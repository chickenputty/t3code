import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_LOADOUTS,
  type Loadout,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type TaskRetro,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

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
  openSession: () => Effect.die("Resolving a retro never reaches a provider"),
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
  models: [
    { slug: "gpt-5.4", name: "gpt-5.4", isCustom: false, capabilities: null },
    { slug: "gpt-5.4-mini", name: "gpt-5.4-mini", isCustom: false, capabilities: null },
  ],
  slashCommands: [],
  skills: [],
};

const projectId = ProjectId.make("project:retro");
const threadId = ThreadId.make("thread:retro-subject");
// The orchestrator checks a thread's loadout against its own settings, so the built-in one is used.
const org: Loadout = DEFAULT_LOADOUTS.find(({ id }) => id === "planner-workers-judge")!;

const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
  { name: "task-retro" },
  ProviderAdapterRegistry.layerFromAdapters([adapter]),
  { databaseLayer: SqlitePersistence.layerMemory, runEffectWorker: false },
);
const layerSettings = ServerSettings.layerTest({
  // No solo in the saved list: the service adds one for display, and it must not be written back.
  loadouts: [org],
  // Another override on the same project, which applying a recommendation must not drop.
  projectSettingsOverrides: { [projectId]: { branchNamePrefix: "keep" } },
});
const layerThreads = ThreadManagementService.layer.pipe(
  Layer.provideMerge(layerOrchestrator),
  Layer.provide(layerSettings),
  Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory))),
);
const layerTest = TaskRetroService.layer.pipe(
  Layer.provideMerge(layerThreads),
  Layer.provide(TaskRetros.layer),
  Layer.provide(Layer.mock(TaskTimingService.TaskTimingService)({})),
  Layer.provide(ProviderRegistryMock.layer([snapshot])),
  Layer.provideMerge(layerSettings),
  Layer.provide(NodeCrypto.layer),
  Layer.provideMerge(TaskRetros.layer),
  Layer.provide(SqlitePersistence.layerMemory),
);

const retro = (overrides: Partial<TaskRetro> = {}): TaskRetro => ({
  threadId,
  projectId,
  run: 1,
  createdAt: "2026-01-02T00:00:00.000Z",
  judge: { instanceId: codex, model: "gpt-5.4" },
  summary: "Prose.",
  parsed: true,
  slowCauses: ["Workers waited"],
  modelVerdicts: [{ role: "worker", verdict: "too_strong", note: "" }],
  structure: "less",
  recommendations: [
    {
      id: "rec-1",
      kind: "thread_loadout",
      loadoutId: org.id,
      note: "needs a planner",
      status: "pending",
    },
    {
      id: "rec-2",
      kind: "role_model",
      loadoutId: org.id,
      role: "worker",
      instanceId: codex,
      model: "gpt-5.4-mini",
      note: "cheaper",
      status: "pending",
    },
    {
      id: "rec-3",
      kind: "role_model",
      loadoutId: org.id,
      role: "planner",
      instanceId: codex,
      model: "gpt-5.4-mini",
      note: "cheaper planner",
      status: "pending",
    },
  ],
  ...overrides,
});

const setup = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("command:task-retro:create"),
    threadId,
    projectId,
    title: "Subject",
    modelSelection: { instanceId: codex, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  const store = yield* TaskRetros.TaskRetroRepository;
  yield* store.put(retro());
  return {
    store,
    service: yield* TaskRetroService.TaskRetroService,
    threads: yield* ThreadManagementService.ThreadManagementService,
    settings: yield* ServerSettings.ServerSettingsService,
  };
});

it.effect("applying a loadout recommendation sets the thread's loadout as the user's choice", () =>
  Effect.gen(function* () {
    const { service, threads, store } = yield* setup;
    const next = yield* service.resolve({ threadId, recommendationId: "rec-1", action: "apply" });
    expect(next.recommendations[0]!.status).toBe("applied");
    const shell = yield* threads.getThreadShell(threadId);
    expect(shell?.loadout).toEqual({
      id: org.id,
      reason: "Suggested by the task retro: needs a planner",
      setBy: "user",
    });
    // The applied state is what the Activity tab reads next.
    expect((yield* service.get(threadId))?.recommendations[0]!.status).toBe("applied");
    expect((yield* store.list({})).length).toBe(1);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "applying a role recommendation edits the project's loadouts and keeps its other overrides",
  () =>
    Effect.gen(function* () {
      const { service, settings } = yield* setup;
      yield* service.resolve({ threadId, recommendationId: "rec-2", action: "apply" });
      const entry = (yield* settings.getSettings).projectSettingsOverrides[projectId];
      const saved = entry?.loadouts?.find(({ id }) => id === org.id);
      expect(saved?.roles.worker).toEqual({ instanceId: codex, model: "gpt-5.4-mini" });
      expect(saved?.roles.planner).toEqual(org.roles.planner);
      expect(entry?.branchNamePrefix).toBe("keep");
      // The synthetic solo the service adds for display is not written into the project's copy.
      expect(entry?.loadouts?.map(({ id }) => id)).toEqual([org.id]);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("two role recommendations applied together both land: the edit is atomic", () =>
  Effect.gen(function* () {
    const { service, settings } = yield* setup;
    yield* Effect.all(
      [
        service.resolve({ threadId, recommendationId: "rec-2", action: "apply" }),
        service.resolve({ threadId, recommendationId: "rec-3", action: "apply" }),
      ],
      { concurrency: 2 },
    );
    const saved = (yield* settings.getSettings).projectSettingsOverrides[projectId]?.loadouts?.find(
      ({ id }) => id === org.id,
    );
    expect(saved?.roles.worker?.model).toBe("gpt-5.4-mini");
    expect(saved?.roles.planner?.model).toBe("gpt-5.4-mini");
    // And both statuses are recorded: one resolve does not write over the other's.
    expect((yield* service.get(threadId))?.recommendations.map(({ status }) => status)).toEqual([
      "pending",
      "applied",
      "applied",
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("undoing an applied role is editing the loadout again; the retro stays applied", () =>
  Effect.gen(function* () {
    const { service, settings } = yield* setup;
    yield* service.resolve({ threadId, recommendationId: "rec-2", action: "apply" });
    const entry = (yield* settings.getSettings).projectSettingsOverrides[projectId];
    yield* settings.updateSettings({
      projectSettingsOverrides: { [projectId]: { ...entry, loadouts: [org] } },
    });
    const restored = (yield* settings.getSettings).projectSettingsOverrides[projectId]?.loadouts;
    expect(restored?.find(({ id }) => id === org.id)?.roles.worker).toEqual(org.roles.worker);
    expect((yield* service.get(threadId))?.recommendations[1]!.status).toBe("applied");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("dismissing changes no setting and leaves the thread's loadout alone", () =>
  Effect.gen(function* () {
    const { service, threads, settings } = yield* setup;
    yield* service.resolve({ threadId, recommendationId: "rec-2", action: "dismiss" });
    expect(
      (yield* settings.getSettings).projectSettingsOverrides[projectId]?.loadouts,
    ).toBeUndefined();
    expect((yield* threads.getThreadShell(threadId))?.loadout ?? null).toBeNull();
    expect((yield* service.get(threadId))?.recommendations.map(({ status }) => status)).toEqual([
      "pending",
      "dismissed",
      "pending",
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("a thread with no stored retro has nothing to resolve", () =>
  Effect.gen(function* () {
    const { service } = yield* setup;
    const other = ThreadId.make("thread:never-retroed");
    expect(yield* service.get(other)).toBeNull();
    const exit = yield* Effect.exit(
      service.resolve({ threadId: other, recommendationId: "rec-1", action: "dismiss" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("the rollup reads the stored retros", () =>
  Effect.gen(function* () {
    const { service } = yield* setup;
    const rollup = yield* service.rollup({ projectId });
    expect(rollup).toMatchObject({
      retros: 1,
      structure: { less: 1, same: 0, more: 0, unknown: 0 },
      slowCauses: [{ cause: "workers waited", count: 1 }],
    });
  }).pipe(Effect.provide(layerTest)),
);
