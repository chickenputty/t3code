import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_SIDEBAR_PROJECT_SORT,
  MANUAL_SIDEBAR_THREAD_SORT,
} from "../sidebar/sidebarArrangement";
import { duplicateSavedView, removeSavedView, updateSavedView } from "./savedViewList";
import { newSavedView } from "./viewEngine";

const LOCAL = {
  groupByProject: true,
  pinsStayGrouped: false,
  sort: MANUAL_SIDEBAR_THREAD_SORT,
  projectSort: DEFAULT_SIDEBAR_PROJECT_SORT,
};

const board = newSavedView("board", "b", "Board");

describe("saved view list edits", () => {
  it("stores the built-in Threads view on its first edit, at the front", () => {
    const next = updateSavedView(
      [board],
      "threads",
      { filter: { conjunction: "or", conditions: [] } },
      LOCAL,
    );
    expect(next.map((view) => view.id)).toEqual(["threads", "b"]);
    expect(next[0]).toMatchObject({ layout: "threads", groupBy: "project" });
    expect(next[0]!.filter.conjunction).toBe("or");
  });
  it("edits a stored Threads view in place", () => {
    const stored = updateSavedView([board], "threads", { groupBy: null }, LOCAL);
    const next = updateSavedView(stored, "threads", { groupBy: "project" }, LOCAL);
    expect(next.map((view) => view.id)).toEqual(["threads", "b"]);
    expect(next[0]!.groupBy).toBe("project");
  });
  it("never removes the built-in Threads view", () => {
    const stored = updateSavedView([board], "threads", {}, LOCAL);
    expect(removeSavedView(stored, "threads")).toBe(stored);
    expect(removeSavedView(stored, "b").map((view) => view.id)).toEqual(["threads"]);
  });
  it("duplicates an unstored Threads view to the front of the stored list", () => {
    const result = duplicateSavedView([board], "threads", "copy", LOCAL);
    expect(result?.copy).toMatchObject({ id: "copy", name: "Threads copy", layout: "threads" });
    expect(result?.list.map((view) => view.id)).toEqual(["copy", "b"]);
  });
  it("puts a copy right after its source", () => {
    const list = [board, newSavedView("list", "l")];
    expect(duplicateSavedView(list, "b", "c", LOCAL)?.list.map((view) => view.id)).toEqual([
      "b",
      "c",
      "l",
    ]);
    expect(duplicateSavedView(list, "missing", "c", LOCAL)).toBeNull();
  });
});
