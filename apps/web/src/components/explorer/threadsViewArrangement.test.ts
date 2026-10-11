import { describe, expect, it } from "vite-plus/test";

import { newSavedView, type ViewRow } from "../views/viewEngine";
import {
  threadsFilterKeys,
  threadsGroupRef,
  threadsPropertiesText,
  threadsViewSummary,
  withLocalArrangement,
} from "./threadsViewArrangement";

const NOW = new Date(2026, 9, 9, 15, 0).getTime();
const HOUR = 3_600_000;

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
    createdMs: NOW - 24 * HOUR,
    activityMs: NOW - HOUR,
    messages: 3,
    environment: "Local",
    ...overrides,
  } as unknown as ViewRow;
}

const threadsView = newSavedView("threads", "t");

describe("threadsFilterKeys", () => {
  it("is null while the view has no conditions", () => {
    expect(threadsFilterKeys([row("a")], threadsView, NOW)).toBeNull();
  });

  it("keeps matching threads in every section, archived, settled and sub-agents included", () => {
    const rows = [
      row("pinned-working", { section: "pinned", status: "working" }),
      row("snoozed-working", { section: "snoozed", status: "working" }),
      row("settled-working", { section: "settled", status: "working" }),
      row("subagent-working", { kind: "subagent", status: "working" }),
      row("active-idle", { status: "idle" }),
    ];
    const view = {
      ...threadsView,
      // The sidebar's own sections own these; the filter must ignore them.
      showSettled: false,
      showSubagents: false,
      filter: {
        conjunction: "and" as const,
        conditions: [{ property: "status", operator: "any_of", value: ["working"] }],
      },
    };
    expect([...(threadsFilterKeys(rows, view, NOW) ?? [])].toSorted()).toEqual([
      "pinned-working",
      "settled-working",
      "snoozed-working",
      "subagent-working",
    ]);
  });
});

describe("threadsGroupRef", () => {
  it("groups by model under the model's label", () => {
    expect(threadsGroupRef(row("a", { model: "gpt-6" }), "model", NOW)).toEqual({
      key: "gpt-6",
      label: "gpt-6",
    });
  });

  it("puts an unfiled thread in the No category group", () => {
    expect(threadsGroupRef(row("a"), "category", NOW)).toEqual({
      key: "none",
      label: "No category",
    });
    expect(
      threadsGroupRef(row("b", { category: "c1", categoryLabel: "Ship" }), "category", NOW),
    ).toEqual({ key: "c1", label: "Ship" });
  });

  it("puts a thread with no branch in the none group", () => {
    expect(threadsGroupRef(row("a"), "branch", NOW)).toEqual({
      key: "none",
      label: "No branch",
    });
  });

  it("uses option labels and date buckets", () => {
    expect(threadsGroupRef(row("a", { status: "working" }), "status", NOW).label).toBe("Working");
    expect(threadsGroupRef(row("a"), "activity", NOW)).toEqual({ key: "today", label: "Today" });
  });
});

describe("threadsPropertiesText", () => {
  it("joins the shown values and skips empty ones", () => {
    expect(
      threadsPropertiesText(row("a", { model: "opus" }), ["model", "branch", "messages"], NOW),
    ).toBe("opus · 3");
  });
});

describe("withLocalArrangement", () => {
  const local = {
    groupByProject: true,
    pinsStayGrouped: true,
    sort: { field: "activity", reversed: true },
    projectSort: { field: "opened", reversed: false },
  } as const;

  it("takes project grouping, sorts and pins from the device", () => {
    const view = { ...newSavedView("threads", "copy"), groupBy: null };
    const arranged = withLocalArrangement(view, local);
    expect(arranged.groupBy).toBe("project");
    expect(arranged.threads).toEqual({
      sort: { field: "activity", reversed: true },
      projectSort: { field: "opened", reversed: false },
      pinsStayGrouped: true,
    });
  });

  it("keeps the view's own grouping while project grouping is off", () => {
    const view = { ...newSavedView("threads", "copy"), groupBy: "status" };
    expect(withLocalArrangement(view, { ...local, groupByProject: false }).groupBy).toBe("status");
    const byProject = { ...view, groupBy: "project" };
    expect(withLocalArrangement(byProject, { ...local, groupByProject: false }).groupBy).toBeNull();
  });

  it("keeps the view's filter and properties", () => {
    const view = { ...newSavedView("threads", "copy"), properties: ["model"] };
    expect(withLocalArrangement(view, local).properties).toEqual(["model"]);
  });
});

describe("threadsViewSummary", () => {
  const view = newSavedView("threads", "copy");
  const condition = { property: "status", operator: "any_of", value: ["working"] };

  it("is empty for a plain view", () => {
    expect(threadsViewSummary({ ...view, groupBy: null })).toBeNull();
  });

  it("counts filters and names the grouping", () => {
    expect(threadsViewSummary({ ...view, groupBy: "status" })).toBe("By status");
    const filter = (count: number) => ({
      ...view.filter,
      conditions: Array.from({ length: count }, () => condition),
    });
    expect(threadsViewSummary({ filter: filter(1), groupBy: null })).toBe("1 filter");
    expect(threadsViewSummary({ filter: filter(2), groupBy: "project" })).toBe(
      "2 filters, By project",
    );
  });
});
