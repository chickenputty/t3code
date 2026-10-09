import { describe, expect, it } from "vite-plus/test";

import {
  dateBucket,
  filterViewRows,
  groupViewRows,
  newSavedView,
  planGroupDrop,
  sortViewRows,
  stageOfStatus,
  type ViewRow,
} from "./viewEngine";

const NOW = new Date(2026, 9, 9, 15, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function row(key: string, overrides: Partial<ViewRow> = {}): ViewRow {
  return {
    key,
    ref: { environmentId: "env", threadId: key },
    shell: {},
    title: key,
    projectKey: "env:p1",
    projectLabel: "Alpha",
    section: "active",
    status: "idle",
    stage: "done",
    kind: "chat",
    category: null,
    categoryLabel: null,
    model: "opus",
    provider: "claude",
    branch: null,
    worktree: null,
    pullRequest: "none",
    pullRequestNumber: null,
    unread: false,
    pinned: false,
    createdMs: NOW - DAY,
    activityMs: NOW - HOUR,
    messages: 3,
    environment: "Local",
    ...overrides,
  } as unknown as ViewRow;
}

const baseView = newSavedView("list", "v");

describe("filterViewRows", () => {
  it("hides archived unless the view shows it, and settled when it hides it", () => {
    const rows = [row("a"), row("b", { section: "archived" }), row("c", { section: "settled" })];
    expect(filterViewRows(rows, baseView, NOW).map((r) => r.key)).toEqual(["a", "c"]);
    expect(
      filterViewRows(rows, { ...baseView, showArchived: true, showSettled: false }, NOW).map(
        (r) => r.key,
      ),
    ).toEqual(["a", "b"]);
  });

  it("hides sub-agent threads unless the view shows them", () => {
    const rows = [row("a"), row("b", { kind: "subagent" }), row("c", { kind: "fork" })];
    expect(filterViewRows(rows, baseView, NOW).map((r) => r.key)).toEqual(["a", "c"]);
    expect(
      filterViewRows(rows, { ...baseView, showSubagents: true }, NOW).map((r) => r.key),
    ).toEqual(["a", "b", "c"]);
  });

  it("combines conditions with AND or OR", () => {
    const rows = [
      row("a", { model: "opus", status: "failed" }),
      row("b", { model: "gpt", status: "failed" }),
      row("c", { model: "opus", status: "idle" }),
    ];
    const conditions = [
      { property: "model", operator: "any_of", value: ["opus"] },
      { property: "status", operator: "any_of", value: ["failed"] },
    ];
    expect(
      filterViewRows(rows, { ...baseView, filter: { conjunction: "and", conditions } }, NOW).map(
        (r) => r.key,
      ),
    ).toEqual(["a"]);
    expect(
      filterViewRows(rows, { ...baseView, filter: { conjunction: "or", conditions } }, NOW).map(
        (r) => r.key,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("matches text, booleans and day windows", () => {
    const rows = [
      row("fix login", { unread: true, activityMs: NOW - 2 * DAY }),
      row("ship docs", { activityMs: NOW - 10 * DAY }),
    ];
    const filter = (property: string, operator: string, value: string | number | boolean) =>
      filterViewRows(
        rows,
        {
          ...baseView,
          filter: { conjunction: "and", conditions: [{ property, operator, value }] },
        },
        NOW,
      ).map((r) => r.key);
    expect(filter("title", "contains", "LOGIN")).toEqual(["fix login"]);
    expect(filter("title", "not_contains", "login")).toEqual(["ship docs"]);
    expect(filter("unread", "is", true)).toEqual(["fix login"]);
    expect(filter("activity", "within_days", 7)).toEqual(["fix login"]);
    expect(filter("activity", "older_than_days", 7)).toEqual(["ship docs"]);
  });

  it("ignores conditions on properties it does not know", () => {
    const rows = [row("a")];
    const view = {
      ...baseView,
      filter: {
        conjunction: "and" as const,
        conditions: [{ property: "tags", operator: "any_of", value: ["x"] }],
      },
    };
    expect(filterViewRows(rows, view, NOW)).toHaveLength(1);
  });
});

describe("sortViewRows", () => {
  it("sorts on several keys and keeps empty values last in both directions", () => {
    const rows = [
      row("a", { branch: "main", messages: 1 }),
      row("b", { branch: null, messages: 9 }),
      row("c", { branch: "dev", messages: 5 }),
      row("d", { branch: "main", messages: 7 }),
    ];
    const asc = sortViewRows(rows, [
      { property: "branch", direction: "asc" },
      { property: "messages", direction: "desc" },
    ]);
    expect(asc.map((r) => r.key)).toEqual(["c", "d", "a", "b"]);
    const desc = sortViewRows(rows, [{ property: "branch", direction: "desc" }]);
    expect(desc.at(-1)?.key).toBe("b");
  });

  it("orders enums by their option order, not alphabetically", () => {
    const rows = [row("idle", { status: "idle" }), row("failed", { status: "failed" })];
    expect(
      sortViewRows(rows, [{ property: "status", direction: "asc" }]).map((r) => r.key),
    ).toEqual(["failed", "idle"]);
  });

  it("falls back to latest activity", () => {
    const rows = [row("old", { activityMs: NOW - DAY }), row("new", { activityMs: NOW })];
    expect(sortViewRows(rows, []).map((r) => r.key)).toEqual(["new", "old"]);
  });
});

describe("stageOfStatus", () => {
  it("runs left to right from needing you to done", () => {
    expect(
      (["input", "failed", "working", "waiting", "done", "woke", "idle"] as const).map(
        stageOfStatus,
      ),
    ).toEqual(["needs-you", "needs-you", "working", "working", "review", "review", "done"]);
  });

  it("groups a stage board in that order", () => {
    const rows = [
      row("d", { stage: "done" }),
      row("w", { stage: "working" }),
      row("n", { stage: "needs-you" }),
    ];
    const groups = groupViewRows(rows, "stage", { hideEmpty: false, nowMs: NOW });
    expect(groups.map((g) => g.key)).toEqual(["needs-you", "working", "review", "done"]);
  });
});

describe("groupViewRows", () => {
  it("keeps fixed section order and drops empty groups when asked", () => {
    const rows = [row("a", { section: "settled" }), row("b", { section: "pinned" })];
    const groups = groupViewRows(rows, "section", { hideEmpty: true, nowMs: NOW });
    expect(groups.map((g) => g.key)).toEqual(["pinned", "settled"]);
    const all = groupViewRows(rows, "section", { hideEmpty: false, nowMs: NOW });
    expect(all.map((g) => g.key)).toEqual(["pinned", "active", "snoozed", "settled"]);
  });

  it("labels derived groups and buckets dates", () => {
    const rows = [
      row("a", { projectKey: "env:p2", projectLabel: "Beta" }),
      row("b", { activityMs: NOW - 40 * DAY }),
    ];
    expect(
      groupViewRows(rows, "project", { hideEmpty: true, nowMs: NOW }).map((g) => g.label),
    ).toEqual(["Beta", "Alpha"]);
    expect(
      groupViewRows(rows, "activity", { hideEmpty: true, nowMs: NOW }).map((g) => g.key),
    ).toEqual(["today", "older"]);
  });

  it("returns one group when there is no grouping", () => {
    expect(groupViewRows([row("a")], null, { hideEmpty: true, nowMs: NOW })).toHaveLength(1);
  });
});

describe("dateBucket", () => {
  it("uses local calendar days", () => {
    const midnight = new Date(2026, 9, 9, 0, 0).getTime();
    expect(dateBucket(midnight, NOW)).toBe("today");
    expect(dateBucket(midnight - 1, NOW)).toBe("yesterday");
    expect(dateBucket(midnight - 3 * DAY, NOW)).toBe("week");
  });
});

describe("custom categories", () => {
  const categories = [
    { id: "u100", name: "Update 100" },
    { id: "empty", name: "Later" },
  ];
  const rows = [
    row("vault", { projectKey: "env:vault", projectLabel: "Pet Vault", category: "u100" }),
    row("repo", { projectKey: "env:ps99", projectLabel: "pet-simulator-99", category: "u100" }),
    row("other", { projectKey: "env:ps99", projectLabel: "pet-simulator-99" }),
  ];

  it("pull filed threads out of their projects into a category group", () => {
    const groups = groupViewRows(rows, "project", { hideEmpty: true, nowMs: NOW, categories });
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.key)])).toEqual([
      ["Update 100", ["vault", "repo"]],
      ["Later", []],
      ["pet-simulator-99", ["other"]],
    ]);
  });

  it("group by category with the rest under No category", () => {
    const groups = groupViewRows(rows, "category", { hideEmpty: true, nowMs: NOW, categories });
    expect(groups.map((g) => g.key)).toEqual(["category:u100", "category:empty", ""]);
  });

  it("plan drops: into a category, back to the own project, never to another", () => {
    const filed = rows[0]!;
    const loose = rows[2]!;
    expect(planGroupDrop("project", loose, "category:u100")).toEqual({
      kind: "category",
      categoryId: "u100",
    });
    expect(planGroupDrop("project", filed, "env:vault")).toEqual({
      kind: "category",
      categoryId: null,
    });
    expect(planGroupDrop("project", filed, "env:ps99")).toBeNull();
    expect(planGroupDrop("project", filed, "category:u100")).toBeNull();
    expect(planGroupDrop("category", filed, "")).toEqual({ kind: "category", categoryId: null });
    expect(planGroupDrop("status", loose, "category:u100")).toBeNull();
    expect(planGroupDrop("section", loose, "pinned")).toEqual({
      kind: "section",
      section: "pinned",
    });
  });
});
