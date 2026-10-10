import { describe, expect, it } from "vite-plus/test";

import {
  claimWorkspaceBasenameLookup,
  needsWorkspaceBasenameLookup,
  pickWorkspaceBasenameMatch,
} from "./workspaceBasenameLookup";

describe("needsWorkspaceBasenameLookup", () => {
  it("flags bare filenames", () => {
    expect(needsWorkspaceBasenameLookup("ChatView.tsx")).toBe(true);
    expect(needsWorkspaceBasenameLookup("Makefile")).toBe(true);
  });

  it("flags relative paths with folders", () => {
    expect(needsWorkspaceBasenameLookup("core/retrain-verdicts.md")).toBe(true);
    expect(needsWorkspaceBasenameLookup("core\\retrain-verdicts.md")).toBe(true);
    expect(needsWorkspaceBasenameLookup("./core/retrain-verdicts.md")).toBe(true);
  });

  it("leaves absolute, parent-relative and empty paths alone", () => {
    expect(needsWorkspaceBasenameLookup("C:\\Users\\Adam\\notes.md")).toBe(false);
    expect(needsWorkspaceBasenameLookup("/home/adam/notes.md")).toBe(false);
    expect(needsWorkspaceBasenameLookup("../notes.md")).toBe(false);
    expect(needsWorkspaceBasenameLookup(".")).toBe(false);
    expect(needsWorkspaceBasenameLookup("..")).toBe(false);
    expect(needsWorkspaceBasenameLookup("   ")).toBe(false);
  });
});

describe("pickWorkspaceBasenameMatch", () => {
  const entries = [
    { path: "apps/web/src/components/ChatView.test.tsx", kind: "file" as const },
    { path: "apps/web/src/components/ChatView.tsx", kind: "file" as const },
  ];

  it("takes the first exact filename match, not the closest fuzzy one", () => {
    expect(pickWorkspaceBasenameMatch("ChatView.tsx", entries)).toBe(
      "apps/web/src/components/ChatView.tsx",
    );
  });

  it("ignores directories", () => {
    expect(
      pickWorkspaceBasenameMatch("components", [
        { path: "apps/web/src/components", kind: "directory" },
        { path: "apps/web/src/components/components", kind: "file" },
      ]),
    ).toBe("apps/web/src/components/components");
  });

  it("prefers the exactly-cased file over a case-only twin", () => {
    expect(
      pickWorkspaceBasenameMatch("foo.ts", [
        { path: "src/Foo.ts", kind: "file" },
        { path: "src/foo.ts", kind: "file" },
      ]),
    ).toBe("src/foo.ts");
  });

  it("falls back to case-insensitive when only the casing differs", () => {
    expect(pickWorkspaceBasenameMatch("chatview.tsx", entries)).toBe(
      "apps/web/src/components/ChatView.tsx",
    );
  });

  it("returns null when the case-insensitive fallback is ambiguous", () => {
    expect(
      pickWorkspaceBasenameMatch("FOO.ts", [
        { path: "src/Foo.ts", kind: "file" },
        { path: "src/foo.ts", kind: "file" },
      ]),
    ).toBeNull();
  });

  it("returns null when nothing matches the name", () => {
    expect(pickWorkspaceBasenameMatch("ChatView.tsx", [])).toBeNull();
    expect(
      pickWorkspaceBasenameMatch("ChatView.tsx", [
        { path: "apps/web/src/components/ChatHeader.tsx", kind: "file" },
      ]),
    ).toBeNull();
  });
});

describe("pickWorkspaceBasenameMatch with folders", () => {
  const verdicts = {
    path: ".claude/skills/ps99-art/core/retrain-verdicts.md",
    kind: "file" as const,
  };

  it("finds a path written relative to a subfolder", () => {
    expect(pickWorkspaceBasenameMatch("core\\retrain-verdicts.md", [verdicts])).toBe(verdicts.path);
  });

  it("prefers the exact workspace path over a deeper match", () => {
    expect(
      pickWorkspaceBasenameMatch("core/retrain-verdicts.md", [
        verdicts,
        { path: "core/retrain-verdicts.md", kind: "file" },
      ]),
    ).toBe("core/retrain-verdicts.md");
  });

  it("matches whole folder names, not name endings", () => {
    expect(
      pickWorkspaceBasenameMatch("core/retrain-verdicts.md", [
        { path: "hardcore/retrain-verdicts.md", kind: "file" },
      ]),
    ).toBeNull();
  });

  it("returns null when several folders end the same way", () => {
    expect(
      pickWorkspaceBasenameMatch("core/retrain-verdicts.md", [
        verdicts,
        { path: "old/core/retrain-verdicts.md", kind: "file" },
      ]),
    ).toBeNull();
  });
});

describe("claimWorkspaceBasenameLookup", () => {
  it("keeps only the newest claim, whatever order the lookups settle in", () => {
    const first = claimWorkspaceBasenameLookup();
    const second = claimWorkspaceBasenameLookup();

    // The older lookup answering last must not reopen the panel behind the
    // newer one.
    expect(second()).toBe(true);
    expect(first()).toBe(false);
  });

  it("stays valid while it is the only claim", () => {
    const only = claimWorkspaceBasenameLookup();
    expect(only()).toBe(true);
  });
});
