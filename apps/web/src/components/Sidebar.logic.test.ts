import { describe, expect, it } from "vitest";

import type { Thread } from "../types";
import {
  deriveThreadStatusPill,
  filterSidebarThreads,
  getThreadLatestActivityAt,
  sortSidebarThreads,
  threadMatchesSidebarSearch,
} from "./Sidebar.logic";

const baseThread = {
  session: null,
  latestTurn: null,
  lastVisitedAt: undefined,
} as const;

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1" as Thread["id"],
    codexThreadId: null,
    projectId: "project-1" as Thread["projectId"],
    title: "Thread",
    model: "gpt-5.4",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-07T10:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: undefined,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function threadSortMaps(input: {
  pendingApprovals?: readonly Thread["id"][];
  pendingUserInput?: readonly Thread["id"][];
} = {}) {
  const pendingApprovals = new Map<Thread["id"], boolean>(
    (input.pendingApprovals ?? []).map((threadId) => [threadId, true] as const),
  );
  const pendingUserInput = new Map<Thread["id"], boolean>(
    (input.pendingUserInput ?? []).map((threadId) => [threadId, true] as const),
  );
  return {
    hasPendingApprovalsByThreadId: pendingApprovals,
    hasPendingUserInputByThreadId: pendingUserInput,
  };
}

describe("deriveThreadStatusPill", () => {
  it("marks pending user input threads as paused in yellow", () => {
    expect(
      deriveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toEqual({
      label: "Paused",
      colorClass: "text-yellow-700 dark:text-yellow-300/90",
      dotClass: "bg-yellow-500 dark:bg-yellow-300/90",
      pulse: false,
    });
  });

  it("keeps pending approval higher priority than paused", () => {
    expect(
      deriveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({
      label: "Pending Approval",
    });
  });

  it("returns working for running threads without attention blockers", () => {
    expect(
      deriveThreadStatusPill({
        thread: {
          ...baseThread,
          session: {
            status: "running",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({
      label: "Working",
      pulse: true,
    });
  });

  it("returns completed for unseen finished turns", () => {
    expect(
      deriveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: {
            completedAt: "2026-03-07T12:00:00.000Z",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({
      label: "Completed",
      pulse: false,
    });
  });
});

describe("getThreadLatestActivityAt", () => {
  it("prefers the newest observed thread activity over creation time", () => {
    expect(
      getThreadLatestActivityAt(
        makeThread({
          session: {
            provider: "codex",
            status: "ready",
            orchestrationStatus: "ready",
            createdAt: "2026-03-07T10:00:00.000Z",
            updatedAt: "2026-03-07T10:05:00.000Z",
          },
          latestTurn: {
            turnId: "turn-1" as NonNullable<Thread["latestTurn"]>["turnId"],
            state: "completed",
            requestedAt: "2026-03-07T10:06:00.000Z",
            startedAt: "2026-03-07T10:07:00.000Z",
            completedAt: "2026-03-07T10:08:00.000Z",
            assistantMessageId: null,
          },
          messages: [
            {
              id: "message-1" as Thread["messages"][number]["id"],
              role: "assistant",
              text: "done",
              createdAt: "2026-03-07T10:09:00.000Z",
              completedAt: "2026-03-07T10:10:00.000Z",
              streaming: false,
            },
          ],
        }),
      ),
    ).toBe("2026-03-07T10:10:00.000Z");
  });
});

describe("sortSidebarThreads", () => {
  it("sorts by latest activity descending", () => {
    const older = makeThread({
      id: "thread-older" as Thread["id"],
      title: "Older",
      createdAt: "2026-03-07T09:00:00.000Z",
    });
    const recentlyActive = makeThread({
      id: "thread-active" as Thread["id"],
      title: "Active",
      createdAt: "2026-03-07T08:00:00.000Z",
      session: {
        provider: "codex",
        status: "running",
        orchestrationStatus: "running",
        createdAt: "2026-03-07T08:00:00.000Z",
        updatedAt: "2026-03-07T11:00:00.000Z",
      },
    });

    expect(
      sortSidebarThreads([older, recentlyActive], {
        sortBy: "activity",
        ...threadSortMaps(),
      }).map((thread) => thread.id),
    ).toEqual([recentlyActive.id, older.id]);
  });

  it("sorts by creation descending", () => {
    const newer = makeThread({
      id: "thread-newer" as Thread["id"],
      title: "Newer",
      createdAt: "2026-03-07T11:00:00.000Z",
    });
    const older = makeThread({
      id: "thread-older" as Thread["id"],
      title: "Older",
      createdAt: "2026-03-07T09:00:00.000Z",
    });

    expect(
      sortSidebarThreads([older, newer], {
        sortBy: "created",
        ...threadSortMaps(),
      }).map((thread) => thread.id),
    ).toEqual([newer.id, older.id]);
  });

  it("sorts by visible status priority before activity", () => {
    const pendingApproval = makeThread({
      id: "thread-pending" as Thread["id"],
      title: "Pending approval",
    });
    const working = makeThread({
      id: "thread-working" as Thread["id"],
      title: "Working",
      session: {
        provider: "codex",
        status: "running",
        orchestrationStatus: "running",
        createdAt: "2026-03-07T10:00:00.000Z",
        updatedAt: "2026-03-07T10:30:00.000Z",
      },
    });
    const completed = makeThread({
      id: "thread-completed" as Thread["id"],
      title: "Completed",
      latestTurn: {
        turnId: "turn-1" as NonNullable<Thread["latestTurn"]>["turnId"],
        state: "completed",
        requestedAt: "2026-03-07T10:05:00.000Z",
        startedAt: "2026-03-07T10:06:00.000Z",
        completedAt: "2026-03-07T10:07:00.000Z",
        assistantMessageId: null,
      },
    });

    expect(
      sortSidebarThreads([completed, working, pendingApproval], {
        sortBy: "status",
        ...threadSortMaps({
          pendingApprovals: [pendingApproval.id],
        }),
      }).map((thread) => thread.id),
    ).toEqual([pendingApproval.id, working.id, completed.id]);
  });

  it("sorts by name alphabetically", () => {
    const bravo = makeThread({
      id: "thread-bravo" as Thread["id"],
      title: "Bravo 2",
    });
    const alpha = makeThread({
      id: "thread-alpha" as Thread["id"],
      title: "alpha 10",
    });

    expect(
      sortSidebarThreads([bravo, alpha], {
        sortBy: "name",
        ...threadSortMaps(),
      }).map((thread) => thread.id),
    ).toEqual([alpha.id, bravo.id]);
  });
});

describe("threadMatchesSidebarSearch", () => {
  it("matches thread titles case-insensitively", () => {
    expect(
      threadMatchesSidebarSearch(
        makeThread({
          title: "Fix Sidebar Search",
        }),
        "sidebar",
      ),
    ).toBe(true);
  });

  it("matches the original user message", () => {
    expect(
      threadMatchesSidebarSearch(
        makeThread({
          messages: [
            {
              id: "message-1" as Thread["messages"][number]["id"],
              role: "assistant",
              text: "intro",
              createdAt: "2026-03-07T10:00:00.000Z",
              streaming: false,
            },
            {
              id: "message-2" as Thread["messages"][number]["id"],
              role: "user",
              text: "Need a billing export page",
              createdAt: "2026-03-07T10:01:00.000Z",
              streaming: false,
            },
            {
              id: "message-3" as Thread["messages"][number]["id"],
              role: "user",
              text: "Also add sorting",
              createdAt: "2026-03-07T10:02:00.000Z",
              streaming: false,
            },
          ],
        }),
        "billing export",
      ),
    ).toBe(true);
  });

  it("matches the latest user message", () => {
    expect(
      threadMatchesSidebarSearch(
        makeThread({
          messages: [
            {
              id: "message-1" as Thread["messages"][number]["id"],
              role: "user",
              text: "First request",
              createdAt: "2026-03-07T10:00:00.000Z",
              streaming: false,
            },
            {
              id: "message-2" as Thread["messages"][number]["id"],
              role: "assistant",
              text: "working on it",
              createdAt: "2026-03-07T10:01:00.000Z",
              streaming: false,
            },
            {
              id: "message-3" as Thread["messages"][number]["id"],
              role: "user",
              text: "Latest note about invoices",
              createdAt: "2026-03-07T10:02:00.000Z",
              streaming: false,
            },
          ],
        }),
        "invoices",
      ),
    ).toBe(true);
  });
});

describe("filterSidebarThreads", () => {
  it("returns all threads when the query is empty", () => {
    const threads = [
      makeThread({ id: "thread-1" as Thread["id"] }),
      makeThread({ id: "thread-2" as Thread["id"] }),
    ];

    expect(filterSidebarThreads(threads, "   ")).toEqual(threads);
  });

  it("filters threads by searchable sidebar context", () => {
    const matchingThread = makeThread({
      id: "thread-match" as Thread["id"],
      messages: [
        {
          id: "message-1" as Thread["messages"][number]["id"],
          role: "user",
          text: "Add a project-wide audit log",
          createdAt: "2026-03-07T10:00:00.000Z",
          streaming: false,
        },
      ],
    });
    const otherThread = makeThread({
      id: "thread-other" as Thread["id"],
      title: "Different work",
    });

    expect(filterSidebarThreads([matchingThread, otherThread], "audit log")).toEqual([
      matchingThread,
    ]);
  });
});
