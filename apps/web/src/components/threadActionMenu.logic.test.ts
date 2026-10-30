import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadActionMenuItems,
  type ThreadActionMenuState,
  withoutThreadActionMenuItem,
} from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  splitView: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((item) => item.id);
}

describe("buildThreadActionMenuItems", () => {
  it("offers the split view item that matches the thread's place in the split", () => {
    expect(ids(baseState)).not.toContain("open-split");
    expect(ids(baseState)).not.toContain("close-split");
    expect(ids({ ...baseState, splitView: "open" })[0]).toBe("open-split");
    expect(ids({ ...baseState, splitView: "close" })[0]).toBe("close-split");
  });

  it("keeps the split view item available to read-only clients", () => {
    const item = buildThreadActionMenuItems({
      ...baseState,
      canOperate: false,
      splitView: "open",
    }).find((candidate) => candidate.id === "open-split");
    expect(item?.disabled).not.toBe(true);
  });

  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });
});

describe("withoutThreadActionMenuItem", () => {
  it("drops rename and keeps its separator on the next item", () => {
    const items = buildThreadActionMenuItems(baseState);
    const renameIndex = items.findIndex((item) => item.id === "rename");
    const next = withoutThreadActionMenuItem(items, "rename");
    expect(next.some((item) => item.id === "rename")).toBe(false);
    expect(next).toHaveLength(items.length - 1);
    expect(next[renameIndex]).toEqual({ ...items[renameIndex + 1], separatorBefore: true });
  });
  it("returns the menu unchanged when the item is absent", () => {
    const items = buildThreadActionMenuItems(baseState);
    expect(withoutThreadActionMenuItem(items, "open-split")).toBe(items);
  });
});
