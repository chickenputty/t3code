import { describe, expect, it } from "vite-plus/test";

import { inlineCodeFolderHref } from "./ChatMarkdown";
import { resolveMarkdownFileLinkMeta } from "../markdown-links";

describe("inlineCodeFolderHref", () => {
  it("reads an absolute folder path that ends with a separator", () => {
    expect(
      inlineCodeFolderHref(
        "C:\\Users\\Adam\\BIG Games Dropbox\\Game Assets\\Pet Simulator 99 Files\\_IMAGES\\_concepts\\",
      ),
    ).toBe("C:/Users/Adam/BIG Games Dropbox/Game Assets/Pet Simulator 99 Files/_IMAGES/_concepts");
    expect(inlineCodeFolderHref("/home/adam/art/")).toBe("/home/adam/art");
    expect(inlineCodeFolderHref("\\\\server\\share\\art\\")).toBe("//server/share/art");
  });

  it("leaves files, relative paths, drive roots and code alone", () => {
    expect(inlineCodeFolderHref("C:\\Users\\Adam\\notes.md")).toBeNull();
    expect(inlineCodeFolderHref("config/")).toBeNull();
    expect(inlineCodeFolderHref("a || b/")).toBeNull();
    expect(inlineCodeFolderHref("C:\\")).toBeNull();
  });

  it("resolves to a file chip named after the folder", () => {
    const href = inlineCodeFolderHref("C:\\Users\\Adam\\Game Assets\\_concepts\\");
    expect(
      resolveMarkdownFileLinkMeta(href ?? undefined, "C:/Users/Adam/Workspaces/repo"),
    ).toMatchObject({ filePath: "C:/Users/Adam/Game Assets/_concepts", basename: "_concepts" });
  });
});
