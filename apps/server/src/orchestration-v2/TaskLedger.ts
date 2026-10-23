import type {
  Ledger,
  LedgerCheckpoint,
  LedgerItem,
  LedgerItemDraft,
  LedgerItemStatus,
  OrchestrationV2Command,
  OrchestrationV2DomainEvent,
  OrchestrationV2InternalCommand,
  ProviderInstanceId,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

export type LedgerEventBody = Extract<
  OrchestrationV2DomainEvent,
  { readonly type: `ledger.${string}` }
>;

/** A ledger event before the orchestrator stamps its id, thread and provider instance. */
export type PlannedLedgerEvent = {
  [Type in LedgerEventBody["type"]]: {
    readonly type: Type;
    readonly payload: Extract<LedgerEventBody, { readonly type: Type }>["payload"];
  };
}[LedgerEventBody["type"]];

type WithoutId<Event> = Event extends unknown ? Omit<Event, "id"> : never;

/**
 * Stamps a planned event with the thread envelope. One branch per type keeps each `type`
 * paired with its own payload, which spreading the union would not.
 */
export function ledgerEventFromPlan(
  planned: PlannedLedgerEvent,
  envelope: {
    readonly threadId: LedgerEventBody["threadId"];
    readonly providerInstanceId: ProviderInstanceId;
    readonly occurredAt: DateTime.Utc;
  },
): WithoutId<LedgerEventBody> {
  switch (planned.type) {
    case "ledger.created":
      return { ...envelope, type: planned.type, payload: planned.payload };
    case "ledger.item.added":
      return { ...envelope, type: planned.type, payload: planned.payload };
    case "ledger.item.updated":
      return { ...envelope, type: planned.type, payload: planned.payload };
    case "ledger.checkpoint.updated":
      return { ...envelope, type: planned.type, payload: planned.payload };
    case "ledger.closed":
      return { ...envelope, type: planned.type, payload: planned.payload };
    case "ledger.reopened":
      return { ...envelope, type: planned.type, payload: planned.payload };
  }
}

export type LedgerCommand = Extract<
  OrchestrationV2Command | OrchestrationV2InternalCommand,
  { readonly type: `ledger.${string}` }
>;

/** Plain text because the orchestrator surfaces it as the dispatch error's cause, like its siblings. */
export type LedgerRejection = string;

/**
 * The one transition table. Items start, finish and drop; an in-progress item can be
 * un-started; a closed or dropped item can only come back as open. An open item may close
 * directly so a small item finishes in one step, but closing still needs evidence.
 */
const LEGAL_TRANSITIONS: Readonly<Record<LedgerItemStatus, ReadonlyArray<LedgerItemStatus>>> = {
  open: ["in_progress", "closed", "dropped"],
  in_progress: ["open", "closed", "dropped"],
  closed: ["open"],
  dropped: ["open"],
};

const isBlank = (text: string | null | undefined) =>
  text === null || text === undefined || text.trim() === "";

function duplicateId(ids: ReadonlyArray<string>): string | undefined {
  return ids.find((id, index) => ids.indexOf(id) !== index);
}

function newItem(draft: LedgerItemDraft, now: DateTime.Utc): LedgerItem {
  return {
    id: draft.id,
    title: draft.title,
    acceptance: draft.acceptance,
    status: "open",
    evidence: null,
    dropReason: null,
    verdict: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };
}

/**
 * Decides a ledger command against the thread's current ledger without any I/O.
 *
 * A thread has at most one open ledger in v1. A closed ledger may be replaced by creating a new
 * one with a fresh id, which keeps the thread view to a single current task. History lives in
 * the event log, not in the projection.
 *
 * `requiresJudge` is the per-ledger judge gate: an item may not close without a passing
 * verdict. It defaults to the ledger's own field, so no caller can forget it. For
 * `ledger.create` it is instead the value to stamp on the new ledger, which the orchestrator
 * decides from the thread's loadout.
 *
 * Returns no events when the command changes nothing, so a retried or redundant command does
 * not bump `updatedAt`.
 */
export function planLedgerCommand(input: {
  readonly command: LedgerCommand;
  readonly ledger: Ledger | undefined;
  readonly now: DateTime.Utc;
  readonly requiresJudge?: boolean;
}): Result.Result<ReadonlyArray<PlannedLedgerEvent>, LedgerRejection> {
  const { command, ledger, now } = input;
  const requiresJudge = input.requiresJudge ?? ledger?.requiresJudge ?? false;
  const reject = (detail: string) => Result.fail(detail);

  if (command.type === "ledger.create") {
    if (ledger !== undefined && ledger.closedAt === null) {
      return reject(
        `Thread ${command.threadId} already has an open ledger (${ledger.id}). Close it before creating another.`,
      );
    }
    if (ledger?.id === command.ledgerId) {
      return reject(
        `Ledger id ${command.ledgerId} is already used by this thread's closed ledger.`,
      );
    }
    const duplicateItem = duplicateId(command.items.map((item) => item.id));
    if (duplicateItem !== undefined) return reject(`Duplicate item id ${duplicateItem}.`);
    const duplicateCheckpoint = duplicateId(command.checkpoints.map((checkpoint) => checkpoint.id));
    if (duplicateCheckpoint !== undefined) {
      return reject(`Duplicate checkpoint id ${duplicateCheckpoint}.`);
    }
    // A closed ledger's flag must not leak into its replacement, so only the input counts here.
    const stampedRequiresJudge = input.requiresJudge === true;
    return Result.succeed([
      {
        type: "ledger.created",
        payload: {
          id: command.ledgerId,
          threadId: command.threadId,
          title: command.title,
          startState: command.startState,
          checkpoints: command.checkpoints.map((checkpoint): LedgerCheckpoint => ({
            id: checkpoint.id,
            title: checkpoint.title,
            reached: false,
            reachedAt: null,
          })),
          winConditions: command.winConditions,
          items: command.items.map((draft) => newItem(draft, now)),
          ...(stampedRequiresJudge ? { requiresJudge: true } : {}),
          createdAt: now,
          updatedAt: now,
          closedAt: null,
        },
      },
    ]);
  }

  if (ledger === undefined) return reject(`Thread ${command.threadId} has no ledger.`);
  if (ledger.id !== command.ledgerId) {
    return reject(`Unknown ledger ${command.ledgerId}; the thread's ledger is ${ledger.id}.`);
  }

  if (command.type === "ledger.reopen") {
    if (ledger.closedAt === null) return reject(`Ledger ${ledger.id} is not closed.`);
    return Result.succeed([
      { type: "ledger.reopened", payload: { ledgerId: ledger.id, updatedAt: now } },
    ]);
  }

  // Everything below edits the ledger, which a closed ledger refuses until it is reopened.
  if (ledger.closedAt !== null) {
    return reject(
      command.type === "ledger.close"
        ? `Ledger ${ledger.id} is already closed.`
        : `Ledger ${ledger.id} is closed. Reopen it before changing it.`,
    );
  }

  switch (command.type) {
    case "ledger.close": {
      const unfinished = ledger.items.filter(
        (item) => item.status === "open" || item.status === "in_progress",
      );
      if (unfinished.length > 0) {
        return reject(
          `Ledger ${ledger.id} cannot close: items still open or in progress: ${unfinished.map((item) => item.id).join(", ")}. Close or drop them first.`,
        );
      }
      return Result.succeed([
        { type: "ledger.closed", payload: { ledgerId: ledger.id, closedAt: now, updatedAt: now } },
      ]);
    }
    case "ledger.item.add": {
      if (command.items.length === 0) return reject("Add at least one item.");
      const duplicate = duplicateId([
        ...ledger.items.map((item) => item.id),
        ...command.items.map((item) => item.id),
      ]);
      if (duplicate !== undefined) return reject(`Duplicate item id ${duplicate}.`);
      return Result.succeed([
        {
          type: "ledger.item.added",
          payload: {
            ledgerId: ledger.id,
            items: command.items.map((draft) => newItem(draft, now)),
            updatedAt: now,
          },
        },
      ]);
    }
    case "ledger.checkpoint.set": {
      const checkpoint = ledger.checkpoints.find(({ id }) => id === command.checkpointId);
      if (checkpoint === undefined) return reject(`Unknown checkpoint ${command.checkpointId}.`);
      if (checkpoint.reached === command.reached) return Result.succeed([]);
      return Result.succeed([
        {
          type: "ledger.checkpoint.updated",
          payload: {
            ledgerId: ledger.id,
            checkpoint: {
              ...checkpoint,
              reached: command.reached,
              reachedAt: command.reached ? now : null,
            },
            updatedAt: now,
          },
        },
      ]);
    }
    case "ledger.item.verdict.record": {
      const item = ledger.items.find(({ id }) => id === command.itemId);
      if (item === undefined) return reject(`Unknown item ${command.itemId}.`);
      if (item.status === "closed" || item.status === "dropped") {
        return reject(`Item ${item.id} is ${item.status}. Reopen it before judging it.`);
      }
      if (command.judgedEvidence !== undefined && command.judgedEvidence !== item.evidence) {
        return reject(`Item ${item.id} evidence changed while it was being judged.`);
      }
      // A passing verdict only unlocks closing; the agent still closes the item itself.
      return Result.succeed([
        {
          type: "ledger.item.updated",
          payload: {
            ledgerId: ledger.id,
            item: {
              ...item,
              verdict: command.verdict,
              judgements: (item.judgements ?? 0) + 1,
              updatedAt: now,
            },
            updatedAt: now,
          },
        },
      ]);
    }
    case "ledger.item.update": {
      const item = ledger.items.find(({ id }) => id === command.itemId);
      if (item === undefined) return reject(`Unknown item ${command.itemId}.`);
      const target = command.status ?? item.status;
      const changesStatus = target !== item.status;

      if (changesStatus && !LEGAL_TRANSITIONS[item.status].includes(target)) {
        return reject(`Item ${item.id} cannot go from ${item.status} to ${target}.`);
      }
      if (!changesStatus && (item.status === "closed" || item.status === "dropped")) {
        return reject(`Item ${item.id} is ${item.status}. Reopen it to change it.`);
      }
      // Reopening a finished item starts it over; un-starting an in-progress item only changes
      // its status and keeps the evidence gathered so far.
      if (target === "open" && changesStatus && item.status !== "in_progress") {
        if (command.evidence !== undefined || command.dropReason !== undefined) {
          return reject(
            "Reopening an item clears its evidence and drop reason; do not supply them.",
          );
        }
        return Result.succeed([
          {
            type: "ledger.item.updated",
            payload: {
              ledgerId: ledger.id,
              item: {
                ...item,
                status: "open",
                evidence: null,
                dropReason: null,
                verdict: null,
                closedAt: null,
                updatedAt: now,
              },
              updatedAt: now,
            },
          },
        ]);
      }

      const evidence = command.evidence === undefined ? item.evidence : command.evidence;
      const dropReason = command.dropReason === undefined ? item.dropReason : command.dropReason;
      // Skipping in_progress is allowed only when the same update brings the evidence.
      if (target === "closed" && item.status === "open" && isBlank(command.evidence)) {
        return reject(`Item ${item.id} needs evidence in the same update to close from open.`);
      }
      if (target === "closed" && isBlank(evidence)) {
        return reject(`Item ${item.id} needs non-empty evidence to close.`);
      }
      if (target === "dropped" && isBlank(dropReason)) {
        return reject(`Item ${item.id} needs a non-empty dropReason to be dropped.`);
      }
      if (target !== "dropped" && command.dropReason !== undefined && command.dropReason !== null) {
        return reject("A dropReason only applies when dropping an item.");
      }
      // A verdict judged the evidence as it stood, so changed evidence needs a fresh one;
      // otherwise pass, edit the evidence, close would sidestep the judge gate.
      const verdict = evidence === item.evidence ? item.verdict : null;
      if (target === "closed" && requiresJudge && verdict?.outcome !== "pass") {
        return reject(`Item ${item.id} needs a passing judge verdict to close.`);
      }

      // A closed or dropped item never reaches here without changing status, so `closedAt` is
      // only ever stamped by the transition into closed.
      const next: LedgerItem = {
        ...item,
        status: target,
        evidence,
        dropReason: target === "dropped" ? dropReason : null,
        verdict,
        closedAt: target === "closed" ? now : null,
        updatedAt: now,
      };
      if (!changesStatus && evidence === item.evidence && next.dropReason === item.dropReason) {
        return Result.succeed([]);
      }
      return Result.succeed([
        {
          type: "ledger.item.updated",
          payload: { ledgerId: ledger.id, item: next, updatedAt: now },
        },
      ]);
    }
  }
}
