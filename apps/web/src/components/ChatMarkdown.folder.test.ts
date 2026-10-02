import { describe, expect, it } from "vite-plus/test";

import { inlineCodeFolderPath } from "./ChatMarkdown";

describe("inlineCodeFolderPath", () => {
  it("reads an absolute folder path that ends with a separator", () => {
    expect(
      inlineCodeFolderPath(
        String.raw`C:\Users\Adam\BIG Games Dropbox\Game Assets\Marketing\Update 96 - Hatch War\pets\ `,
      ),
    ).toEqual({
      path: String.raw`C:\Users\Adam\BIG Games Dropbox\Game Assets\Marketing\Update 96 - Hatch War\pets\ `.trim(),
      name: "pets",
    });
    expect(inlineCodeFolderPath("/home/adam/art/")).toEqual({
      path: "/home/adam/art/",
      name: "art",
    });
    expect(inlineCodeFolderPath(String.raw`\\server\share\art\ `)?.name).toBe("art");
  });

  it("leaves files, relative paths and code alone", () => {
    expect(inlineCodeFolderPath(String.raw`C:\Users\Adam\notes.md`)).toBeNull();
    expect(inlineCodeFolderPath("config/")).toBeNull();
    expect(inlineCodeFolderPath("a || b/")).toBeNull();
  });
});
