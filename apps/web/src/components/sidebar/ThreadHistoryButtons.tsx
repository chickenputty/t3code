/**
 * Fork (chickenputty/t3code): back and forward through the threads you
 * opened, like a browser's buttons, and the recorder that keeps that history.
 */
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams, resolveThreadRouteRef } from "~/threadRoutes";
import { findThreadStep, useThreadVisitsStore } from "./threadVisits";

function useRouteThreadKey(): string | null {
  return useParams({
    strict: false,
    select: (params) => {
      const ref = resolveThreadRouteRef(params);
      return ref === null ? null : scopedThreadKey(ref);
    },
  });
}

/** Records every thread opened, however it was opened. Mounted once, with the app layout. */
export function ThreadVisitRecorder() {
  const threadKey = useRouteThreadKey();
  const recordOpen = useThreadVisitsStore((state) => state.recordOpen);
  useEffect(() => {
    if (threadKey !== null) recordOpen(threadKey);
  }, [recordOpen, threadKey]);
  return null;
}

function HistoryButton(props: {
  readonly direction: "Back" | "Forward";
  readonly targetTitle: string | null;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  const label =
    props.targetTitle === null
      ? `${props.direction} (no thread to go to)`
      : `${props.direction} to ${props.targetTitle}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={label}
            disabled={props.targetTitle === null}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

/** The chat header's back and forward buttons. */
export function ThreadHistoryButtons() {
  const navigate = useNavigate();
  const currentKey = useRouteThreadKey();
  const trail = useThreadVisitsStore((state) => state.trail);
  const index = useThreadVisitsStore((state) => state.index);
  const moveTo = useThreadVisitsStore((state) => state.moveTo);
  const shells = useThreadShells();
  const titleByKey = useMemo(
    () =>
      new Map(
        shells.map(
          (shell) =>
            [scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)), shell.title] as const,
        ),
      ),
    [shells],
  );
  // Deleted threads stay in the history but are skipped.
  const visits = { openedAt: {}, trail, index, pending: null };
  const exists = (threadKey: string) => titleByKey.has(threadKey);
  const back = findThreadStep(visits, -1, currentKey, exists);
  const forward = findThreadStep(visits, 1, currentKey, exists);

  const go = (step: typeof back) => {
    const ref = step === null ? null : parseScopedThreadKey(step.threadKey);
    if (step === null || ref === null) return;
    moveTo(step);
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  return (
    <div className="flex shrink-0 items-center" data-testid="thread-history-buttons">
      <HistoryButton
        direction="Back"
        targetTitle={back === null ? null : (titleByKey.get(back.threadKey) ?? null)}
        onClick={() => go(back)}
      >
        <ArrowLeftIcon />
      </HistoryButton>
      <HistoryButton
        direction="Forward"
        targetTitle={forward === null ? null : (titleByKey.get(forward.threadKey) ?? null)}
        onClick={() => go(forward)}
      >
        <ArrowRightIcon />
      </HistoryButton>
    </div>
  );
}
