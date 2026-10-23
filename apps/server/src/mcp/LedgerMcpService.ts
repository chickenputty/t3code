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
import * as Schema from "effect/Schema";

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

const isMcpFailure = Schema.is(OrchestratorMcpFailure);

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
        `This request was already rejected: ${Array.from(error.detail).slice(0, 500).join("")} Read the ledger with ledger_read, fix the call, and retry with a new clientRequestId.`,
      )
    : dispatchFailure(error);

// Object keys are sorted so the same arguments hash the same however the client ordered them.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const ledgerIdFor = (threadId: ThreadId, requestKey: string) =>
  LedgerId.make(`ledger:${stablePart(threadId)}:${stablePart(requestKey)}`);

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
  const hashKey = (parts: unknown) =>
    crypto.digest("SHA-256", new TextEncoder().encode(stableJson(parts))).pipe(
      Effect.map(
        (digest) =>
          `auto-${Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      ),
      Effect.orDie,
    );
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
    /** What an identical retry must hash the same on; the key defaults to a hash of it. */
    fingerprint: (ledger: Ledger | undefined) => unknown,
    build: (context: {
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
      readonly requestKey: string;
      readonly ledger: Ledger | undefined;
    }) => Effect.Effect<OrchestrationV2ServerCommand, OrchestratorMcpFailure>,
    /** Whether the ledger already shows the change this call asks for. */
    applied: (ledger: Ledger | undefined) => boolean,
  ) {
    const { threadId, ledger } = yield* loadOwnLedger(scope);
    const send = (requestKey: string) => {
      const commandId = CommandId.make(
        [
          "command",
          "mcp",
          stablePart(scope.requestNamespace),
          `ledger-${operation}`,
          stablePart(threadId),
          // Per ledger, so a reused key cannot replay a replaced ledger's receipt. A create
          // names none yet, and its retry already sees the one it made.
          stablePart(operation === "create" ? "new" : (ledger?.id ?? "none")),
          stablePart(requestKey),
        ].join(":"),
      );
      return build({ commandId, threadId, requestKey, ledger }).pipe(
        Effect.flatMap((command) => threads.dispatch(command)),
      );
    };
    const settle = Effect.fn("LedgerMcpService.settle")(function* (sequence: number) {
      const after = yield* loadOwnLedger(scope);
      return {
        sequence,
        ledger: after.ledger === undefined ? null : snapshotLedger(after.ledger),
        applied: applied(after.ledger),
      };
    });
    const toToolError = Effect.mapError(
      (error: OrchestratorMcpFailure | Parameters<typeof ledgerFailure>[0]) =>
        isMcpFailure(error) ? error : ledgerFailure(error),
    );

    if (clientRequestId !== undefined) {
      const { sequence, ledger: snapshot } = yield* send(clientRequestId).pipe(
        Effect.flatMap(({ sequence }) => settle(sequence)),
        toToolError,
      );
      return { sequence, ledger: snapshot };
    }
    // A lost response is retried with identical arguments, so the default key is a hash of them
    // and the retry replays the stored receipt instead of failing against the changed ledger.
    // The same hash also matches an earlier call that is stale by now (close, reopen, close), so
    // a receipt that was rejected, or replayed without the change showing, is sent again once
    // under a fresh key.
    const fresh = Effect.map(crypto.randomUUIDv4(), (id) => `fresh-${id}`).pipe(Effect.orDie);
    const hashed = hashKey([operation, fingerprint(ledger)]).pipe(
      Effect.flatMap(send),
      Effect.catchTags({
        OrchestratorCommandPreviouslyRejectedError: () => Effect.flatMap(fresh, send),
      }),
      Effect.flatMap(({ sequence }) => settle(sequence)),
    );
    const settled = yield* hashed.pipe(
      Effect.flatMap((first) =>
        first.applied
          ? Effect.succeed(first)
          : Effect.flatMap(fresh, send).pipe(Effect.flatMap(({ sequence }) => settle(sequence))),
      ),
      toToolError,
    );
    return { sequence: settled.sequence, ledger: settled.ledger };
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
    applied: (ledger: Ledger) => boolean,
  ) =>
    write(
      scope,
      operation,
      input.clientRequestId,
      (ledger) => [ledger?.id ?? "none", { ...input, clientRequestId: undefined }],
      ({ commandId, threadId, ledger }) =>
        ledger === undefined
          ? Effect.fail(noLedger())
          : Effect.succeed(command({ commandId, threadId, ledgerId: ledger.id })),
      (ledger) => ledger !== undefined && applied(ledger),
    );

  const create = Effect.fn("LedgerMcpService.create")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpCreateInput,
  ) {
    const args = { ...input, clientRequestId: undefined };
    return yield* write(
      scope,
      "create",
      input.clientRequestId,
      // A retry sees the open ledger its first attempt made, so an open one hashes as "new". A
      // closed ledger being replaced joins the hash, or an identical replacement would replay the
      // first ledger's receipt and never be created.
      (ledger) => [ledger !== undefined && ledger.closedAt !== null ? ledger.id : "new", args],
      ({ commandId, threadId, requestKey }) =>
        Effect.succeed({
          type: "ledger.create" as const,
          commandId,
          threadId,
          // Derived from the request key, so a replayed create names the same ledger.
          ledgerId: ledgerIdFor(threadId, requestKey),
          title: input.title,
          startState: input.startState ?? "",
          checkpoints: input.checkpoints ?? [],
          winConditions: input.winConditions ?? [],
          items: input.items,
        }),
      (ledger) => ledger !== undefined && ledger.closedAt === null,
    );
  });

  const addItems = Effect.fn("LedgerMcpService.addItems")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpAddItemsInput,
  ) {
    return yield* onExisting(
      "add-items",
      scope,
      input,
      (common) => ({ type: "ledger.item.add", ...common, items: input.items }),
      (ledger) => input.items.every((added) => ledger.items.some((item) => item.id === added.id)),
    );
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
    return yield* onExisting(
      "update-item",
      scope,
      input,
      (common) => ({
        type: "ledger.item.update",
        ...common,
        itemId: input.itemId,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
        ...(input.dropReason === undefined ? {} : { dropReason: input.dropReason }),
      }),
      (ledger) => {
        const item = ledger.items.find(({ id }) => id === input.itemId);
        return (
          item !== undefined &&
          (input.status === undefined || item.status === input.status) &&
          (input.evidence === undefined || item.evidence === input.evidence) &&
          (input.dropReason === undefined || item.dropReason === input.dropReason)
        );
      },
    );
  });

  const setCheckpoint = Effect.fn("LedgerMcpService.setCheckpoint")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpSetCheckpointInput,
  ) {
    return yield* onExisting(
      "set-checkpoint",
      scope,
      input,
      (common) => ({
        type: "ledger.checkpoint.set",
        ...common,
        checkpointId: input.checkpointId,
        reached: input.reached,
      }),
      (ledger) =>
        ledger.checkpoints.find(({ id }) => id === input.checkpointId)?.reached === input.reached,
    );
  });

  const close = Effect.fn("LedgerMcpService.close")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpRetryInput,
  ) {
    return yield* onExisting(
      "close",
      scope,
      input,
      (common) => ({ type: "ledger.close", ...common }),
      (ledger) => ledger.closedAt !== null,
    );
  });

  const reopen = Effect.fn("LedgerMcpService.reopen")(function* (
    scope: McpInvocationScope,
    input: LedgerMcpRetryInput,
  ) {
    return yield* onExisting(
      "reopen",
      scope,
      input,
      (common) => ({ type: "ledger.reopen", ...common }),
      (ledger) => ledger.closedAt === null,
    );
  });

  return LedgerMcpService.of({ read, create, addItems, updateItem, setCheckpoint, close, reopen });
});

export const layer: Layer.Layer<
  LedgerMcpService,
  never,
  Crypto.Crypto | ThreadManagementService.ThreadManagementService
> = Layer.effect(LedgerMcpService, make);
