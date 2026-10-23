import type {
  Ledger,
  LedgerItem,
  OrchestrationV2ConversationMessage,
  OrchestrationV2DomainEvent,
} from "@t3tools/contracts";

/** Consecutive server follow-ups per thread before it stops and waits for the user. */
export const LEDGER_AUTO_CONTINUE_CAP = 5;

export type LedgerAutoContinueDecision =
  | { readonly type: "idle" }
  | {
      readonly type: "continue";
      readonly round: number;
      readonly open: ReadonlyArray<LedgerItem>;
      readonly items: ReadonlyArray<Pick<LedgerItem, "id" | "status">>;
    }
  | {
      readonly type: "stuck";
      readonly reason: "cap" | "stalled";
      readonly openIds: ReadonlyArray<LedgerItem["id"]>;
    };

type LedgerContinueMessage = Pick<
  OrchestrationV2ConversationMessage,
  "role" | "createdBy" | "creationSource" | "notification"
> & { readonly runId?: OrchestrationV2ConversationMessage["runId"] };

const isOpen = (item: Pick<LedgerItem, "status">) =>
  item.status === "open" || item.status === "in_progress";

const signatureOf = (items: ReadonlyArray<Pick<LedgerItem, "id" | "status">>) =>
  items
    .map((item) => `${item.id}:${item.status}`)
    .sort()
    .join("\n");

/**
 * What the server does when a run ends and the thread's ledger may still have work. Derived from
 * the ledger and the thread's messages alone: each follow-up records its round and the item
 * statuses it was sent against, so the streak since the user last spoke is both the counter and
 * the progress check, and neither can drift from the event log. The server calls this when a run
 * ends and records a stop as a timeline notice; clients render that notice and do not re-derive it.
 *
 * `messages` is chronological. Only a message the user sent resets the streak; the server's own
 * wakes (limit resume, restart continuation, other notifications) neither count nor reset it.
 *
 * A follow-up in that streak whose run is in `cancelledRunIds` means the user declined it, so the
 * thread stays quiet until their next message.
 */
export function decideLedgerAutoContinue(input: {
  readonly ledger: Ledger | undefined;
  readonly messages: ReadonlyArray<LedgerContinueMessage>;
  readonly cancelledRunIds?: ReadonlySet<string>;
}): LedgerAutoContinueDecision {
  const { ledger } = input;
  if (ledger === undefined || ledger.closedAt !== null) return { type: "idle" };
  const open = ledger.items.filter(isOpen);
  if (open.length === 0) return { type: "idle" };

  let streak = 0;
  let previous: ReadonlyArray<Pick<LedgerItem, "id" | "status">> | undefined;
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index]!;
    if (message.role !== "user") continue;
    if (message.notification?.source.kind === "ledger_continue") {
      if (message.runId != null && input.cancelledRunIds?.has(message.runId) === true) {
        return { type: "idle" };
      }
      streak += 1;
      previous ??= message.notification.source.items;
    } else if (message.createdBy === "user" && message.creationSource !== "server") {
      break;
    }
  }

  const items = ledger.items.map(({ id, status }) => ({ id, status }));
  if (streak >= LEDGER_AUTO_CONTINUE_CAP) {
    return { type: "stuck", reason: "cap", openIds: open.map((item) => item.id) };
  }
  if (previous !== undefined && signatureOf(previous) === signatureOf(items)) {
    return { type: "stuck", reason: "stalled", openIds: open.map((item) => item.id) };
  }
  return { type: "continue", round: streak + 1, open, items };
}

export type LedgerDomainEvent = Extract<
  OrchestrationV2DomainEvent,
  { readonly type: `ledger.${string}` }
>;

/**
 * The one reducer for a thread's ledger. The server projection and every client fold events
 * through it so they cannot disagree. An event for a ledger other than the current one is a
 * stale write for a replaced ledger and changes nothing.
 */
export function applyLedgerEvent(
  ledger: Ledger | undefined,
  event: LedgerDomainEvent,
): Ledger | undefined {
  if (event.type === "ledger.created") return event.payload;
  if (ledger === undefined || ledger.id !== event.payload.ledgerId) return ledger;
  switch (event.type) {
    case "ledger.item.added": {
      const items = [...ledger.items];
      for (const added of event.payload.items) {
        const index = items.findIndex((item) => item.id === added.id);
        if (index === -1) items.push(added);
        else items[index] = added;
      }
      return { ...ledger, items, updatedAt: event.payload.updatedAt };
    }
    case "ledger.item.updated":
      return {
        ...ledger,
        items: ledger.items.map((item) =>
          item.id === event.payload.item.id ? event.payload.item : item,
        ),
        updatedAt: event.payload.updatedAt,
      };
    case "ledger.checkpoint.updated":
      return {
        ...ledger,
        checkpoints: ledger.checkpoints.map((checkpoint) =>
          checkpoint.id === event.payload.checkpoint.id ? event.payload.checkpoint : checkpoint,
        ),
        updatedAt: event.payload.updatedAt,
      };
    case "ledger.closed":
      return { ...ledger, closedAt: event.payload.closedAt, updatedAt: event.payload.updatedAt };
    case "ledger.reopened":
      return { ...ledger, closedAt: null, updatedAt: event.payload.updatedAt };
  }
}
