import { describe, expect, it } from "vite-plus/test";

import { buildFileOpenMenuItems, openEntryLabel, parentDirectoryPath } from "./fileOpenMenu";

describe("parentDirectoryPath", () => {
  it.each([
    ["/workspace/project/src/index.ts", "/workspace/project/src"],
    ["/workspace/project/src/", "/workspace/project"],
    ["/index.ts", "/"],
    ["C:\\Users\\me\\project\\thumb.png", "C:\\Users\\me\\project"],
    ["C:/Users/me/project/thumb.png", "C:/Users/me/project"],
    ["C:\\thumb.png", "C:\\"],
    ["\\\\wsl.localhost\\Ubuntu\\home\\me\\file.ts", "\\\\wsl.localhost\\Ubuntu\\home\\me"],
  ])("returns the parent of %s", (path, parent) => {
    expect(parentDirectoryPath(path)).toBe(parent);
  });

  it.each(["/", "C:\\", "thumb.png"])("has no parent for %s", (path) => {
    expect(parentDirectoryPath(path)).toBeNull();
  });
});

describe("buildFileOpenMenuItems", () => {
  it("labels the open action by entry kind", () => {
    expect(openEntryLabel("file")).toBe("Open File");
    expect(openEntryLabel("directory")).toBe("Open Folder");
  });

  it("adds the parent folder entry for files only", () => {
    expect(
      buildFileOpenMenuItems({ kind: "file", canOpen: true }).map((item) => item.label),
    ).toEqual(["Open File", "Open Parent Folder"]);
    expect(
      buildFileOpenMenuItems({ kind: "directory", canOpen: true }).map((item) => item.label),
    ).toEqual(["Open Folder"]);
    expect(buildFileOpenMenuItems({ kind: "file", canOpen: false })).toEqual([]);
  });
});
