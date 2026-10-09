import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  canSnooze,
  effectiveSnoozed,
  resolveSnoozePresets,
} from "@t3tools/client-runtime/state/thread-settled";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { deleteSelectedThreadEntries } from "~/components/Sidebar.logic";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useThreadActions } from "~/hooks/useThreadActions";
import { readLocalApi } from "~/localApi";
import { readEnvironmentSupportsSnooze } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { type MoveStep, planSectionMove, type ViewRow, type ViewSection } from "./viewEngine";

export type ViewBulkAction =
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "snooze"
  | "unsnooze"
  | "mark-unread"
  | "archive"
  | "unarchive"
  | "delete";

function errorToast(title: string, description: string) {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
}

async function report(title: string, run: () => Promise<AtomCommandResult<unknown, unknown>>) {
  const result = await run();
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    errorToast(title, error instanceof Error ? error.message : "An error occurred.");
    return false;
  }
  return true;
}

/**
 * The thread mutations a view performs, through the same commands as the
 * sidebar.
 */
export function useViewThreadOps() {
  const {
    pinThread,
    confirmAndUnpinThread,
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    archiveThread,
    unarchiveThread,
    deleteThread,
    markThreadUnread,
  } = useThreadActions();
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

  const snoozeUntilTomorrow = useCallback(
    (ref: ScopedThreadRef) => {
      const presets = resolveSnoozePresets(new Date());
      const preset = presets.find((candidate) => candidate.id === "tomorrow") ?? presets.at(-1)!;
      return snoozeThread(ref, preset.snoozedUntil);
    },
    [snoozeThread],
  );

  const runStep = useCallback(
    (ref: ScopedThreadRef, step: MoveStep) => {
      switch (step) {
        case "unarchive":
          return report("Failed to unarchive thread", () => unarchiveThread(ref));
        case "unsnooze":
          return report("Failed to wake thread", () => unsnoozeThread(ref));
        case "unsettle":
          return report("Failed to un-settle thread", () => unsettleThread(ref));
        case "unpin":
          return report("Failed to unpin thread", () => confirmAndUnpinThread(ref));
        case "pin":
          return report("Failed to pin thread", () => pinThread(ref));
        case "snooze":
          return report("Failed to snooze thread", () => snoozeUntilTomorrow(ref));
        case "settle":
          return report("Failed to settle thread", () => settleThread(ref));
        case "archive":
          return report("Failed to archive thread", () => archiveThread(ref));
      }
    },
    [
      archiveThread,
      confirmAndUnpinThread,
      pinThread,
      settleThread,
      snoozeUntilTomorrow,
      unarchiveThread,
      unsettleThread,
      unsnoozeThread,
    ],
  );

  const moveToSection = useCallback(
    async (row: ViewRow, target: ViewSection) => {
      if (row.section === target) return;
      const { shell, ref } = row;
      const now = new Date().toISOString();
      // Refuse up front, so a refused move never half-applies.
      if (target === "archived" && !threadRuntimeCanArchive(shell.runtime)) {
        errorToast("Can't archive this thread", "Stop the running turn first.");
        return;
      }
      if (
        target === "snoozed" &&
        (!readEnvironmentSupportsSnooze(ref.environmentId) || !canSnooze(shell, { now }))
      ) {
        errorToast("Can't snooze this thread", "It is running or its server can't snooze.");
        return;
      }
      const steps = planSectionMove(
        {
          archived: row.section === "archived",
          snoozed: effectiveSnoozed(shell, { now }),
          settled: shell.settledOverride === "settled",
          pinned: row.pinned,
        },
        target,
      );
      for (const step of steps) {
        if (!(await runStep(ref, step))) return;
      }
    },
    [runStep],
  );

  const runBulk = useCallback(
    async (rows: readonly ViewRow[], action: ViewBulkAction) => {
      if (rows.length === 0) return;
      if (action === "delete") {
        const api = readLocalApi();
        const confirmed = await settlePromise(
          () =>
            api?.dialogs.confirm(
              [
                `Delete ${rows.length} thread${rows.length === 1 ? "" : "s"}?`,
                "This permanently clears their conversation history.",
              ].join("\n"),
              { variant: "destructive" },
            ) ?? Promise.resolve(false),
        );
        if (confirmed._tag === "Failure" || !confirmed.value) return;
        // Like the sidebar: later deletes know which threads went first, so a
        // worktree the batch leaves orphaned still gets its cleanup prompt.
        const { firstFailure } = await deleteSelectedThreadEntries({
          entries: rows.map((row) => ({ threadKey: row.key, ref: row.ref })),
          delete: (entry, deletedThreadKeys) => deleteThread(entry.ref, { deletedThreadKeys }),
        });
        if (firstFailure !== null) {
          const error = squashAtomCommandFailure(firstFailure);
          errorToast(
            "Failed to delete threads",
            error instanceof Error ? error.message : "An error occurred.",
          );
        }
        return;
      }
      for (const row of rows) {
        const { ref } = row;
        switch (action) {
          case "pin":
            await runStep(ref, "pin");
            break;
          case "unpin":
            await runStep(ref, "unpin");
            break;
          case "settle":
            await runStep(ref, "settle");
            break;
          case "unsettle":
            await runStep(ref, "unsettle");
            break;
          case "snooze":
            await runStep(ref, "snooze");
            break;
          case "unsnooze":
            await runStep(ref, "unsnooze");
            break;
          case "mark-unread":
            markThreadUnread(ref);
            break;
          case "archive":
            await runStep(ref, "archive");
            break;
          case "unarchive":
            await runStep(ref, "unarchive");
            break;
        }
      }
    },
    [deleteThread, markThreadUnread, runStep],
  );

  const rename = useCallback(
    async (ref: ScopedThreadRef, title: string) => {
      const trimmed = title.trim();
      if (trimmed === "") return;
      await report("Failed to rename thread", () =>
        updateMetadata({
          environmentId: ref.environmentId,
          input: { threadId: ref.threadId, title: trimmed },
        }),
      );
    },
    [updateMetadata],
  );

  return useMemo(() => ({ moveToSection, runBulk, rename }), [moveToSection, rename, runBulk]);
}
