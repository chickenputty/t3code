import { beforeEach, describe, expect, it } from "vite-plus/test";

import { readThreadPaneTab, useThreadPaneTabStore } from "./threadPaneTabStore";

beforeEach(() => {
  useThreadPaneTabStore.setState({ tabs: { primary: "chat", secondary: "chat" } });
});

describe("readThreadPaneTab", () => {
  it.each([undefined, null, "files", {}, { tabs: null }, { tabs: { primary: "timeline" } }])(
    "reads %j as the chat tab",
    (raw) => {
      expect(readThreadPaneTab(raw, "primary")).toBe("chat");
    },
  );

  it("reads each pane's own stored tab", () => {
    const raw = { tabs: { primary: "files", secondary: "usage" } };
    expect(readThreadPaneTab(raw, "primary")).toBe("files");
    expect(readThreadPaneTab(raw, "secondary")).toBe("usage");
  });
});

describe("useThreadPaneTabStore", () => {
  it("sets one pane's tab without touching the other", () => {
    useThreadPaneTabStore.getState().setTab("secondary", "activity");
    expect(useThreadPaneTabStore.getState().tabs).toEqual({
      primary: "chat",
      secondary: "activity",
    });
  });

  it("keeps the chosen tabs across a reload", async () => {
    useThreadPaneTabStore.getState().setTab("primary", "overview");
    useThreadPaneTabStore.getState().setTab("secondary", "files");
    const { storage, name } = useThreadPaneTabStore.persist.getOptions();
    const saved = await storage!.getItem(name!);
    // A fresh page starts from the defaults and reads what was saved.
    useThreadPaneTabStore.setState({ tabs: { primary: "chat", secondary: "chat" } });
    await storage!.setItem(name!, saved!);
    await useThreadPaneTabStore.persist.rehydrate();
    expect(useThreadPaneTabStore.getState().tabs).toEqual({
      primary: "overview",
      secondary: "files",
    });
  });

  it("rehydrates an unknown tab from a newer build as chat", async () => {
    const { storage, name } = useThreadPaneTabStore.persist.getOptions();
    await storage!.setItem(name!, {
      state: { tabs: { primary: "timeline", secondary: "usage" } },
      version: 1,
    });
    await useThreadPaneTabStore.persist.rehydrate();
    expect(useThreadPaneTabStore.getState().tabs).toEqual({
      primary: "chat",
      secondary: "usage",
    });
  });
});
