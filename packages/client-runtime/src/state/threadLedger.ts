import type { Ledger, LedgerItemStatus } from "@t3tools/contracts";

export interface LedgerProgress {
  readonly total: number;
  readonly closed: number;
  readonly dropped: number;
  /** Items still to do, which is what the server's auto-continue keeps working on. */
  readonly remaining: number;
  /** The ledger has unfinished work: not closed, and an item is open or in progress. */
  readonly active: boolean;
}

export const LEDGER_ITEM_STATUS_LABELS: Record<LedgerItemStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  closed: "Done",
  dropped: "Dropped",
};

export function deriveLedgerProgress(ledger: Ledger): LedgerProgress {
  const counts: Record<LedgerItemStatus, number> = {
    open: 0,
    in_progress: 0,
    closed: 0,
    dropped: 0,
  };
  for (const item of ledger.items) counts[item.status] += 1;
  const remaining = counts.open + counts.in_progress;
  return {
    total: ledger.items.length,
    closed: counts.closed,
    dropped: counts.dropped,
    remaining,
    active: ledger.closedAt === null && remaining > 0,
  };
}

/**
 * Dropped items are out of the denominator: they were set aside, so "5 of 7 done" stays
 * reachable when one of eight was dropped.
 */
export function formatLedgerProgress(progress: LedgerProgress): string {
  const scope = progress.total - progress.dropped;
  const dropped = progress.dropped > 0 ? ` · ${progress.dropped} dropped` : "";
  if (progress.total === 0) return "No items yet";
  if (scope === 0) return `All ${progress.dropped} dropped`;
  return `${progress.closed} of ${scope} done${dropped}`;
}
