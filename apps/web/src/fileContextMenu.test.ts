import { EnvironmentId } from "@t3tools/contracts";
import * as NodeAssert from "node:assert/strict";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFileContextMenuItems,
  resolveFileContextMenuAbsolutePath,
  resolveFileContextMenuRelativePath,
} from "./fileContextMenu";

const BASE_TARGET = {
  environmentId: EnvironmentId.make("environment-local"),
  filePath: "src/index.ts",
  workspaceRoot: "/workspace/project",
};

describe("resolveFileContextMenuAbsolutePath", () => {
  it("joins workspace-relative diff paths onto the workspace root", () => {
    expect(resolveFileContextMenuAbsolutePath(BASE_TARGET)).toBe("/workspace/project/src/index.ts");
  });

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
  it("offers open file, parent folder, open with, then the copy actions for a file", () => {
    const items = buildFileContextMenuItems({
      hasAbsolutePath: true,
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

  it("offers open folder without a parent or editor entry for a folder", () => {
    const items = buildFileContextMenuItems({
      kind: "directory",
      hasAbsolutePath: true,
      capabilities: { canOpenDefault: true, editorIds: ["vscode", "file-manager"] },
    });

    expect(items.map((item) => item.label)).toEqual([
      "Open Folder",
      "Copy relative path",
      "Copy full path",
    ]);
  });

  it("keeps the copy actions when the environment cannot open files", () => {
    const items = buildFileContextMenuItems({
      hasAbsolutePath: true,
      capabilities: { canOpenDefault: false, editorIds: [] },
    });

    expect(items.map((item) => item.id)).toEqual(["copy-relative-path", "copy-full-path"]);
    expect(items[0]?.separatorBefore).toBeUndefined();
  });

  it("offers only the relative copy when the path cannot be resolved", () => {
    expect(
      buildFileContextMenuItems({
        hasAbsolutePath: false,
        capabilities: { canOpenDefault: true, editorIds: ["vscode"] },
      }).map((item) => item.id),
    ).toEqual(["copy-relative-path"]);
  });
});
