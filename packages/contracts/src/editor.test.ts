import { describe, expect, it } from "@effect/vitest";

import { defaultOpenBlockedExtension } from "./editor.ts";

describe("defaultOpenBlockedExtension", () => {
  it.each([
    ["C:\\Users\\me\\Downloads\\setup.exe", ".exe"],
    ["C:/x/RUN.BAT", ".bat"],
    ["C:/x/run.exe.", ".exe"],
    ["C:/x/run.exe .", ".exe"],
    ["/Applications/Calculator.app/", ".app"],
    ["/home/me/install.sh", ".sh"],
    ["/tmp/a.tar.lnk", ".lnk"],
  ])("blocks %s", (path, extension) => {
    expect(defaultOpenBlockedExtension(path)).toBe(extension);
  });

  it.each([
    "C:/x/thumb.png",
    "/repo/README.md",
    "/repo/src/index.ts",
    "/repo/.bashrc",
    "/repo/Makefile",
    "C:/x/report.json",
  ])("allows %s", (path) => {
    expect(defaultOpenBlockedExtension(path)).toBeUndefined();
  });
});
