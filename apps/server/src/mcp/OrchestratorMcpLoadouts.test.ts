import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  OrchestratorMcpFailure,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import { JUDGE_DELEGATION_OPERATION, stableCommandId } from "./OrchestratorMcpService.ts";

const codex = ProviderInstanceId.make("codex");
const adapter = {
  instanceId: codex,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Loadout tools never reach a provider"),
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

const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
  { name: "loadout-mcp" },
  ProviderAdapterRegistry.layerFromAdapters([adapter]),
  { databaseLayer: SqlitePersistence.layerMemory, runEffectWorker: false },
);
const layerThreads = ThreadManagementService.layer.pipe(
  Layer.provideMerge(layerOrchestrator),
  Layer.provide(ServerSettings.layerTest()),
  Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory))),
);
const layerTest = OrchestratorMcpService.layer.pipe(
  Layer.provideMerge(layerThreads),
  Layer.provide(ProviderAdapterRegistry.layerFromAdapters([adapter])),
  Layer.provide(ProviderRegistryMock.layer([snapshot])),
  Layer.provide(ServerSettings.layerTest()),
  Layer.provide(Layer.mock(ThreadLaunchService.ThreadLaunchService)({})),
  Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
  Layer.provide(Layer.mock(ScheduledTaskService.ScheduledTaskService)({})),
  Layer.provide(Layer.mock(ProjectService.ProjectService)({})),
  Layer.provide(Layer.mock(SecretRequests.SecretRequests)({})),
  Layer.provide(NodeCrypto.layer),
);

const threadId = ThreadId.make("thread:loadout-mcp");
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:loadout-mcp"),
  requestNamespace: "loadout-mcp-session",
  thread: { threadId, providerSessionId: "loadout-mcp-session", providerInstanceId: codex },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};

let counter = 0;
const nextCommandId = () => CommandId.make(`command:loadout-mcp:${counter++}`);

const setup = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: nextCommandId(),
    threadId,
    projectId: ProjectId.make("project:loadout-mcp"),
    title: "loadouts",
    modelSelection: { instanceId: codex, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  const userSets = (loadout: { id: string; reason: string | null; setBy: "user" } | null) =>
    orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: nextCommandId(),
      threadId,
      loadout,
    });
  return { service: yield* OrchestratorMcpService.OrchestratorMcpService, userSets };
});

const messageOf = <A>(exit: Exit.Exit<A, OrchestratorMcpFailure>) =>
  Exit.isFailure(exit) && exit.cause.reasons[0]?._tag === "Fail"
    ? exit.cause.reasons[0].error.message
    : undefined;

it.effect("an agent proposal is recorded with its reason and reported by capabilities", () =>
  Effect.gen(function* () {
    const { service } = yield* setup;
    const before = yield* service.capabilities(scope);
    expect(before.loadout?.active).toMatchObject({ id: "solo", setBy: null, reason: null });
    expect(before.loadout?.available.map(({ id }) => id)).toEqual([
      "solo",
      "planner-workers-judge",
      "read-only-sweep",
    ]);

    const proposed = yield* service.proposeLoadout(scope, {
      loadoutId: "read-only-sweep",
      reason: "two independent modules",
      clientRequestId: "propose-1",
    });
    expect(proposed.loadout.active).toMatchObject({
      id: "read-only-sweep",
      setBy: "agent",
      reason: "two independent modules",
    });
    expect((yield* service.capabilities(scope)).loadout?.active.id).toBe("read-only-sweep");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("the user's choice outranks a proposal until the user clears it", () =>
  Effect.gen(function* () {
    const { service, userSets } = yield* setup;
    yield* userSets({ id: "solo", reason: null, setBy: "user" });

    const refused = yield* Effect.exit(
      service.proposeLoadout(scope, {
        loadoutId: "read-only-sweep",
        reason: "wants more",
        clientRequestId: "propose-refused",
      }),
    );
    expect(messageOf(refused)).toContain("chose");
    expect((yield* service.capabilities(scope)).loadout?.active).toMatchObject({
      id: "solo",
      setBy: "user",
    });

    yield* userSets(null);
    const accepted = yield* service.proposeLoadout(scope, {
      loadoutId: "read-only-sweep",
      reason: "wants more",
      clientRequestId: "propose-accepted",
    });
    expect(accepted.loadout.active).toMatchObject({ id: "read-only-sweep", setBy: "agent" });
  }).pipe(Effect.provide(layerTest)),
);

it.effect("a public delegate_task key can never land on the judge's command id", () =>
  Effect.sync(() => {
    // The agent can compute the judge's request key from ledger_read, so it can send any key the
    // judge would use. Public calls always use the "delegate-task" space; the judge uses its own.
    const requestKey = "judge-0123456789abcdef0123456789abcdef";
    const publicId = stableCommandId({ scope, requestKey, operation: "delegate-task" });
    const judgeId = stableCommandId({ scope, requestKey, operation: JUDGE_DELEGATION_OPERATION });
    expect(publicId).not.toBe(judgeId);
    // Even a key that imitates the judge's operation in its own text stays inside its space.
    const spoofed = stableCommandId({
      scope,
      requestKey: `${JUDGE_DELEGATION_OPERATION}:${requestKey}`,
      operation: "delegate-task",
    });
    expect(spoofed).not.toBe(judgeId);
  }),
);

it.effect("rejects a loadout the project does not list", () =>
  Effect.gen(function* () {
    const { service } = yield* setup;
    const exit = yield* Effect.exit(
      service.proposeLoadout(scope, { loadoutId: "no-such", reason: "because" }),
    );
    expect(messageOf(exit)).toContain("Unknown loadout no-such");
  }).pipe(Effect.provide(layerTest)),
);
