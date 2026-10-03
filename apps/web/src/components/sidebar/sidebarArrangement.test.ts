import { describe, expect, it } from "vite-plus/test";

import {
  arrangeSidebarActiveThreads,
  MANUAL_SIDEBAR_THREAD_SORT,
  resolveSidebarThreadDisplayStatus,
  sortSidebarThreads,
  type SidebarThreadDisplayStatus,
} from "./sidebarArrangement";

type Fixture = Parameters<typeof resolveSidebarThreadDisplayStatus>[0] & {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly latestUserMessageAt: string | null;
};

const at = (minute: number) => new Date(Date.UTC(2026, 8, 29, 12, minute)).toISOString();

function thread(id: string, overrides: Record<string, unknown> = {}): Fixture {
  return {
    id,
    title: id,
    projectId: "project",
    createdAt: at(0),
    latestUserMessageAt: null,
    latestRun: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    runtime: null,
    backgroundLiveness: null,
    settledOverride: null,
    ...overrides,
  } as unknown as Fixture;
}

const turn = (minute: number) => ({
  requestedAt: at(minute),
  startedAt: at(minute),
  completedAt: at(minute + 1),
});

const ids = (threads: readonly { id: string }[]) => threads.map((entry) => entry.id);
const noStatus = (): SidebarThreadDisplayStatus => "idle";

describe("sortSidebarThreads", () => {
  it("leaves the manual order untouched", () => {
    const threads = [thread("b"), thread("a")];
    expect(sortSidebarThreads(threads, MANUAL_SIDEBAR_THREAD_SORT, noStatus)).toBe(threads);
  });

  it("orders by the latest message or turn, newest first, and reverses", () => {
    const threads = [
      thread("old-message", { latestUserMessageAt: at(5) }),
      thread("recent-turn", { latestUserMessageAt: at(1), latestRun: turn(20) }),
      thread("never-run", { createdAt: at(10) }),
    ];
    const newest = sortSidebarThreads(threads, { field: "activity", reversed: false }, noStatus);
    expect(ids(newest)).toEqual(["recent-turn", "never-run", "old-message"]);
    const oldest = sortSidebarThreads(threads, { field: "activity", reversed: true }, noStatus);
    expect(ids(oldest)).toEqual(["old-message", "never-run", "recent-turn"]);
  });

  it("puts what needs you first and breaks ties by latest activity", () => {
    const status: Record<string, SidebarThreadDisplayStatus> = {
      idle: "idle",
      working: "working",
      "done-old": "done",
      "done-new": "done",
      approval: "approval",
    };
    const threads = [
      thread("idle"),
      thread("working"),
      thread("done-old", { latestRun: turn(1) }),
      thread("done-new", { latestRun: turn(30) }),
      thread("approval"),
    ];
    const sorted = sortSidebarThreads(
      threads,
      { field: "status", reversed: false },
      (entry) => status[entry.id]!,
    );
    expect(ids(sorted)).toEqual(["approval", "done-new", "done-old", "working", "idle"]);
  });

  it("orders by when each thread was last opened, never-opened threads last", () => {
    const openedAt: Record<string, number> = { early: 100, late: 900 };
    const threads = [thread("never"), thread("early"), thread("late")];
    const newest = sortSidebarThreads(
      threads,
      { field: "opened", reversed: false },
      noStatus,
      (entry) => openedAt[entry.id],
    );
    expect(ids(newest)).toEqual(["late", "early", "never"]);
    const oldest = sortSidebarThreads(
      threads,
      { field: "opened", reversed: true },
      noStatus,
      (entry) => openedAt[entry.id],
    );
    expect(ids(oldest)).toEqual(["never", "early", "late"]);
  });

  it("sorts names with numbers in reading order", () => {
    const threads = [thread("Thread 10"), thread("thread 2"), thread("Alpha")];
    const byName = sortSidebarThreads(threads, { field: "name", reversed: false }, noStatus);
    expect(ids(byName)).toEqual(["Alpha", "thread 2", "Thread 10"]);
    const reversed = sortSidebarThreads(threads, { field: "name", reversed: true }, noStatus);
    expect(ids(reversed)).toEqual(["Thread 10", "thread 2", "Alpha"]);
  });
});

describe("arrangeSidebarActiveThreads", () => {
  const groupOf = (entry: Fixture) =>
    entry.projectId === "missing"
      ? null
      : { key: entry.projectId, label: entry.projectId === "vault" ? "Pet Vault" : "flux" };

  it("orders groups by their first thread, keeps the sort inside each, and hides collapsed rows", () => {
    const threads = [
      thread("vault-old", { projectId: "vault", latestRun: turn(1) }),
      thread("unknown", { projectId: "missing" }),
      thread("flux-a", { projectId: "flux", latestRun: turn(5) }),
      thread("vault-new", { projectId: "vault", latestRun: turn(40) }),
    ];
    const arranged = arrangeSidebarActiveThreads(threads, {
      sort: { field: "activity", reversed: false },
      groupByProject: true,
      statusOf: noStatus,
      groupOf,
      collapsedGroupKeys: new Set(["flux"]),
    });
    expect(
      arranged.groups?.map((group) => [group.label, ids(group.threads), group.collapsed]),
    ).toEqual([
      ["Pet Vault", ["vault-new", "vault-old"], false],
      ["flux", ["flux-a"], true],
      ["Other", ["unknown"], false],
    ]);
    expect(ids(arranged.threads)).toEqual(["vault-new", "vault-old", "unknown"]);
  });

  it("keeps pins in their project, above the sorted rows, in pin order", () => {
    const threads = [
      thread("flux-a", { projectId: "flux", latestRun: turn(30) }),
      thread("vault-a", { projectId: "vault", latestRun: turn(20) }),
      thread("flux-b", { projectId: "flux", latestRun: turn(10) }),
    ];
    const pinned = [
      thread("flux-pin-low", { projectId: "flux", latestRun: turn(1) }),
      thread("flux-pin-high", { projectId: "flux", latestRun: turn(2) }),
    ];
    const arranged = arrangeSidebarActiveThreads(threads, {
      sort: { field: "activity", reversed: false },
      groupByProject: true,
      statusOf: noStatus,
      groupOf,
      collapsedGroupKeys: new Set(),
      pinnedThreads: pinned,
    });
    expect(arranged.groups?.map((group) => [group.label, ids(group.threads)])).toEqual([
      ["flux", ["flux-pin-low", "flux-pin-high", "flux-a", "flux-b"]],
      ["Pet Vault", ["vault-a"]],
    ]);
    expect(ids(arranged.threads)).toEqual([
      "flux-pin-low",
      "flux-pin-high",
      "flux-a",
      "flux-b",
      "vault-a",
    ]);
  });

  it("gives a project whose only threads are pinned its own group, where the pin sorts", () => {
    const threads = [thread("flux-a", { projectId: "flux", latestRun: turn(10) })];
    const pinned = [thread("vault-pin", { projectId: "vault", latestRun: turn(40) })];
    const arranged = arrangeSidebarActiveThreads(threads, {
      sort: { field: "activity", reversed: false },
      groupByProject: true,
      statusOf: noStatus,
      groupOf,
      collapsedGroupKeys: new Set(),
      pinnedThreads: pinned,
    });
    expect(arranged.groups?.map((group) => [group.label, ids(group.threads)])).toEqual([
      ["Pet Vault", ["vault-pin"]],
      ["flux", ["flux-a"]],
    ]);
  });

  it("puts a pinned thread's project first under the manual order", () => {
    const threads = [
      thread("flux-a", { projectId: "flux" }),
      thread("vault-a", { projectId: "vault" }),
    ];
    const pinned = [thread("vault-pin", { projectId: "vault" })];
    const arranged = arrangeSidebarActiveThreads(threads, {
      sort: MANUAL_SIDEBAR_THREAD_SORT,
      groupByProject: true,
      statusOf: noStatus,
      groupOf,
      collapsedGroupKeys: new Set(),
      pinnedThreads: pinned,
    });
    expect(arranged.groups?.map((group) => [group.label, ids(group.threads)])).toEqual([
      ["Pet Vault", ["vault-pin", "vault-a"]],
      ["flux", ["flux-a"]],
    ]);
  });

  it("hides a collapsed project's pins with its rows", () => {
    const threads = [
      thread("flux-a", { projectId: "flux" }),
      thread("vault-a", { projectId: "vault" }),
    ];
    const pinned = [thread("flux-pin", { projectId: "flux" })];
    const arranged = arrangeSidebarActiveThreads(threads, {
      sort: MANUAL_SIDEBAR_THREAD_SORT,
      groupByProject: true,
      statusOf: noStatus,
      groupOf,
      collapsedGroupKeys: new Set(["flux"]),
      pinnedThreads: pinned,
    });
    expect(ids(arranged.threads)).toEqual(["vault-a"]);
    expect(arranged.groups?.find((group) => group.key === "flux")?.threads).toHaveLength(2);
  });

  it("passes an ungrouped manual list straight through", () => {
    const threads = [thread("b"), thread("a")];
    const arranged = arrangeSidebarActiveThreads(threads, {
      sort: MANUAL_SIDEBAR_THREAD_SORT,
      groupByProject: false,
      statusOf: noStatus,
      groupOf,
      collapsedGroupKeys: new Set(),
    });
    expect(arranged).toEqual({ threads, groups: null });
    expect(arranged.threads).toBe(threads);
  });
});

describe("resolveSidebarThreadDisplayStatus", () => {
  const completed = { latestRun: turn(10) };

  it("shows a completion as done only when it came after the last visit", () => {
    expect(
      resolveSidebarThreadDisplayStatus(thread("t", completed), {
        lastVisitedAt: at(5),
        wokeAt: null,
      }),
    ).toBe("done");
    expect(
      resolveSidebarThreadDisplayStatus(thread("t", completed), {
        lastVisitedAt: at(30),
        wokeAt: null,
      }),
    ).toBe("idle");
    // Never visited counts as read, like the rows themselves.
    expect(
      resolveSidebarThreadDisplayStatus(thread("t", completed), {
        lastVisitedAt: undefined,
        wokeAt: null,
      }),
    ).toBe("idle");
  });

  it("lets live work and an unacknowledged wake outrank a completion", () => {
    expect(
      resolveSidebarThreadDisplayStatus(
        thread("t", { ...completed, runtime: { status: "running" } }),
        { lastVisitedAt: at(5), wokeAt: null },
      ),
    ).toBe("working");
    expect(
      resolveSidebarThreadDisplayStatus(thread("t", completed), {
        lastVisitedAt: at(5),
        wokeAt: at(20),
      }),
    ).toBe("woke");
    expect(
      resolveSidebarThreadDisplayStatus(thread("t", { hasPendingApprovals: true }), {
        lastVisitedAt: undefined,
        wokeAt: at(20),
      }),
    ).toBe("approval");
  });
});
