import { describe, expect, it } from "vite-plus/test";

import {
  buildFileOpenMenuItems,
  canOpenEntryWithDefaultApp,
  openEntryLabel,
  parentDirectoryPath,
} from "./fileOpenMenu";

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
    const labels = (input: Parameters<typeof buildFileOpenMenuItems>[0]) =>
      buildFileOpenMenuItems(input).map((item) => item.label);
    expect(labels({ kind: "file", canOpen: true, path: "/repo/a.png" })).toEqual([
      "Open File",
      "Open Parent Folder",
    ]);
    expect(labels({ kind: "directory", canOpen: true, path: "/repo/src" })).toEqual([
      "Open Folder",
    ]);
    expect(labels({ kind: "file", canOpen: false, path: "/repo/a.png" })).toEqual([]);
  });

  it("hides open file for executable types but keeps the parent folder", () => {
    const labels = (path: string, kind: "file" | "directory" = "file") =>
      buildFileOpenMenuItems({ kind, canOpen: true, path }).map((item) => item.label);
    expect(labels("C:\\Users\\me\\Downloads\\setup.exe")).toEqual(["Open Parent Folder"]);
    expect(labels("/repo/scripts/install.sh")).toEqual(["Open Parent Folder"]);
    expect(labels("/repo/node_modules/socket.io.js", "directory")).toEqual(["Open Folder"]);
    expect(labels("/Applications/Calculator.app", "directory")).toEqual([]);
  });

  it("drops the parent folder entry when the path has no parent", () => {
    expect(
      buildFileOpenMenuItems({ kind: "file", canOpen: true, path: "thumb.png" }).map(
        (item) => item.id,
      ),
    ).toEqual(["open-file"]);
  });

  it("only blocks app bundles among folders", () => {
    expect(canOpenEntryWithDefaultApp("/repo/lib.js", "directory")).toBe(true);
    expect(canOpenEntryWithDefaultApp("/repo/lib.js", "file")).toBe(false);
    expect(canOpenEntryWithDefaultApp("/Applications/Foo.app/", "directory")).toBe(false);
  });
});
