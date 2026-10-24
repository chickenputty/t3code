import type { Ledger, OrchestrationV2DomainEvent } from "@t3tools/contracts";

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
