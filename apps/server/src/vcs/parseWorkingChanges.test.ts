import { describe, expect, it } from "@effect/vitest";

import { parseWorkingChanges } from "./GitVcsDriverCore.ts";

const NUL = "\0";

describe("parseWorkingChanges", () => {
  it("splits the index from the working tree and reads the branch", () => {
    const stdout = [
      "## main...origin/main [ahead 1]",
      "M  staged.ts",
      " M dirty.ts",
      "MM both.ts",
      "A  new.ts",
      "D  gone.ts",
      " D removed-in-tree.ts",
      "?? fresh.ts",
      "!! ignored.ts",
    ].join(NUL);
    const result = parseWorkingChanges(stdout + NUL);
    expect(result.refName).toBe("main");
    expect(result.staged).toEqual([
      { path: "staged.ts", previousPath: null, status: "M" },
      { path: "both.ts", previousPath: null, status: "M" },
      { path: "new.ts", previousPath: null, status: "A" },
      { path: "gone.ts", previousPath: null, status: "D" },
    ]);
    expect(result.unstaged).toEqual([
      { path: "dirty.ts", previousPath: null, status: "M" },
      { path: "both.ts", previousPath: null, status: "M" },
      { path: "removed-in-tree.ts", previousPath: null, status: "D" },
    ]);
    expect(result.untracked).toEqual([{ path: "fresh.ts", previousPath: null, status: "U" }]);
  });

  it("keeps a rename's old path and treats conflicts as unmerged", () => {
    const stdout = ["## feature", "R  new-name.ts", "old-name.ts", "UU clash.ts"].join(NUL) + NUL;
    const result = parseWorkingChanges(stdout);
    expect(result.staged).toEqual([
      { path: "new-name.ts", previousPath: "old-name.ts", status: "R" },
    ]);
    expect(result.unstaged).toEqual([{ path: "clash.ts", previousPath: null, status: "U" }]);
  });

  it("reports no branch when HEAD is detached and the branch of an unborn repo", () => {
    expect(parseWorkingChanges("## HEAD (no branch)" + NUL).refName).toBeNull();
    expect(parseWorkingChanges("## No commits yet on main" + NUL).refName).toBe("main");
    expect(parseWorkingChanges("")).toEqual({
      refName: null,
      staged: [],
      unstaged: [],
      untracked: [],
    });
  });
});
