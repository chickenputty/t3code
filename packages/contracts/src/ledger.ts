import * as Schema from "effect/Schema";

import {
  CommandId,
  LedgerCheckpointId,
  LedgerId,
  LedgerItemId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const LedgerItemStatus = Schema.Literals(["open", "in_progress", "closed", "dropped"]);
export type LedgerItemStatus = typeof LedgerItemStatus.Type;

/** Who judged, without the provider options a full `ModelSelection` carries. */
export const LedgerVerdictJudge = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
});
export type LedgerVerdictJudge = typeof LedgerVerdictJudge.Type;

export const LedgerItemVerdict = Schema.Struct({
  outcome: Schema.Literals(["pass", "fail"]),
  judge: LedgerVerdictJudge,
  notes: Schema.String,
  at: Schema.DateTimeUtc,
});
export type LedgerItemVerdict = typeof LedgerItemVerdict.Type;

export const LedgerItem = Schema.Struct({
  id: LedgerItemId,
  title: TrimmedNonEmptyString,
  /** What "done" means for this item; the judge and the harness check against it. */
  acceptance: Schema.String,
  status: LedgerItemStatus,
  evidence: Schema.NullOr(Schema.String),
  dropReason: Schema.NullOr(Schema.String),
  verdict: Schema.NullOr(LedgerItemVerdict),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  closedAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type LedgerItem = typeof LedgerItem.Type;

export const LedgerCheckpoint = Schema.Struct({
  id: LedgerCheckpointId,
  title: TrimmedNonEmptyString,
  reached: Schema.Boolean,
  reachedAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type LedgerCheckpoint = typeof LedgerCheckpoint.Type;

export const Ledger = Schema.Struct({
  id: LedgerId,
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  /** Where the task started, so a later session can tell how far it has moved. */
  startState: Schema.String,
  checkpoints: Schema.Array(LedgerCheckpoint),
  winConditions: Schema.Array(Schema.String),
  items: Schema.Array(LedgerItem),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  closedAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type Ledger = typeof Ledger.Type;

export const LedgerItemVerdictJson = LedgerItemVerdict.mapFields((fields) => ({
  ...fields,
  at: Schema.DateTimeUtcFromString,
}));

export const LedgerItemJson = LedgerItem.mapFields((fields) => ({
  ...fields,
  verdict: Schema.NullOr(LedgerItemVerdictJson),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  closedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}));

export const LedgerCheckpointJson = LedgerCheckpoint.mapFields((fields) => ({
  ...fields,
  reachedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}));

export const LedgerJson = Ledger.mapFields((fields) => ({
  ...fields,
  checkpoints: Schema.Array(LedgerCheckpointJson),
  items: Schema.Array(LedgerItemJson),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  closedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}));

/** Item fields a client supplies when adding; the server stamps status and times. */
export const LedgerItemDraft = Schema.Struct({
  id: LedgerItemId,
  title: TrimmedNonEmptyString,
  acceptance: Schema.String,
});
export type LedgerItemDraft = typeof LedgerItemDraft.Type;

export const LedgerCheckpointDraft = Schema.Struct({
  id: LedgerCheckpointId,
  title: TrimmedNonEmptyString,
});
export type LedgerCheckpointDraft = typeof LedgerCheckpointDraft.Type;

export const LedgerCommands = [
  Schema.Struct({
    type: Schema.Literal("ledger.create"),
    commandId: CommandId,
    threadId: ThreadId,
    ledgerId: LedgerId,
    title: TrimmedNonEmptyString,
    startState: Schema.String,
    checkpoints: Schema.Array(LedgerCheckpointDraft),
    winConditions: Schema.Array(Schema.String),
    items: Schema.Array(LedgerItemDraft),
  }),
  Schema.Struct({
    type: Schema.Literal("ledger.item.add"),
    commandId: CommandId,
    threadId: ThreadId,
    ledgerId: LedgerId,
    items: Schema.Array(LedgerItemDraft),
  }),
  Schema.Struct({
    type: Schema.Literal("ledger.item.update"),
    commandId: CommandId,
    threadId: ThreadId,
    ledgerId: LedgerId,
    itemId: LedgerItemId,
    status: Schema.optional(LedgerItemStatus),
    evidence: Schema.optional(Schema.NullOr(Schema.String)),
    dropReason: Schema.optional(Schema.NullOr(Schema.String)),
    // No verdict: only the server attests one, via the internal `ledger.item.verdict.record`.
  }).check(
    Schema.makeFilter(
      (update) =>
        update.status !== undefined ||
        update.evidence !== undefined ||
        update.dropReason !== undefined ||
        "A ledger item update must change status, evidence or dropReason.",
    ),
  ),
  Schema.Struct({
    type: Schema.Literal("ledger.checkpoint.set"),
    commandId: CommandId,
    threadId: ThreadId,
    ledgerId: LedgerId,
    checkpointId: LedgerCheckpointId,
    reached: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("ledger.close"),
    commandId: CommandId,
    threadId: ThreadId,
    ledgerId: LedgerId,
  }),
  Schema.Struct({
    type: Schema.Literal("ledger.reopen"),
    commandId: CommandId,
    threadId: ThreadId,
    ledgerId: LedgerId,
  }),
] as const;

/** Server-only: keeps a judge verdict from being asserted by a client. */
export const LedgerVerdictRecordCommand = Schema.Struct({
  type: Schema.Literal("ledger.item.verdict.record"),
  commandId: CommandId,
  threadId: ThreadId,
  ledgerId: LedgerId,
  itemId: LedgerItemId,
  verdict: LedgerItemVerdict,
});

/** Payload of `ledger.item.added`: only the newly added items, which readers upsert. */
export const LedgerItemsAddedPayload = Schema.Struct({
  ledgerId: LedgerId,
  items: Schema.Array(LedgerItem),
  updatedAt: Schema.DateTimeUtc,
});
export type LedgerItemsAddedPayload = typeof LedgerItemsAddedPayload.Type;

export const LedgerItemsAddedPayloadJson = LedgerItemsAddedPayload.mapFields((fields) => ({
  ...fields,
  items: Schema.Array(LedgerItemJson),
  updatedAt: Schema.DateTimeUtcFromString,
}));

/** Payload of `ledger.item.updated`: the one item after the change. */
export const LedgerItemUpdatedPayload = Schema.Struct({
  ledgerId: LedgerId,
  item: LedgerItem,
  updatedAt: Schema.DateTimeUtc,
});
export type LedgerItemUpdatedPayload = typeof LedgerItemUpdatedPayload.Type;

export const LedgerItemUpdatedPayloadJson = LedgerItemUpdatedPayload.mapFields((fields) => ({
  ...fields,
  item: LedgerItemJson,
  updatedAt: Schema.DateTimeUtcFromString,
}));

export const LedgerCheckpointUpdatedPayload = Schema.Struct({
  ledgerId: LedgerId,
  checkpoint: LedgerCheckpoint,
  updatedAt: Schema.DateTimeUtc,
});
export type LedgerCheckpointUpdatedPayload = typeof LedgerCheckpointUpdatedPayload.Type;

export const LedgerCheckpointUpdatedPayloadJson = LedgerCheckpointUpdatedPayload.mapFields(
  (fields) => ({
    ...fields,
    checkpoint: LedgerCheckpointJson,
    updatedAt: Schema.DateTimeUtcFromString,
  }),
);

export const LedgerClosedPayload = Schema.Struct({
  ledgerId: LedgerId,
  closedAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});
export type LedgerClosedPayload = typeof LedgerClosedPayload.Type;

export const LedgerClosedPayloadJson = LedgerClosedPayload.mapFields((fields) => ({
  ...fields,
  closedAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
}));

export const LedgerReopenedPayload = Schema.Struct({
  ledgerId: LedgerId,
  updatedAt: Schema.DateTimeUtc,
});
export type LedgerReopenedPayload = typeof LedgerReopenedPayload.Type;

export const LedgerReopenedPayloadJson = LedgerReopenedPayload.mapFields((fields) => ({
  ...fields,
  updatedAt: Schema.DateTimeUtcFromString,
}));
