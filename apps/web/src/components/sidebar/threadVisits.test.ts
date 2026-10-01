import { describe, expect, it } from "vite-plus/test";

import { findThreadStep, recordThreadOpen, type ThreadVisits } from "./threadVisits";

const empty: ThreadVisits = { openedAt: {}, trail: [], index: -1, pending: null };
const all = () => true;

function open(visits: ThreadVisits, ...keys: string[]): ThreadVisits {
  return keys.reduce((state, key, i) => recordThreadOpen(state, key, 1000 + i), visits);
}

describe("thread visit history", () => {
  it("records opens in order and when each thread was last opened", () => {
    const visits = open(empty, "a", "b", "c", "b");
    expect(visits.trail).toEqual(["a", "b", "c", "b"]);
    expect(visits.index).toBe(3);
    expect(visits.openedAt).toEqual({ a: 1000, b: 1003, c: 1002 });
  });

  it("does not add the thread the user is already on", () => {
    expect(open(empty, "a", "a", "b", "b").trail).toEqual(["a", "b"]);
  });

  it("steps back and forward without adding visits, and a new open drops the forward history", () => {
    let visits = open(empty, "a", "b", "c");
    const back = findThreadStep(visits, -1, "c", all);
    expect(back).toEqual({ threadKey: "b", index: 1 });
    visits = { ...visits, index: back!.index, pending: back!.threadKey };
    visits = recordThreadOpen(visits, "b", 2000);
    expect(visits.trail).toEqual(["a", "b", "c"]);
    expect(visits.index).toBe(1);
    expect(findThreadStep(visits, 1, "b", all)).toEqual({ threadKey: "c", index: 2 });

    visits = recordThreadOpen(visits, "d", 3000);
    expect(visits.trail).toEqual(["a", "b", "d"]);
    expect(findThreadStep(visits, 1, "d", all)).toBeNull();
  });

  it("skips threads that no longer exist", () => {
    const visits = open(empty, "a", "gone", "c");
    expect(findThreadStep(visits, -1, "c", (key) => key !== "gone")).toEqual({
      threadKey: "a",
      index: 0,
    });
  });

  it("goes back to the thread the user left when they are off the trail", () => {
    const visits = open(empty, "a", "b");
    // On a draft or settings there is no route thread.
    expect(findThreadStep(visits, -1, null, all)).toEqual({ threadKey: "b", index: 1 });
    expect(findThreadStep(visits, 1, null, all)).toBeNull();
  });

  it("has nowhere to go at either end", () => {
    const visits = open(empty, "a");
    expect(findThreadStep(visits, -1, "a", all)).toBeNull();
    expect(findThreadStep(visits, 1, "a", all)).toBeNull();
  });
});
