import { describe, expect, it } from "@effect/vitest";

import { defaultOpenBlockedExtension, effectivePathBasename } from "./editor.ts";

describe("effectivePathBasename", () => {
  it.each([
    ["C:/x/run.exe/.", "run.exe"],
    ["C:\\x\\run.exe\\.", "run.exe"],
    ["C:/x/run.exe/a/..", "run.exe"],
    ["/Applications/Calculator.app/.", "Calculator.app"],
    ["/repo/src/", "src"],
  ])("resolves %s to %s", (path, basename) => {
    expect(effectivePathBasename(path)).toBe(basename);
  });
});

describe("defaultOpenBlockedExtension", () => {
  it.each([
    ["C:\\Users\\me\\Downloads\\setup.exe", ".exe"],
    ["C:/x/RUN.BAT", ".bat"],
    ["C:/x/run.exe.", ".exe"],
    ["C:/x/run.exe .", ".exe"],
    ["C:/x/run.exe/.", ".exe"],
    ["C:/x/run.exe/a/..", ".exe"],
    ["C:/x/run.exe::$DATA", ".exe"],
    ["C:/x/run.exe:stream", ".exe"],
    ["/Applications/Calculator.app/", ".app"],
    ["/Applications/Calculator.app/.", ".app"],
    ["/home/me/install.sh", ".sh"],
    ["/tmp/a.tar.lnk", ".lnk"],
    ["C:/x/tool.jar", ".jar"],
    ["C:/x/script.pyw", ".pyw"],
    ["C:/x/setup.appinstaller", ".appinstaller"],
    ["C:/x/app.appref-ms", ".appref-ms"],
    ["/Users/me/Downloads/Installer.pkg", ".pkg"],
    ["/Users/me/Shell.terminal", ".terminal"],
    ["/home/me/Thing.AppImage", ".appimage"],
    ["/home/me/.local/share/applications/x.desktop", ".desktop"],
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

  it.each([
    ["/x/Evil:x.app", ".app"],
    ["/x/a:b.terminal", ".terminal"],
    ["/x/a:b.pkg", ".pkg"],
  ])("keeps a POSIX colon as part of the name in %s", (path, extension) => {
    expect(defaultOpenBlockedExtension(path)).toBe(extension);
    expect(defaultOpenBlockedExtension(path, [], "posix")).toBe(extension);
  });

  it("strips a Windows data stream only for Windows paths", () => {
    expect(defaultOpenBlockedExtension("C:/x/run.exe::$DATA", [], "win32")).toBe(".exe");
    expect(defaultOpenBlockedExtension("/x/run.exe:stream", [], "posix")).toBeUndefined();
    expect(defaultOpenBlockedExtension("/x/run.exe:stream", [], "win32")).toBe(".exe");
  });

  it("adds extra extensions such as the host's PATHEXT", () => {
    expect(defaultOpenBlockedExtension("C:/x/thing.foo")).toBeUndefined();
    expect(defaultOpenBlockedExtension("C:/x/thing.foo", [".FOO"])).toBe(".foo");
  });
});
