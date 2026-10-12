import { isProviderNativeSubagentThread } from "@t3tools/contracts";
import type { OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

function isWorkingSubagent(thread: OrchestrationV2ThreadShell): boolean {
  if (thread.lineage.relationshipToParent !== "subagent") return false;
  if (thread.archivedAt !== null || thread.deletedAt !== null) return false;
  // Provider-native subagents report through their parent's own run and its
  // background roster (the Waiting pill), so only T3-owned children count here.
  if (isProviderNativeSubagentThread(thread)) return false;
  if (backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])) return true;
  return ACTIVE_STATUSES.has(thread.activityRunStatus ?? thread.status);
}

/**
 * Threads with a T3 subagent working somewhere below them. A delegated child
 * runs on its own while its parent's turn has ended, so without this the
 * parent reads as idle or done while work is still happening under it. Walks
 * subagent links only: a fork is its own thread, not work on behalf of its source.
 */
export function resolveThreadsWithWorkingSubagents(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
): ReadonlySet<ThreadId> {
  const byId = new Map<ThreadId, OrchestrationV2ThreadShell>();
  for (const thread of threads) byId.set(thread.id, thread);
  const result = new Set<ThreadId>();
  for (const thread of threads) {
    if (!isWorkingSubagent(thread)) continue;
    let current: OrchestrationV2ThreadShell | undefined = thread;
    while (current?.lineage.relationshipToParent === "subagent") {
      const parentId: ThreadId | null = current.lineage.parentThreadId;
      if (parentId === null || result.has(parentId)) break;
      result.add(parentId);
      current = byId.get(parentId);
    }
  }
  return result;
}
