import { EnvironmentId } from "@t3tools/contracts";
import * as NodeAssert from "node:assert/strict";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  buildFileContextMenuItems,
  resolveFileContextMenuAbsolutePath,
  resolveFileContextMenuRelativePath,
  useFileContextMenu,
} from "./fileContextMenu";
import { m } from "./i18n/messages";
import type { RemoteOpenResolution } from "./remoteOpen";

const state = vi.hoisted(() => ({
  remoteOpen: { state: { mode: "local-exec" }, isResolved: true } as RemoteOpenResolution,
  openInEditor: vi.fn(async () => ({ _tag: "Success" })),
  openRemoteEditorUrl: vi.fn(async (_url: string) => true),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({
    availableEditors: ["cursor", "file-manager"],
    shellRevealInFileManager: true,
    shellRevealInFileManagerKind: "xdg-open",
    environment: { platform: { os: "linux" } },
  }),
}));
vi.mock("gt-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("gt-react")>()),
  useMessages: () => (text: string) => text,
}));
vi.mock(import("./state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
}));
vi.mock("./editorMenuIcons", () => ({ useEditorMenuIcons: () => new Map() }));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => state.openInEditor }));
vi.mock(import("./remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => state.remoteOpen,
  useRemoteCapableEditors: () => ["vscode"],
  openRemoteEditorUrl: state.openRemoteEditorUrl,
}));

const BASE_TARGET = {
  environmentId: EnvironmentId.make("environment-local"),
  filePath: "src/index.ts",
  workspaceRoot: "/workspace/project",
};

describe("resolveFileContextMenuAbsolutePath", () => {
  it("strips the repository prefix when the repo root is nested in the workspace", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: "/workspace/project/packages/app",
        repositoryRoot: "/workspace/project",
        filePath: "packages/app/src/index.ts",
      }),
    ).toBe("/workspace/project/packages/app/src/index.ts");
  });

  it("returns null for paths outside the workspace when a repository root is set", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: "/workspace/project/packages/app",
        repositoryRoot: "/workspace/project",
        filePath: "other/src/index.ts",
      }),
    ).toBeNull();
  });

  it("rejects absolute paths without a workspace root, matching diff path resolution", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: undefined,
        filePath: "/absolute/src/index.ts",
      }),
    ).toBeNull();
  });
});

describe("resolveFileContextMenuRelativePath", () => {
  it("copies the workspace-relative path, falling back to the path as shown", () => {
    expect(
      resolveFileContextMenuRelativePath({
        ...BASE_TARGET,
        workspaceRoot: "/workspace/project/packages/app",
        repositoryRoot: "/workspace/project",
        filePath: "packages/app/src/index.ts",
      }),
    ).toBe("src/index.ts");
    expect(
      resolveFileContextMenuRelativePath({
        ...BASE_TARGET,
        workspaceRoot: "/workspace/project/packages/app",
        repositoryRoot: "/workspace/project",
        filePath: "other/src/index.ts",
      }),
    ).toBe("other/src/index.ts");
  });
});

describe("buildFileContextMenuItems", () => {
  const MENU_TEXT = { editorIcons: new Map(), resolve: m };

  it("offers open file, parent folder, open with, then the copy actions for a file", () => {
    const items = buildFileContextMenuItems({
      ...MENU_TEXT,
      absolutePath: "/workspace/project/src/index.ts",
      capabilities: {
        canOpenDefault: true,
        editorIds: ["vscode", "cursor", "file-manager"],
      },
    });

    expect(items.map((item) => item.id)).toEqual([
      "open-file",
      "open-parent-folder",
      "open-with",
      "copy-relative-path",
      "copy-full-path",
    ]);
    expect(items.map((item) => item.label)).toEqual([
      "Open File",
      "Open Parent Folder",
      "Open with",
      "Copy relative path",
      "Copy full path",
    ]);
    expect(items[3]).toMatchObject({ separatorBefore: true });
    const openWith = items[2];
    NodeAssert.ok(openWith);
    expect(openWith.children?.map((child) => child.id)).toEqual(["editor:vscode", "editor:cursor"]);
  });

  it("offers open folder and open with, but no parent entry, for a folder", () => {
    const items = buildFileContextMenuItems({
      ...MENU_TEXT,
      kind: "directory",
      absolutePath: "/workspace/project/src",
      capabilities: { canOpenDefault: true, editorIds: ["vscode", "file-manager"] },
    });

    expect(items.map((item) => item.label)).toEqual([
      "Open Folder",
      "Open with",
      "Copy relative path",
      "Copy full path",
    ]);
  });

  it("keeps the parent folder but not open file for an executable file", () => {
    const items = buildFileContextMenuItems({
      ...MENU_TEXT,
      absolutePath: "C:\\repo\\scripts\\deploy.ps1",
      capabilities: { canOpenDefault: true, editorIds: ["vscode", "file-manager"] },
    });

    expect(items.map((item) => item.id)).toEqual([
      "open-parent-folder",
      "open-with",
      "copy-relative-path",
      "copy-full-path",
    ]);
  });

  it("keeps the copy actions when the environment cannot open files", () => {
    const items = buildFileContextMenuItems({
      ...MENU_TEXT,
      absolutePath: "/workspace/project/src/index.ts",
      capabilities: { canOpenDefault: false, editorIds: [] },
    });

    expect(items.map((item) => item.id)).toEqual(["copy-relative-path", "copy-full-path"]);
    expect(items[0]?.separatorBefore).toBeUndefined();
  });

  it("offers only the relative copy when the path cannot be resolved", () => {
    expect(
      buildFileContextMenuItems({
        ...MENU_TEXT,
        absolutePath: null,
        capabilities: { canOpenDefault: true, editorIds: ["vscode"] },
      }).map((item) => item.id),
    ).toEqual(["copy-relative-path"]);
  });
});

describe("useFileContextMenu", () => {
  it.each<[string, RemoteOpenResolution]>([
    ["remote-unavailable", { state: { mode: "remote-unavailable" }, isResolved: true }],
    ["unresolved", { state: { mode: "local-exec" }, isResolved: false }],
  ])("offers no open actions when remote open is %s", async (_mode, resolution) => {
    state.remoteOpen = resolution;
    state.openInEditor.mockClear();
    const menu = useFileContextMenu(BASE_TARGET.environmentId);

    expect(menu.buildItems(BASE_TARGET).map((item) => item.id)).toEqual([
      "copy-relative-path",
      "copy-full-path",
    ]);
    await menu.activate("open-file", BASE_TARGET);
    await menu.activate("editor:vscode", BASE_TARGET);
    expect(state.openInEditor).not.toHaveBeenCalled();
  });

  it("opens files over SSH remote links instead of on the server host", async () => {
    state.remoteOpen = {
      state: { mode: "remote-links", host: { kind: "ssh-alias", host: "box", username: "me" } },
      isResolved: true,
    };
    state.openInEditor.mockClear();
    state.openRemoteEditorUrl.mockClear();
    const menu = useFileContextMenu(BASE_TARGET.environmentId);

    expect(menu.buildItems(BASE_TARGET)[0]).toEqual({
      id: "open-with",
      label: "Open with",
      children: [{ id: "editor:vscode", label: "VS Code" }],
    });
    await menu.activate("open-file", BASE_TARGET);
    await menu.activate("editor:vscode", BASE_TARGET);
    await menu.activate("editor:vscode", { ...BASE_TARGET, filePath: "src", kind: "directory" });
    expect(state.openInEditor).not.toHaveBeenCalled();
    expect(state.openRemoteEditorUrl.mock.calls).toEqual([
      ["vscode://vscode-remote/ssh-remote+me%40box/workspace/project/src/index.ts:1:1"],
      ["vscode://vscode-remote/ssh-remote+me%40box/workspace/project/src?windowId=_blank"],
    ]);
  });

  it("opens files on the server host when remote open is local-exec", async () => {
    state.remoteOpen = { state: { mode: "local-exec" }, isResolved: true };
    state.openInEditor.mockClear();
    const menu = useFileContextMenu(BASE_TARGET.environmentId);

    expect(menu.buildItems(BASE_TARGET).map((item) => item.id)).toEqual([
      "open-file",
      "open-parent-folder",
      "open-with",
      "copy-relative-path",
      "copy-full-path",
    ]);
    await menu.activate("open-file", BASE_TARGET);
    expect(state.openInEditor).toHaveBeenCalledWith({
      environmentId: BASE_TARGET.environmentId,
      input: { cwd: "/workspace/project/src/index.ts", editor: "file-manager" },
    });
  });
});
