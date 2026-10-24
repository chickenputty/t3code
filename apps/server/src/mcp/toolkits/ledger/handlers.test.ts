import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  type Ledger,
  ProviderInstanceId,
  ThreadId,
  type CommandId,
} from "@t3tools/contracts";
import { applyLedgerEvent } from "@t3tools/shared/taskLedger";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import { McpSchema, McpServer } from "effect/ai";

import {
  OrchestratorCommandPreviouslyRejectedError,
  OrchestratorDispatchError,
} from "../../../orchestration-v2/Orchestrator.ts";
import {
  ledgerEventFromPlan,
  planLedgerCommand,
  type LedgerCommand,
} from "../../../orchestration-v2/TaskLedger.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";

const ownThread = ThreadId.make("thread:ledger-own");
const otherThread = ThreadId.make("thread:ledger-other");
const NOW = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");

const scopeFor = (
  threadId: ThreadId | undefined,
  capabilities: ReadonlySet<McpInvocationContext.McpCapability> = new Set(["orchestration"]),
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment:ledger"),
  requestNamespace: "ledger-session",
  thread:
    threadId === undefined
      ? undefined
      : {
          threadId,
          providerSessionId: "ledger-session",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
  client: undefined,
  issuedAt: 0,
  capabilities,
});

const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "ledger-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "ledger-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const isLedgerCommand = (command: { readonly type: string }): command is LedgerCommand =>
  command.type.startsWith("ledger.");

/**
 * Runs the real planner and reducer behind the thread management seam, with the orchestrator's
 * command-receipt behaviour: a replayed command id is answered from its receipt, a rejected one
 * stays rejected.
 */
const makeFakeThreads = () => {
  const ledgers = new Map<ThreadId, Ledger>();
  const receipts = new Map<
    CommandId,
    { readonly sequence: number } | { readonly rejected: string }
  >();
  let sequence = 0;
  let planned = 0;
  const layer = Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
    getProjectThreadRecords: ({ threadId }) => {
      const ledger = ledgers.get(threadId);
      return Effect.succeed({
        ...idleThreadProjection(liveThreadShell(threadId)),
        ...(ledger === undefined ? {} : { ledger }),
      });
    },
    dispatch: (command) =>
      Effect.gen(function* () {
        const receipt = receipts.get(command.commandId);
        if (receipt !== undefined && "rejected" in receipt) {
          return yield* new OrchestratorCommandPreviouslyRejectedError({
            commandId: command.commandId,
            commandType: command.type,
            detail: receipt.rejected,
          });
        }
        if (receipt !== undefined) return { sequence: receipt.sequence, storedEvents: [] };
        if (!isLedgerCommand(command)) return yield* Effect.die("only ledger commands expected");
        planned += 1;
        const plan = planLedgerCommand({
          command,
          ledger: ledgers.get(command.threadId),
          now: NOW,
        });
        if (Result.isFailure(plan)) {
          receipts.set(command.commandId, { rejected: plan.failure });
          return yield* new OrchestratorDispatchError({
            commandId: command.commandId,
            commandType: command.type,
            cause: plan.failure,
          });
        }
        for (const event of plan.success) {
          const next = applyLedgerEvent(ledgers.get(command.threadId), {
            ...ledgerEventFromPlan(event, {
              threadId: command.threadId,
              providerInstanceId: ProviderInstanceId.make("codex"),
              occurredAt: NOW,
            }),
            id: EventId.make(`event:${(sequence += 1)}`),
          });
          if (next !== undefined) ledgers.set(command.threadId, next);
        }
        receipts.set(command.commandId, { sequence });
        return { sequence, storedEvents: [] };
      }),
  });
  return { layer, ledgers, planned: () => planned };
};

const withServer = <A, E>(
  fake: { readonly layer: Layer.Layer<ThreadManagement.ThreadManagementService> },
  body: (
    call: (
      name: string,
      args: Record<string, unknown>,
      scope?: McpInvocationContext.McpInvocationScope,
    ) => Effect.Effect<McpSchema.CallToolResult>,
    server: McpServer.McpServer["Service"],
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* body(
      (name, args, scope = scopeFor(ownThread)) =>
        server
          .callTool({ name, arguments: args })
          .pipe(
            Effect.orDie,
            Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
            Effect.provideService(McpSchema.McpServerClient, mcpClient),
          ),
      server,
    );
  }).pipe(
    Effect.provide(
      McpHttpServer.layerLedgerToolkit.pipe(
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provide(NodeCrypto.layer),
        Layer.provide(fake.layer),
      ),
    ),
  );

// A declared tool failure comes back as `isError` with its encoded payload as JSON text.
const failureOf = (result: McpSchema.CallToolResult) => {
  const text = result.content[0];
  return result.isError === true && text?.type === "text" ? JSON.parse(text.text) : undefined;
};

const twoItems = [
  { id: "L1", title: "Write the parser", acceptance: "Parser tests pass" },
  { id: "L2", title: "Wire the CLI", acceptance: "CLI smoke test passes" },
];

it.effect("creates a ledger and reads it back compactly", () => {
  const fake = makeFakeThreads();
  return withServer(fake, (call) =>
    Effect.gen(function* () {
      const created = yield* call("ledger_create", {
        title: "Ship the parser",
        startState: "No parser yet",
        checkpoints: [{ id: "C1", title: "Parser merged" }],
        winConditions: ["All parser tests pass"],
        items: twoItems,
      });
      expect(failureOf(created)).toBeUndefined();
      const read = yield* call("ledger_read", {});
      expect(read.structuredContent).toMatchObject({
        ledger: {
          title: "Ship the parser",
          startState: "No parser yet",
          closed: false,
          counts: { open: 2, in_progress: 0, closed: 0, dropped: 0 },
          unfinished: 2,
          checkpoints: [{ id: "C1", title: "Parser merged", reached: false }],
          items: [
            { id: "L1", status: "open", evidence: null, verdict: null },
            { id: "L2", status: "open" },
          ],
        },
      });
      expect(fake.ledgers.get(ownThread)?.id).toMatch(/^ledger:/);
    }),
  );
});

it.effect("reads a thread with no ledger as null", () =>
  withServer(makeFakeThreads(), (call) =>
    Effect.gen(function* () {
      expect((yield* call("ledger_read", {})).structuredContent).toEqual({ ledger: null });
    }),
  ),
);

it.effect("maps orchestrator rejections to clear tool errors and applies valid transitions", () => {
  const fake = makeFakeThreads();
  return withServer(fake, (call) =>
    Effect.gen(function* () {
      yield* call("ledger_create", { title: "Ship", items: twoItems });

      const noEvidence = yield* call("ledger_update_item", { itemId: "L1", status: "closed" });
      expect(failureOf(noEvidence)).toMatchObject({
        code: "orchestration_error",
        message: "Item L1 needs evidence in the same update to close from open.",
      });
      expect(
        failureOf(yield* call("ledger_update_item", { itemId: "L9", status: "closed" })),
      ).toMatchObject({
        message: "Unknown item L9.",
      });
      expect(failureOf(yield* call("ledger_update_item", { itemId: "L1" }))).toMatchObject({
        code: "invalid_request",
        message: "Pass status, evidence or dropReason to update.",
      });
      expect(failureOf(yield* call("ledger_close", {}))).toMatchObject({
        message: expect.stringContaining("items still open or in progress: L1, L2"),
      });

      const closed = yield* call("ledger_update_item", {
        itemId: "L1",
        status: "closed",
        evidence: "parser.test.ts: 12 passed",
      });
      expect(closed.structuredContent).toMatchObject({
        ledger: { counts: { open: 1, closed: 1 }, unfinished: 1 },
      });
      yield* call("ledger_update_item", {
        itemId: "L2",
        status: "dropped",
        dropReason: "Out of scope",
      });
      expect(
        failureOf(yield* call("ledger_set_checkpoint", { checkpointId: "C9", reached: true })),
      ).toMatchObject({
        message: "Unknown checkpoint C9.",
      });
      expect((yield* call("ledger_close", {})).structuredContent).toMatchObject({
        ledger: { closed: true, unfinished: 0 },
      });
      expect((yield* call("ledger_reopen", {})).structuredContent).toMatchObject({
        ledger: { closed: false },
      });
    }),
  );
});

it.effect("rejects a caller outside a thread and a credential without orchestration", () =>
  withServer(makeFakeThreads(), (call) =>
    Effect.gen(function* () {
      for (const [name, args] of [
        ["ledger_create", { title: "Ship", items: twoItems }],
        ["ledger_read", {}],
        ["ledger_close", {}],
      ] as const) {
        expect(failureOf(yield* call(name, args, scopeFor(undefined)))).toMatchObject({
          code: "thread_credential_required",
        });
      }
      expect(
        failureOf(yield* call("ledger_read", {}, scopeFor(ownThread, new Set()))),
      ).toMatchObject({ code: "capability_denied" });
    }),
  ),
);

it.effect("does not duplicate work when a call is retried with the same request key", () => {
  const fake = makeFakeThreads();
  return withServer(fake, (call) =>
    Effect.gen(function* () {
      const create = { title: "Ship", items: twoItems, clientRequestId: "create-1" };
      const first = yield* call("ledger_create", create);
      const second = yield* call("ledger_create", create);
      expect(failureOf(second)).toBeUndefined();
      expect(second.structuredContent).toEqual(first.structuredContent);
      expect(fake.planned()).toBe(1);

      const add = {
        items: [{ id: "L3", title: "Docs", acceptance: "README updated" }],
        clientRequestId: "add-1",
      };
      yield* call("ledger_add_items", add);
      const replayed = yield* call("ledger_add_items", add);
      expect(failureOf(replayed)).toBeUndefined();
      expect(fake.ledgers.get(ownThread)?.items.map((item) => item.id)).toEqual(["L1", "L2", "L3"]);
      expect(fake.planned()).toBe(2);
    }),
  );
});

it.effect("recognises an identical retry without a key and replays it", () => {
  const fake = makeFakeThreads();
  return withServer(fake, (call) =>
    Effect.gen(function* () {
      const retried = (name: string, args: Record<string, unknown>) =>
        Effect.gen(function* () {
          const first = yield* call(name, args);
          const planned = fake.planned();
          const second = yield* call(name, args);
          expect(failureOf(first), name).toBeUndefined();
          expect(second.structuredContent, name).toEqual(first.structuredContent);
          expect(fake.planned(), name).toBe(planned);
          return first;
        });

      const created = yield* retried("ledger_create", { title: "Ship", items: twoItems });
      expect(fake.ledgers.get(ownThread)?.items).toHaveLength(2);
      const ledgerId = fake.ledgers.get(ownThread)?.id;
      expect(created.structuredContent).toMatchObject({ ledger: { ledgerId } });

      yield* retried("ledger_update_item", { itemId: "L1", status: "closed", evidence: "ok" });
      yield* retried("ledger_update_item", { itemId: "L2", status: "dropped", dropReason: "no" });
      yield* retried("ledger_close", {});
      yield* retried("ledger_reopen", {});
      expect(fake.ledgers.get(ownThread)?.id).toBe(ledgerId);

      // Add and checkpoint calls hash on their arguments too.
      yield* retried("ledger_add_items", {
        items: [{ id: "L3", title: "Docs", acceptance: "README" }],
      });
    }),
  );
});

it.effect("does not let an earlier identical call replay once its effect is stale", () => {
  const fake = makeFakeThreads();
  return withServer(fake, (call) =>
    Effect.gen(function* () {
      yield* call("ledger_create", { title: "Ship", items: [twoItems[0]] });
      // Rejected while L1 is open; the same call must work after L1 is closed.
      expect(failureOf(yield* call("ledger_close", {}))).toMatchObject({
        message: expect.stringContaining("items still open or in progress: L1"),
      });
      yield* call("ledger_update_item", { itemId: "L1", status: "closed", evidence: "ok" });
      expect(failureOf(yield* call("ledger_close", {}))).toBeUndefined();
      expect(fake.ledgers.get(ownThread)?.closedAt).not.toBeNull();

      // Close, reopen, close again with identical arguments each round.
      yield* call("ledger_reopen", {});
      expect(fake.ledgers.get(ownThread)?.closedAt).toBeNull();
      yield* call("ledger_close", {});
      expect(fake.ledgers.get(ownThread)?.closedAt).not.toBeNull();
      yield* call("ledger_reopen", {});
      expect(fake.ledgers.get(ownThread)?.closedAt).toBeNull();

      // An item closed, reopened and closed again with the same evidence.
      yield* call("ledger_update_item", { itemId: "L1", status: "open" });
      yield* call("ledger_update_item", { itemId: "L1", status: "closed", evidence: "ok" });
      expect(fake.ledgers.get(ownThread)?.items[0]?.status).toBe("closed");

      // A replacement ledger with the same arguments is a new ledger, not the first one's receipt.
      yield* call("ledger_close", {});
      const first = fake.ledgers.get(ownThread)?.id;
      yield* call("ledger_create", { title: "Ship", items: [twoItems[0]] });
      expect(fake.ledgers.get(ownThread)?.id).not.toBe(first);
      expect(fake.ledgers.get(ownThread)?.closedAt).toBeNull();
    }),
  );
});

it.effect("keeps one key from replaying a replaced ledger's receipt", () => {
  const fake = makeFakeThreads();
  return withServer(fake, (call) =>
    Effect.gen(function* () {
      yield* call("ledger_create", {
        title: "One",
        items: [twoItems[0]],
        clientRequestId: "create-a",
      });
      yield* call("ledger_update_item", {
        itemId: "L1",
        status: "closed",
        evidence: "ok",
        clientRequestId: "shared",
      });
      yield* call("ledger_close", { clientRequestId: "close-a" });
      yield* call("ledger_create", {
        title: "Two",
        items: [twoItems[0]],
        clientRequestId: "create-b",
      });
      // Same key and arguments against the new ledger's L1 is a new command, so it takes effect.
      const second = yield* call("ledger_update_item", {
        itemId: "L1",
        status: "closed",
        evidence: "ok",
        clientRequestId: "shared",
      });
      expect(failureOf(second)).toBeUndefined();
      expect(fake.ledgers.get(ownThread)?.items[0]?.status).toBe("closed");
    }),
  );
});

it.effect("tells the agent a rejected request key stays rejected", () =>
  withServer(makeFakeThreads(), (call) =>
    Effect.gen(function* () {
      yield* call("ledger_create", { title: "Ship", items: twoItems });
      const bad = { itemId: "L1", status: "closed", clientRequestId: "close-1" };
      yield* call("ledger_update_item", bad);
      expect(failureOf(yield* call("ledger_update_item", bad))).toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining(
          "already rejected: Item L1 needs evidence in the same update to close from open.",
        ),
      });
      const fixed = yield* call("ledger_update_item", {
        ...bad,
        evidence: "tests: ok",
        clientRequestId: "close-2",
      });
      expect(failureOf(fixed)).toBeUndefined();
    }),
  ),
);

it.effect("never reaches another thread's ledger", () => {
  const fake = makeFakeThreads();
  return withServer(fake, (call, server) =>
    Effect.gen(function* () {
      yield* call("ledger_create", { title: "Theirs", items: twoItems }, scopeFor(otherThread));
      const before = fake.ledgers.get(otherThread);

      expect((yield* call("ledger_read", {})).structuredContent).toEqual({ ledger: null });
      expect(
        failureOf(
          yield* call("ledger_update_item", { itemId: "L1", status: "closed", evidence: "x" }),
        ),
      ).toMatchObject({ message: expect.stringContaining("has no ledger") });
      // A smuggled threadId is ignored: the schema has no such field.
      yield* call("ledger_update_item", {
        itemId: "L1",
        status: "closed",
        evidence: "x",
        threadId: otherThread,
      });
      expect(fake.ledgers.get(otherThread)).toEqual(before);
      for (const { tool } of server.tools.filter(({ tool }) => tool.name.startsWith("ledger_"))) {
        expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain("threadId");
      }
    }),
  );
});
