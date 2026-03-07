import { describe, expect, it } from "vitest";

import { deriveThreadStatusPill } from "./Sidebar.logic";

const baseThread = {
  session: null,
  latestTurn: null,
  lastVisitedAt: undefined,
} as const;

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
