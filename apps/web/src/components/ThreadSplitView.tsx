import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

import ChatView from "./ChatView";
import { ChatPaneContext, type ChatPaneValue } from "./chat/ChatPaneContext";
import { cn } from "~/lib/utils";
import { useThreadShell } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import {
  clampThreadSplitRatio,
  THREAD_SPLIT_MAX_RATIO,
  THREAD_SPLIT_MIN_RATIO,
  useThreadSplitStore,
  type ThreadSplitPane,
} from "../threadSplitStore";

// Arrow keys on the focused divider move it by this share of the width.
const KEYBOARD_RATIO_STEP = 0.05;

/**
 * The routed thread, plus the split thread beside it when there is one. The
 * primary pane renders at the same tree position either way, so opening or
 * closing a split never remounts the routed ChatView.
 *
 * While split, each pane is a layout containment boundary, so the
 * fixed-position titlebar controls inside ChatView anchor to their own pane
 * instead of both landing on the window's top-right corner.
 */
export function ThreadSplitView({
  primary,
  secondaryThreadRef,
}: {
  primary: ReactNode;
  secondaryThreadRef: ScopedThreadRef | null;
}) {
  const split = secondaryThreadRef !== null;
  const containerRef = useRef<HTMLDivElement>(null);
  const ratio = useThreadSplitStore((state) => state.ratio);
  const setRatio = useThreadSplitStore((state) => state.setRatio);

  // Dragging writes the CSS variable directly and commits once on release, so
  // the two ChatViews do not re-render on every pointer move.
  const onDividerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || event.button !== 0) return;
      event.preventDefault();
      const divider = event.currentTarget;
      divider.setPointerCapture(event.pointerId);
      const bounds = container.getBoundingClientRect();
      let nextRatio = ratio;
      const onMove = (moveEvent: PointerEvent) => {
        nextRatio = clampThreadSplitRatio((moveEvent.clientX - bounds.left) / bounds.width);
        container.style.setProperty("--thread-split-ratio", String(nextRatio));
      };
      const onUp = () => {
        divider.removeEventListener("pointermove", onMove);
        divider.removeEventListener("pointerup", onUp);
        divider.removeEventListener("pointercancel", onUp);
        setRatio(nextRatio);
      };
      divider.addEventListener("pointermove", onMove);
      divider.addEventListener("pointerup", onUp);
      divider.addEventListener("pointercancel", onUp);
    },
    [ratio, setRatio],
  );

  const onDividerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") setRatio(ratio - KEYBOARD_RATIO_STEP);
      else if (event.key === "ArrowRight") setRatio(ratio + KEYBOARD_RATIO_STEP);
      else return;
      event.preventDefault();
    },
    [ratio, setRatio],
  );

  // The store value wins again whenever it changes (release, keyboard, reset).
  useEffect(() => {
    containerRef.current?.style.setProperty("--thread-split-ratio", String(ratio));
  }, [ratio]);

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 w-full min-w-0"
      style={{ "--thread-split-ratio": String(ratio) } as React.CSSProperties}
    >
      <ChatPane
        pane="primary"
        split={split}
        className={
          split
            ? // The window's native caption buttons sit over the right pane, so the
              // left pane gives up the inset reserved for them.
              "basis-[calc(var(--thread-split-ratio)*100%)] [--workspace-controls-right:0.75rem] [--workspace-native-controls-inset:0px]"
            : "flex-1"
        }
      >
        {primary}
      </ChatPane>
      {secondaryThreadRef ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize split view"
            aria-valuemin={Math.round(THREAD_SPLIT_MIN_RATIO * 100)}
            aria-valuemax={Math.round(THREAD_SPLIT_MAX_RATIO * 100)}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            className="relative z-10 w-px shrink-0 cursor-col-resize bg-border outline-none after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[''] hover:bg-ring focus-visible:bg-ring"
            onPointerDown={onDividerPointerDown}
            onKeyDown={onDividerKeyDown}
            onDoubleClick={() => setRatio(0.5)}
          />
          <ChatPane
            pane="secondary"
            split
            // The sidebar's collapsed-state titlebar inset belongs to the left pane only.
            className="flex-1 [--workspace-titlebar-content-left:var(--workspace-gutter-start)]"
          >
            <SecondaryThreadPane threadRef={secondaryThreadRef} />
          </ChatPane>
        </>
      ) : null}
    </div>
  );
}

function ChatPane({
  pane,
  split,
  className,
  children,
}: {
  pane: ThreadSplitPane;
  split: boolean;
  className: string;
  children: ReactNode;
}) {
  // A lone pane is always the focused one, whatever the store remembers.
  const isFocusedPane = useThreadSplitStore((state) => !split || state.focusedPane === pane);
  const focusPane = useThreadSplitStore((state) => state.focusPane);
  const closeSplit = useThreadSplitStore((state) => state.closeSplit);
  const value = useMemo<ChatPaneValue>(
    () => ({ isFocusedPane, ...(pane === "secondary" ? { onClosePane: closeSplit } : {}) }),
    [closeSplit, isFocusedPane, pane],
  );
  return (
    <ChatPaneContext value={value}>
      <div
        data-thread-split-pane={pane}
        data-focused={(split && isFocusedPane) || undefined}
        className={cn("flex min-h-0 min-w-0 shrink-0", split && "[contain:layout]", className)}
        onPointerDownCapture={
          split
            ? (event) => {
                // A click on non-focusable content (the timeline) leaves DOM focus
                // where it was; drop focus held in the other pane so typing
                // follows the pane the user just clicked.
                const active = document.activeElement;
                if (
                  active instanceof HTMLElement &&
                  !event.currentTarget.contains(active) &&
                  active.closest("[data-thread-split-pane]") !== null
                ) {
                  active.blur();
                }
                focusPane(pane);
              }
            : undefined
        }
        onFocusCapture={split ? () => focusPane(pane) : undefined}
      >
        {children}
      </div>
    </ChatPaneContext>
  );
}

/** The split thread, closed automatically once it is gone (deleted, or never existed). */
function SecondaryThreadPane({ threadRef }: { threadRef: ScopedThreadRef }) {
  const closeSplit = useThreadSplitStore((state) => state.closeSplit);
  const thread = useThreadShell(threadRef);
  const shell = useEnvironmentQuery(environmentShell.stateAtom(threadRef.environmentId));
  const bootstrapComplete = shell.data?.snapshot._tag === "Some";
  const missing = bootstrapComplete && (thread === null || thread.deletedAt != null);

  useEffect(() => {
    if (missing) closeSplit();
  }, [closeSplit, missing]);

  if (thread === null || missing) return null;
  return (
    <ChatView
      key={scopedThreadKey(threadRef)}
      environmentId={threadRef.environmentId}
      threadId={threadRef.threadId}
      routeKind="server"
    />
  );
}
