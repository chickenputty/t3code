import type { Ledger, LedgerItem, ScopedThreadRef } from "@t3tools/contracts";
import {
  deriveLedgerProgress,
  formatLedgerProgress,
  LEDGER_ITEM_STATUS_LABELS,
} from "@t3tools/client-runtime/state/thread-ledger";
import { CircleCheckIcon, CircleDotIcon, CircleIcon, CircleMinusIcon } from "lucide-react";
import type { ComponentType } from "react";

import { useThreadLedgerIfSupported } from "~/hooks/useThreadLedgerIfSupported";
import { Badge } from "../ui/badge";
import { ThreadTabSection } from "../thread/ThreadOverviewTab";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

const ITEM_STATUS_PRESENTATION: Record<
  LedgerItem["status"],
  {
    readonly Icon: ComponentType<{ className?: string }>;
    readonly iconClass: string;
    readonly badge: "outline" | "info" | "success" | "secondary";
  }
> = {
  open: { Icon: CircleIcon, iconClass: "text-muted-foreground", badge: "outline" },
  in_progress: { Icon: CircleDotIcon, iconClass: "text-info", badge: "info" },
  closed: { Icon: CircleCheckIcon, iconClass: "text-success", badge: "success" },
  dropped: { Icon: CircleMinusIcon, iconClass: "text-muted-foreground/60", badge: "secondary" },
};

function LedgerItemRow({ item }: { item: LedgerItem }) {
  const { Icon, iconClass, badge } = ITEM_STATUS_PRESENTATION[item.status];
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-start gap-2">
        <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${iconClass}`} />
        <span
          className={
            item.status === "dropped"
              ? "min-w-0 flex-1 break-words text-sm text-muted-foreground line-through"
              : "min-w-0 flex-1 break-words text-sm font-medium text-foreground/80"
          }
        >
          {item.title}
        </span>
        <Badge variant={badge} size="sm">
          {LEDGER_ITEM_STATUS_LABELS[item.status]}
        </Badge>
      </div>
      <div className="flex flex-col gap-0.5 ps-6 text-2xs text-muted-foreground">
        {item.acceptance.trim() === "" ? null : (
          <p className="line-clamp-3 break-words">Done when: {item.acceptance}</p>
        )}
        {item.evidence === null || item.evidence.trim() === "" ? null : (
          <p className="line-clamp-4 break-words">Evidence: {item.evidence}</p>
        )}
        {item.dropReason === null || item.dropReason.trim() === "" ? null : (
          <p className="line-clamp-3 break-words">Dropped: {item.dropReason}</p>
        )}
        {item.verdict === null ? null : (
          <p className="flex flex-wrap items-center gap-1.5 break-words">
            <Badge variant={item.verdict.outcome === "pass" ? "success" : "error"} size="sm">
              Judge {item.verdict.outcome === "pass" ? "passed" : "failed"}
            </Badge>
            <span className="min-w-0 break-words">{item.verdict.notes}</span>
          </p>
        )}
      </div>
    </li>
  );
}

function LedgerList({ heading, entries }: { heading: string; entries: ReadonlyArray<string> }) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-2xs font-medium text-muted-foreground">{heading}</p>
      <ul className="m-0 list-disc ps-4 text-xs text-foreground/80 marker:text-muted-foreground/60">
        {entries.map((entry, index) => (
          // Win conditions are bare strings with no id; the list is replaced whole, never reordered.
          // oxlint-disable-next-line react/no-array-index-key
          <li key={`${index}:${entry}`} className="break-words">
            {entry}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThreadLedgerView({ ledger }: { ledger: Ledger }) {
  const progress = deriveLedgerProgress(ledger);
  return (
    <div data-thread-ledger-panel className="flex flex-col gap-3 px-2.5 py-1">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-medium text-foreground/80">{ledger.title}</p>
        <Badge variant={ledger.closedAt === null ? "info" : "secondary"} size="sm">
          {ledger.closedAt === null ? "Active" : "Closed"}
        </Badge>
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">{formatLedgerProgress(progress)}</p>
      {ledger.startState.trim() === "" ? null : (
        <p className="line-clamp-4 break-words text-2xs text-muted-foreground">
          Started from: {ledger.startState}
        </p>
      )}
      <LedgerList heading="Win conditions" entries={ledger.winConditions} />
      {ledger.checkpoints.length === 0 ? null : (
        <div className="flex flex-col gap-0.5">
          <p className="text-2xs font-medium text-muted-foreground">Checkpoints</p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {ledger.checkpoints.map((checkpoint) => (
              <li key={checkpoint.id} className="flex items-start gap-2 text-xs">
                {checkpoint.reached ? (
                  <CircleCheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
                ) : (
                  <CircleIcon
                    aria-hidden
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="min-w-0 break-words text-foreground/80">{checkpoint.title}</span>
                <span className="sr-only">{checkpoint.reached ? "reached" : "not reached"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {ledger.items.map((item) => (
          <LedgerItemRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

/** The ledger in the thread details card; renders nothing without a ledger or the capability. */
export function ThreadLedgerDetailsSection({ threadRef }: { threadRef: ScopedThreadRef }) {
  const ledger = useThreadLedgerIfSupported(threadRef);
  if (ledger === null) return null;
  return (
    <ThreadDetailsSection headingId="thread-details-ledger-heading" title="Task ledger">
      <ThreadLedgerView ledger={ledger} />
    </ThreadDetailsSection>
  );
}

/** The ledger in the Overview tab; renders nothing without a ledger or the capability. */
export function ThreadLedgerOverviewSection({ threadRef }: { threadRef: ScopedThreadRef }) {
  const ledger = useThreadLedgerIfSupported(threadRef);
  if (ledger === null) return null;
  return (
    <ThreadTabSection title="Task ledger">
      <ThreadLedgerView ledger={ledger} />
    </ThreadTabSection>
  );
}

/** A small count in the header while the ledger has unfinished work, gone once it settles. */
export function ThreadLedgerHeaderProgress({ threadRef }: { threadRef: ScopedThreadRef }) {
  const ledger = useThreadLedgerIfSupported(threadRef);
  if (ledger === null) return null;
  const progress = deriveLedgerProgress(ledger);
  if (!progress.active) return null;
  return (
    <Badge variant="info" size="sm">
      <span aria-hidden>
        Ledger {progress.closed}/{progress.total - progress.dropped}
      </span>
      <span className="sr-only">Task ledger: {formatLedgerProgress(progress)}</span>
    </Badge>
  );
}
