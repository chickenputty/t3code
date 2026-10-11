import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_SIDEBAR_PROJECT_SORT,
  MANUAL_SIDEBAR_THREAD_SORT,
} from "../sidebar/sidebarArrangement";
import { newSavedView, withBuiltInThreadsView } from "../views/viewEngine";
import { explorerWidthStorageKey, readExplorerWidth } from "./explorerWidth";
import { resolveActiveExplorerView } from "./explorerStore";

const LOCAL_DEFAULT = {
  groupByProject: false,
  pinsStayGrouped: false,
  sort: MANUAL_SIDEBAR_THREAD_SORT,
  projectSort: DEFAULT_SIDEBAR_PROJECT_SORT,
};

let values: Map<string, string>;

beforeEach(() => {
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

describe("explorer width", () => {
  it("keeps the upstream key for the built-in Threads view", () => {
    expect(explorerWidthStorageKey("threads")).toBe("chat_thread_sidebar_width");
    expect(explorerWidthStorageKey("view-1")).toBe("t3code:fork:explorer:width:view-1");
  });
  it("starts a view at its layout default", () => {
    const board = newSavedView("board", "b");
    expect(readExplorerWidth(board, 2400, 208)).toBe(880);
  });
  it("clamps a stored width so the chat keeps 640px", () => {
    const board = newSavedView("board", "b");
    window.localStorage.setItem(explorerWidthStorageKey("b"), JSON.stringify(1500));
    expect(readExplorerWidth(board, 1600, 208)).toBe(960);
  });
  it("ignores an unreadable stored width", () => {
    const list = newSavedView("list", "l");
    window.localStorage.setItem(explorerWidthStorageKey("l"), "not json");
    expect(readExplorerWidth(list, 2400, 208)).toBe(256);
  });
});

describe("resolveActiveExplorerView", () => {
  it("falls back to Threads when the active view was deleted", () => {
    const views = withBuiltInThreadsView([], LOCAL_DEFAULT);
    expect(resolveActiveExplorerView(views, "gone").id).toBe("threads");
    expect(resolveActiveExplorerView(views, null).id).toBe("threads");
  });
});
