import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

let values: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  values = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useExplorerStore", () => {
  it("starts with no active view and persists the choice", async () => {
    const { useExplorerStore } = await import("./explorerStore");
    expect(useExplorerStore.getState().activeViewId).toBeNull();
    useExplorerStore.getState().setActiveViewId("view-1");
    expect(JSON.parse(values.get("t3code:fork:explorer:v1")!)).toEqual({ activeViewId: "view-1" });
  });
  it("restores the persisted choice", async () => {
    values.set("t3code:fork:explorer:v1", JSON.stringify({ activeViewId: "view-2" }));
    const { useExplorerStore } = await import("./explorerStore");
    expect(useExplorerStore.getState().activeViewId).toBe("view-2");
  });
});
