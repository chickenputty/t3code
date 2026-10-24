import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  LedgerItemId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionMaintenance from "../orchestration-v2/ProjectionMaintenance.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { runOrchestratorV2Scenario } from "../orchestration-v2/testkit/OrchestratorScenario.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as LedgerMcpService from "./LedgerMcpService.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Ledger commands never reach a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerOrchestrator = Layer.mergeAll(
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
    { name: "ledger-mcp" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

// The MCP service only needs dispatch and thread reads, so the real orchestrator sits behind them.
const layerThreads = Layer.unwrap(
  Effect.map(Orchestrator.OrchestratorV2, (orchestrator) =>
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: orchestrator.getThreadShell,
      dispatch: orchestrator.dispatch,
      getProjectThreadRecords: ({ threadId }, fields) =>
        orchestrator.getThreadRecords(threadId, fields).pipe(Effect.orDie),
    }),
  ),
);

const threadId = ThreadId.make("thread:ledger-mcp-real");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:ledger-mcp"),
  requestNamespace: "ledger-mcp-session",
  thread: { threadId, providerSessionId: "ledger-mcp-session", providerInstanceId: instanceId },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};

it.effect("creates and reads a ledger through the real orchestrator and projection", () =>
  Effect.gen(function* () {
    const scenario = yield* runOrchestratorV2Scenario({
      name: "ledger-mcp-create-read",
      commands: [
        {
          type: "thread.create",
          commandId: CommandId.make("command:ledger-mcp:thread"),
          threadId,
          projectId: ProjectId.make("project:ledger-mcp"),
          title: "ledger mcp",
          modelSelection: { instanceId, model: "gpt-5.1-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "web",
        },
      ],
    });
    assert.isUndefined(scenario.projections.get(threadId)?.ledger);

    const service = yield* LedgerMcpService.LedgerMcpService;
    const create = {
      title: "Ship the parser",
      items: [
        { id: LedgerItemId.make("L1"), title: "Parse", acceptance: "tests pass" },
        { id: LedgerItemId.make("L2"), title: "Wire", acceptance: "smoke passes" },
      ],
    };
    const created = yield* service.create(scope, create);
    const read = yield* service.read(scope);
    assert.deepEqual(read.ledger, created.ledger);
    assert.equal(read.ledger?.unfinished, 2);

    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projected = (yield* orchestrator.getThreadProjection(threadId)).ledger;
    assert.equal(projected?.id, read.ledger?.ledgerId);
    assert.deepEqual(
      projected?.items.map((item) => [item.id, item.status]),
      [
        ["L1", "open"],
        ["L2", "open"],
      ],
    );

    // A lost response is retried with identical arguments and answers from the stored receipt.
    const retried = yield* service.create(scope, create);
    assert.deepEqual(retried, created);
    const close = yield* service.updateItem(scope, {
      itemId: LedgerItemId.make("L1"),
      status: "closed",
      evidence: "parser.test.ts: 12 passed",
    });
    assert.deepEqual(
      yield* service.updateItem(scope, {
        itemId: LedgerItemId.make("L1"),
        status: "closed",
        evidence: "parser.test.ts: 12 passed",
      }),
      close,
    );
    assert.equal(close.ledger?.unfinished, 1);
  }).pipe(
    Effect.provide(
      LedgerMcpService.layer.pipe(
        Layer.provideMerge(layerThreads),
        Layer.provideMerge(layerOrchestrator),
        Layer.provideMerge(NodeCrypto.layer),
      ),
    ),
  ),
);
