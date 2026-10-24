/** Fork (chickenputty/t3code): a thread's turns, newest first, with what each one did. */
import type { OrchestrationV2RunStatus, ScopedThreadRef } from "@t3tools/contracts";

import {
  formatDuration,
  formatTokens,
  type InspectorModel,
} from "~/components/views/inspectorModel";
import { formatRelativeMs } from "~/components/views/viewEngine";

import { ThreadTimingSection } from "./ThreadTimingSection";

// `satisfies` makes a renamed or removed run status a type error here; mirrors the server's runIsLive.
const LIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
] satisfies ReadonlyArray<OrchestrationV2RunStatus>);

export function ThreadActivityTab({
  model,
  nowMs,
  threadRef,
}: {
  model: InspectorModel;
  nowMs: number;
  threadRef: ScopedThreadRef;
}) {
  if (model.runs.length === 0)
    return <p className="text-muted-foreground text-sm">No turns yet.</p>;
  // The timing only changes in step with a finished turn, so that turn's id is the refetch key.
  const lastFinished = model.runs.findLast((run) => !LIVE_RUN_STATUSES.has(run.status));
  return (
    <>
      <ThreadTimingSection
        threadRef={threadRef}
        activityKey={lastFinished?.id ?? ""}
        nowMs={nowMs}
      />
      <ActivityTurns model={model} nowMs={nowMs} />
    </>
  );
}

function ActivityTurns({ model, nowMs }: { model: InspectorModel; nowMs: number }) {
  return (
    <ol className="flex flex-col gap-3">
      {model.runs.toReversed().map((run) => {
        const counts = new Map<string, number>();
        for (const item of run.activity) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
        return (
          <li
            key={run.id}
            className="flex flex-col gap-1.5 rounded-lg border border-border/60 px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">Turn {run.ordinal}</span>
              <span className="text-muted-foreground text-xs">{run.status.replace("_", " ")}</span>
              <span className="text-muted-foreground text-xs">{run.model}</span>
              <span className="text-muted-foreground text-xs">
                {formatRelativeMs(run.requestedMs, nowMs)} ago
              </span>
              {run.durationMs !== null ? (
                <span className="text-muted-foreground text-xs">
                  {formatDuration(run.durationMs)}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
              {[...counts].map(([type, count]) => (
                <span key={type}>
                  {count} {type.replaceAll("_", " ")}
                </span>
              ))}
              {run.filesChanged > 0 ? <span>{run.filesChanged} file changes</span> : null}
              {run.inputTokens + run.outputTokens > 0 ? (
                <span>
                  {formatTokens(run.inputTokens)} in / {formatTokens(run.outputTokens)} out
                </span>
              ) : null}
            </div>
            {run.activity.some((item) => item.title) ? (
              <ul className="flex flex-col gap-0.5 text-xs">
                {run.activity
                  .filter((item) => item.title)
                  .slice(0, 8)
                  .map((item) => (
                    <li key={item.id} className="truncate text-muted-foreground">
                      {item.title}
                    </li>
                  ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
