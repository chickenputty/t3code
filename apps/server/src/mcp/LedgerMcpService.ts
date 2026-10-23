import {
  CommandId,
  type Ledger,
  LedgerId,
  type LedgerMcpAddItemsInput,
  type LedgerMcpCreateInput,
  type LedgerMcpReadResult,
  type LedgerMcpRetryInput,
  type LedgerMcpSetCheckpointInput,
  type LedgerMcpSnapshot,
  type LedgerMcpUpdateItemInput,
  type LedgerMcpWriteResult,
  OrchestratorMcpFailure,
  type OrchestrationV2ServerCommand,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { requireThreadScope, type McpInvocationScope } from "./McpInvocationContext.ts";
import { dispatchFailure, unavailable } from "./threadAccess.ts";

export type LedgerMcpOperation =
  | "create"
  | "add-items"
  | "update-item"
  | "set-checkpoint"
  | "close"
  | "reopen";

/**
 * Every operation acts on the calling thread's own ledger. None takes a thread id, so an agent
 * cannot reach another thread's ledger however it fills in the arguments.
 */
export class LedgerMcpService extends Context.Service<
  LedgerMcpService,
  {
    readonly create: (
      scope: McpInvocationScope,
      input: LedgerMcpCreateInput,
    ) => Effect.Effect<LedgerMcpWriteResult, OrchestratorMcpFailure>;
    readonly addItems: (
      scope: McpInvocationScope,
      input: LedgerMcpAddItemsInput,
    ) => Effect.Effect<LedgerMcpWriteResult, OrchestratorMcpFailure>;
    readonly updateItem: (
      scope: McpInvocationScope,
      input: LedgerMcpUpdateItemInput,
    ) => Effect.Effect<LedgerMcpWriteResult, OrchestratorMcpFailure>;
    readonly setCheckpoint: (
      scope: McpInvocationScope,
      input: LedgerMcpSetCheckpointInput,
    ) => Effect.Effect<LedgerMcpWriteResult, OrchestratorMcpFailure>;
    readonly close: (
      scope: McpInvocationScope,
      input: LedgerMcpRetryInput,
    ) => Effect.Effect<LedgerMcpWriteResult, OrchestratorMcpFailure>;
    readonly reopen: (
      scope: McpInvocationScope,
      input: LedgerMcpRetryInput,
    ) => Effect.Effect<LedgerMcpWriteResult, OrchestratorMcpFailure>;
    readonly read: (
      scope: McpInvocationScope,
    ) => Effect.Effect<LedgerMcpReadResult, OrchestratorMcpFailure>;
  }
>()("t3/mcp/LedgerMcpService") {}

const stablePart = (value: string) => encodeURIComponent(value);

const failure = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });

const noLedger = () =>
  failure("invalid_request", "This thread has no ledger. Create one with ledger_create first.");

// A rejection is stored against its command id, so a retry under the same key can never succeed.
const ledgerFailure = (error: Parameters<typeof dispatchFailure>[0]) =>
  error._tag === "OrchestratorCommandPreviouslyRejectedError"
    ? failure(
        "invalid_request",
        "This clientRequestId was already rejected. Read the ledger with ledger_read, fix the call, and retry with a new clientRequestId.",
      )
    : dispatchFailure(error);

function snapshotLedger(ledger: Ledger): LedgerMcpSnapshot {
  const counts = { open: 0, in_progress: 0, closed: 0, dropped: 0 };
  for (const item of ledger.items) counts[item.status] += 1;
  return {
    ledgerId: ledger.id,
    title: ledger.title,
    startState: ledger.startState,
    winConditions: ledger.winConditions,
    closed: ledger.closedAt !== null,
    counts,
    unfinished: counts.open + counts.in_progress,
    checkpoints: ledger.checkpoints.map(({ id, title, reached }) => ({ id, title, reached })),
    items: ledger.items.map((item) => ({
      id: item.id,
      title: item.title,
      acceptance: item.acceptance,
      status: item.status,
      evidence: item.evidence,
      dropReason: item.dropReason,
      verdict: item.verdict?.outcome ?? null,
    })),
  };
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const threads = yield* ThreadManagementService.ThreadManagementService;

  const loadOwnLedger = Effect.fn("LedgerMcpService.loadOwnLedger")(function* (
    scope: McpInvocationScope,
  ) {
    if (!scope.capabilities.has("orchestration")) {
      return yield* failure("capability_denied", "This credential cannot control threads.");
    }
    const { thread } = yield* requireThreadScope(scope, "Ledger tools");
    const shell = yield* threads.getThreadShell(thread.threadId).pipe(Effect.mapError(unavailable));
    if (shell === null || shell.deletedAt !== null) {
      return yield* failure("thread_not_found", "The calling thread was not found.");
    }
    const records = yield* threads
      .getProjectThreadRecords({ projectId: shell.projectId, threadId: thread.threadId }, [
        "ledger",
      ])
      .pipe(Effect.mapError(unavailable));
    return { threadId: thread.threadId, ledger: records.ledger };
  });

  const read = Effect.fn("LedgerMcpService.read")(function* (scope: McpInvocationScope) {
    const { ledger } = yield* loadOwnLedger(scope);
    return { ledger: ledger === undefined ? null : snapshotLedger(ledger) };
  });

  const write = Effect.fn("LedgerMcpService.write")(function* (
    scope: McpInvocationScope,
    operation: LedgerMcpOperation,
    clientRequestId: string | undefined,
    build: (context: {
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
      readonly requestKey: string;
      readonly ledger: Ledger | undefined;
    }) => Effect.Effect<OrchestrationV2ServerCommand, OrchestratorMcpFailure>,
  ) {
    const { threadId, ledger } = yield* loadOwnLedger(scope);
    // Without a caller key the call is not retry-safe, which the tool descriptions say.
    const requestKey = clientRequestId ?? (yield* crypto.randomUUIDv4().pipe(Effect.orDie));
    const commandId = CommandId.make(
      [
        "command",
        "mcp",
        stablePart(scope.requestNamespace),
        `ledger-${operation}`,
        stablePart(threadId),
        stablePart(requestKey),
      ].join(":"),
    );
    const command = yield* build({ commandId, threadId, requestKey, ledger });
    const dispatched = yield* threads.dispatch(command).pipe(Effect.mapError(ledgerFailure));
    const after = yield* loadOwnLedger(scope);
    return {
      sequence: dispatched.sequence,
      ledger: after.ledger === undefined ? null : snapshotLedger(after.ledger),
    };
  });

  // Edits to an existing ledger name it by id, read from the projection so the agent never types one.
  const onExisting = <Input extends LedgerMcpRetryInput>(
    operation: LedgerMcpOperation,
    scope: McpInvocationScope,
    input: Input,
    command: (common: {
      commandId: CommandId;
      threadId: ThreadId;
      ledgerId: LedgerId;
    }) => OrchestrationV2ServerCommand,
  ) =>
    write(scope, operation, input.clientRequestId, ({ commandId, threadId, ledger }) =>
      ledger === undefined
        ? Effect.fail(noLedger())
        : Effect.succeed(command({ commandId, threadId, ledgerId: ledger.id })),
    );

  const create = Effect.fn("LedgerMcpService.create")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpCreateInput,
  ) {
    return yield* write(
      scope,
      "create",
      input.clientRequestId,
      ({ commandId, threadId, requestKey }) =>
        Effect.succeed({
          type: "ledger.create" as const,
          commandId,
          threadId,
          // Derived from the request key, so a replayed create names the same ledger.
          ledgerId: LedgerId.make(`ledger:${stablePart(threadId)}:${stablePart(requestKey)}`),
          title: input.title,
          startState: input.startState ?? "",
          checkpoints: input.checkpoints ?? [],
          winConditions: input.winConditions ?? [],
          items: input.items,
        }),
    );
  });

  const addItems = Effect.fn("LedgerMcpService.addItems")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpAddItemsInput,
  ) {
    return yield* onExisting("add-items", scope, input, (common) => ({
      type: "ledger.item.add",
      ...common,
      items: input.items,
    }));
  });

  const updateItem = Effect.fn("LedgerMcpService.updateItem")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpUpdateItemInput,
  ) {
    if (
      input.status === undefined &&
      input.evidence === undefined &&
      input.dropReason === undefined
    ) {
      return yield* failure("invalid_request", "Pass status, evidence or dropReason to update.");
    }
    return yield* onExisting("update-item", scope, input, (common) => ({
      type: "ledger.item.update",
      ...common,
      itemId: input.itemId,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
      ...(input.dropReason === undefined ? {} : { dropReason: input.dropReason }),
    }));
  });

  const setCheckpoint = Effect.fn("LedgerMcpService.setCheckpoint")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpSetCheckpointInput,
  ) {
    return yield* onExisting("set-checkpoint", scope, input, (common) => ({
      type: "ledger.checkpoint.set",
      ...common,
      checkpointId: input.checkpointId,
      reached: input.reached,
    }));
  });

  const close = Effect.fn("LedgerMcpService.close")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpRetryInput,
  ) {
    return yield* onExisting("close", scope, input, (common) => ({
      type: "ledger.close",
      ...common,
    }));
  });

  const reopen = Effect.fn("LedgerMcpService.reopen")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpRetryInput,
  ) {
    return yield* onExisting("reopen", scope, input, (common) => ({
      type: "ledger.reopen",
      ...common,
    }));
  });

  return LedgerMcpService.of({ read, create, addItems, updateItem, setCheckpoint, close, reopen });
});

export const layer: Layer.Layer<
  LedgerMcpService,
  never,
  Crypto.Crypto | ThreadManagementService.ThreadManagementService
> = Layer.effect(LedgerMcpService, make);
