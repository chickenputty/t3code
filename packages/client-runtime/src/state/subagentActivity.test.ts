import { type OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { resolveThreadsWithWorkingSubagents } from "./subagentActivity.ts";

const ROOT = ThreadId.make("root");

function thread(
  id: string,
  parent: string | null,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell {
  return {
    ...v2ThreadShell,
    id: ThreadId.make(id),
    creationSource: "mcp",
    lineage: {
      rootThreadId: ROOT,
      parentThreadId: parent === null ? null : ThreadId.make(parent),
      relationshipToParent: parent === null ? null : "subagent",
    },
    status: "idle",
    activityRunStatus: null,
    ...overrides,
  };
}

describe("resolveThreadsWithWorkingSubagents", () => {
  it("marks every ancestor of a working nested subagent", () => {
    const result = resolveThreadsWithWorkingSubagents([
      thread("root", null),
      thread("child", "root"),
      thread("grandchild", "child", { status: "running", activityRunStatus: "running" }),
    ]);
    expect([...result].sort()).toEqual(["child", "root"]);
  });

  it("ignores finished, archived and provider-native subagents", () => {
    const result = resolveThreadsWithWorkingSubagents([
      thread("root", null),
      thread("done", "root", { status: "completed" }),
      thread("archived", "root", {
        status: "running",
        activityRunStatus: "running",
        archivedAt: v2ThreadShell.createdAt,
      }),
      thread("native", "root", {
        creationSource: "provider",
        status: "running",
        activityRunStatus: "running",
      }),
    ]);
    expect(result.size).toBe(0);
  });

  it("counts a subagent parked on its own background work", () => {
    const result = resolveThreadsWithWorkingSubagents([
      thread("root", null),
      thread("child", "root", {
        pendingBackgroundTasks: [{ kind: "subagent", taskId: "t1", description: "nested agent" }],
      }),
    ]);
    expect([...result]).toEqual(["root"]);
  });

  it("does not climb past a fork", () => {
    const result = resolveThreadsWithWorkingSubagents([
      thread("source", null),
      thread("fork", null, {
        lineage: {
          rootThreadId: ROOT,
          parentThreadId: ThreadId.make("source"),
          relationshipToParent: "fork",
        },
      }),
      thread("child", "fork", { status: "running", activityRunStatus: "running" }),
    ]);
    expect([...result]).toEqual(["fork"]);
  });
});
