import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useThreadActions } from "~/hooks/useThreadActions";
import { readLocalApi } from "~/localApi";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import type { ViewRow, ViewSection } from "./viewEngine";

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

async function report(title: string, run: () => Promise<AtomCommandResult<unknown, unknown>>) {
  const result = await run();
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: String(squashAtomCommandFailure(result) ?? "An error occurred."),
      }),
    );
    return false;
  }
  return true;
}

/**
 * The thread mutations a view performs, through the same commands as the
 * sidebar. A board drop moves a thread between sections by undoing the state
 * it leaves and applying the one it enters.
 */
export function useViewThreadOps() {
  const {
    pinThread,
    unpinThread,
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

  const leave = useCallback(
    async (row: ViewRow, target: ViewSection) => {
      const { ref, section } = row;
      if (section === "archived" && target !== "archived") {
        if (!(await report("Failed to unarchive thread", () => unarchiveThread(ref)))) return false;
      }
      if (section === "snoozed" && target !== "snoozed") {
        if (!(await report("Failed to wake thread", () => unsnoozeThread(ref)))) return false;
      }
      if (section === "settled" && target !== "settled" && target !== "archived") {
        if (!(await report("Failed to un-settle thread", () => unsettleThread(ref)))) return false;
      }
      if (row.pinned && target === "active") {
        if (!(await report("Failed to unpin thread", () => unpinThread(ref)))) return false;
      }
      return true;
    },
    [unarchiveThread, unpinThread, unsettleThread, unsnoozeThread],
  );

  const moveToSection = useCallback(
    async (row: ViewRow, target: ViewSection) => {
      if (row.section === target) return;
      if (!(await leave(row, target))) return;
      const { ref } = row;
      switch (target) {
        case "pinned":
          if (!row.pinned) await report("Failed to pin thread", () => pinThread(ref));
          return;
        case "snoozed":
          await report("Failed to snooze thread", () => snoozeUntilTomorrow(ref));
          return;
        case "settled":
          await report("Failed to settle thread", () => settleThread(ref));
          return;
        case "archived":
          await report("Failed to archive thread", () => archiveThread(ref));
          return;
        case "active":
          return;
      }
    },
    [archiveThread, leave, pinThread, settleThread, snoozeUntilTomorrow],
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
      }
      for (const row of rows) {
        const { ref } = row;
        switch (action) {
          case "pin":
            await report("Failed to pin thread", () => pinThread(ref));
            break;
          case "unpin":
            await report("Failed to unpin thread", () => unpinThread(ref));
            break;
          case "settle":
            await report("Failed to settle thread", () => settleThread(ref));
            break;
          case "unsettle":
            await report("Failed to un-settle thread", () => unsettleThread(ref));
            break;
          case "snooze":
            await report("Failed to snooze thread", () => snoozeUntilTomorrow(ref));
            break;
          case "unsnooze":
            await report("Failed to wake thread", () => unsnoozeThread(ref));
            break;
          case "mark-unread":
            markThreadUnread(ref);
            break;
          case "archive":
            await report("Failed to archive thread", () => archiveThread(ref));
            break;
          case "unarchive":
            await report("Failed to unarchive thread", () => unarchiveThread(ref));
            break;
          case "delete":
            await report("Failed to delete thread", () => deleteThread(ref));
            break;
        }
      }
    },
    [
      archiveThread,
      deleteThread,
      markThreadUnread,
      pinThread,
      settleThread,
      snoozeUntilTomorrow,
      unarchiveThread,
      unpinThread,
      unsettleThread,
      unsnoozeThread,
    ],
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
