import { describe, expect, it } from "vitest";

import type { Thread } from "../types";
import {
  deriveThreadStatusPill,
  filterSidebarThreads,
  getThreadLatestActivityAt,
  hasUnseenCompletion,
  resolveThreadStatusPill,
  sortSidebarThreads,
  threadMatchesSidebarSearch,
} from "./Sidebar.logic";

const baseThread = {
  interactionMode: "default" as const,
  session: null,
  latestTurn: null,
  lastVisitedAt: undefined,
  proposedPlans: [],
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
    contextWindow: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): NonNullable<Thread["latestTurn"]> {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
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

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        ...baseThread,
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("resolveThreadStatusPill", () => {
  const planThread = {
    ...baseThread,
    interactionMode: "plan" as const,
    session: {
      provider: "codex" as const,
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: planThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: planThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...planThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
            },
          ],
          session: {
            ...planThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });
});

describe("deriveThreadStatusPill", () => {
  it("shows optimistic worktree setup before the session connects", () => {
    expect(
      deriveThreadStatusPill({
        thread: makeThread(),
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        pendingRunPhase: "preparing-worktree",
      }),
    ).toMatchObject({ label: "Preparing", pulse: true });
  });

  it("uses running status when there are no blockers", () => {
    expect(
      deriveThreadStatusPill({
        thread: makeThread({
          session: {
            provider: "codex",
            status: "running",
            orchestrationStatus: "running",
            createdAt: "2026-03-07T10:00:00.000Z",
            updatedAt: "2026-03-07T10:00:00.000Z",
          },
        }),
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        pendingRunPhase: null,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
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

  it("sorts by visible status priority before activity", () => {
    const pendingApproval = makeThread({
      id: "thread-pending" as Thread["id"],
      title: "Pending approval",
    });
    const planReady = makeThread({
      id: "thread-plan" as Thread["id"],
      title: "Plan ready",
      interactionMode: "plan",
      latestTurn: makeLatestTurn(),
      proposedPlans: [
        {
          id: "plan-1" as never,
          turnId: "turn-1" as never,
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
          planMarkdown: "# Plan",
        },
      ],
      session: {
        provider: "codex",
        status: "ready",
        orchestrationStatus: "ready",
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:05:00.000Z",
      },
    });

    expect(
      sortSidebarThreads([planReady, pendingApproval], {
        sortBy: "status",
        ...threadSortMaps({
          pendingApprovals: [pendingApproval.id],
        }),
      }).map((thread) => thread.id),
    ).toEqual([pendingApproval.id, planReady.id]);
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
