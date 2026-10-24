/** Fork (chickenputty/t3code): the thread's retro and its recommendations, under the Timing section. */
import { useAtomValue } from "@effect/atom-react";
import type { RetroRecommendation, ScopedThreadRef, TaskRetro } from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { formatRelativeMs } from "~/components/views/viewEngine";
import { useServerConfigs } from "~/state/entities";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

const STRUCTURE_LABEL = {
  less: "Less structure would have done",
  same: "The structure was right",
  more: "More structure would have helped",
} as const;

const VERDICT_LABEL = { right: "right", too_weak: "too weak", too_strong: "too strong" } as const;

function describe(recommendation: RetroRecommendation): string {
  if (recommendation.kind === "thread_loadout") {
    return `Run this thread under the "${recommendation.loadoutId}" loadout`;
  }
  const effort = recommendation.effort === undefined ? "" : ` (${recommendation.effort})`;
  return `In the "${recommendation.loadoutId}" loadout, run the ${recommendation.role} on ${recommendation.model}${effort}`;
}

function RetroBody({
  retro,
  nowMs,
  resolving,
  onResolve,
}: {
  retro: TaskRetro;
  nowMs: number;
  resolving: string | null;
  onResolve: (recommendationId: string, action: "apply" | "dismiss") => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        Run {retro.run} by {retro.judge.model},{" "}
        {formatRelativeMs(Date.parse(retro.createdAt), nowMs)} ago
        {retro.parsed
          ? ""
          : ". The answer had no readable summary block, so there are no recommendations"}
      </p>
      {retro.structure === null ? null : (
        <span className="font-medium text-sm">{STRUCTURE_LABEL[retro.structure]}</span>
      )}
      {retro.summary === "" ? null : <p className="whitespace-pre-wrap text-sm">{retro.summary}</p>}
      {retro.slowCauses.length > 0 ? (
        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs">
          {retro.slowCauses.map((cause) => (
            <li key={cause}>{cause}</li>
          ))}
        </ul>
      ) : null}
      {retro.modelVerdicts.length > 0 ? (
        <div className="flex flex-col gap-0.5 text-muted-foreground text-xs">
          {retro.modelVerdicts.map((verdict) => (
            <span key={`${verdict.role}:${verdict.verdict}`}>
              {verdict.role}: model {VERDICT_LABEL[verdict.verdict]}
              {verdict.note === "" ? "" : `, ${verdict.note}`}
            </span>
          ))}
        </div>
      ) : null}
      {retro.recommendations.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="font-medium text-xs">Recommendations</span>
          {retro.recommendations.map((recommendation) => (
            <div
              key={recommendation.id}
              className="flex flex-col gap-1 rounded-lg border border-border/60 px-3 py-2"
            >
              <span className="text-sm">{describe(recommendation)}</span>
              {recommendation.note === "" ? null : (
                <span className="text-muted-foreground text-xs">{recommendation.note}</span>
              )}
              {recommendation.status === "pending" ? (
                <div className="flex gap-2">
                  <Button
                    size="compact"
                    disabled={resolving !== null}
                    onClick={() => onResolve(recommendation.id, "apply")}
                  >
                    Apply
                  </Button>
                  <Button
                    size="compact"
                    variant="outline"
                    disabled={resolving !== null}
                    onClick={() => onResolve(recommendation.id, "dismiss")}
                  >
                    Dismiss
                  </Button>
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {recommendation.status === "applied"
                    ? "Applied. Edit the loadout in settings to undo it."
                    : "Dismissed"}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Runs and shows the thread's retro. Nothing here applies a recommendation on its own: each one
 * waits for a person to press Apply or Dismiss.
 */
export function ThreadRetroSection({
  threadRef,
  nowMs,
}: {
  threadRef: ScopedThreadRef;
  nowMs: number;
}) {
  const serverConfigs = useServerConfigs();
  const supported =
    serverConfigs.get(threadRef.environmentId)?.environment.capabilities.taskRetro === true;
  const atom = supported
    ? orchestrationEnvironment.taskRetro({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      })
    : null;
  const { data, error, refresh } = useEnvironmentQuery(atom);
  const runRetro = useAtomCommand(orchestrationEnvironment.runTaskRetro);
  const resolveRetro = useAtomCommand(orchestrationEnvironment.resolveTaskRetro);
  const canRun = useAtomValue(
    orchestrationEnvironment.runTaskRetro.permissionAtom(threadRef.environmentId),
  );
  const [running, setRunning] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  if (!supported) return null;

  const run = async () => {
    setRunning(true);
    const result = await runRetro({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    setRunning(false);
    if (result._tag === "Success") refresh();
    else toastManager.add({ type: "error", title: "The retro did not finish" });
  };
  const resolve = async (recommendationId: string, action: "apply" | "dismiss") => {
    setResolving(recommendationId);
    const result = await resolveRetro({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, recommendationId, action },
    });
    setResolving(null);
    if (result._tag === "Success") refresh();
    else toastManager.add({ type: "error", title: `Could not ${action} the recommendation` });
  };

  return (
    <section className="mb-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-sm">Retro</h3>
        <Button size="compact" variant="outline" disabled={!canRun || running} onClick={run}>
          {running ? "Running retro…" : data === null ? "Run retro" : "Run again"}
        </Button>
      </div>
      {data !== null ? (
        <RetroBody retro={data} nowMs={nowMs} resolving={resolving} onResolve={resolve} />
      ) : error !== null ? (
        <p className="text-muted-foreground text-xs">The retro is unavailable: {error}</p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Ask a strong model why this task was slow, whether the models and the agent structure were
          right, and what to change. It takes a few minutes.
        </p>
      )}
    </section>
  );
}
