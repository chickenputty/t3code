import type { Ledger, LedgerMcpSnapshot } from "@t3tools/contracts";

/** The compact ledger view every ledger tool result carries. */
export function snapshotLedger(ledger: Ledger): LedgerMcpSnapshot {
  const counts = { open: 0, in_progress: 0, closed: 0, dropped: 0 };
  for (const item of ledger.items) counts[item.status] += 1;
  return {
    ledgerId: ledger.id,
    title: ledger.title,
    startState: ledger.startState,
    winConditions: ledger.winConditions,
    closed: ledger.closedAt !== null,
    requiresJudge: ledger.requiresJudge === true,
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
      judgements: item.judgements ?? 0,
    })),
  };
}
