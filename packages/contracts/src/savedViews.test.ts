import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { SavedView } from "./savedViews.ts";

const decode = Schema.decodeUnknownSync(SavedView);

describe("SavedView", () => {
  it("decodes the threads layout with default threads options", () => {
    const view = decode({ id: "threads", name: "Threads", layout: "threads" });
    expect(view.layout).toBe("threads");
    expect(view.threads).toEqual({
      sort: { field: "manual", reversed: false },
      projectSort: { field: "activity", reversed: false },
      pinsStayGrouped: false,
    });
  });
  it("decodes a layout from a newer build as list instead of failing", () => {
    const view = decode({ id: "x", name: "X", layout: "timeline" });
    expect(view.layout).toBe("list");
  });
});
