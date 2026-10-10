import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceFileReferences from "./WorkspaceFileReferences.ts";

const layerTest = WorkspaceFileReferences.layer.pipe(
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-file-references-" }).pipe(
      Layer.provide(NodeServices.layer),
    ),
  ),
  Layer.provideMerge(NodeServices.layer),
);

// Seconds since the epoch, as fs.utimes takes them: 2020-01-01 and 2024-01-01.
const OLDER_TIME = 1_577_836_800;
const NEWER_TIME = 1_704_067_200;

const writeTextFile = Effect.fn("writeTextFile")(function* (target: string, contents = "") {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie);
  yield* fileSystem.writeFileString(target, contents).pipe(Effect.orDie);
});

/** A repo with one committed file and two linked worktrees, one nested inside it. */
const makeRepo = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const root = yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-file-references-" }),
  );
  const repo = path.join(root, "repo");
  const feature = path.join(root, "feature");
  const nested = path.join(repo, ".claude", "worktrees", "nested");
  yield* writeTextFile(path.join(repo, "shared.txt"), "shared\n");
  yield* writeTextFile(path.join(repo, ".gitignore"), ".claude/\n");
  for (const args of [
    ["init", "-b", "main"],
    ["add", "."],
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"],
    ["worktree", "add", "-b", "feature", feature],
    ["worktree", "add", "-b", "nested", nested],
  ]) {
    yield* git.execute({ operation: "test.setupRepo", cwd: repo, args });
  }
  return { root, repo, feature, nested };
});

it.layer(layerTest, { excludeTestServices: true })("WorkspaceFileReferences", (it) => {
  describe("resolve", () => {
    it.effect("finds a file where the reference points", () =>
      Effect.gen(function* () {
        const references = yield* WorkspaceFileReferences.WorkspaceFileReferences;
        const path = yield* Path.Path;
        const { repo } = yield* makeRepo;

        expect(yield* references.resolve({ cwd: repo, path: "shared.txt" })).toEqual({
          path: path.join(repo, "shared.txt"),
          source: "exact",
        });
        const absolute = path.join(repo, "shared.txt");
        expect(yield* references.resolve({ cwd: repo, path: absolute })).toEqual({
          path: absolute,
          source: "exact",
        });
      }),
    );

    it.effect("finds a file that only exists in another worktree", () =>
      Effect.gen(function* () {
        const references = yield* WorkspaceFileReferences.WorkspaceFileReferences;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { repo, feature, nested } = yield* makeRepo;
        yield* writeTextFile(path.join(nested, "core", "verdicts.md"), "nested\n");
        yield* writeTextFile(path.join(feature, "src", "only-feature.lua"), "feature\n");

        expect(yield* references.resolve({ cwd: repo, path: "core\\verdicts.md" })).toEqual({
          path: path.join(nested, "core", "verdicts.md"),
          source: "worktree",
        });
        // From one linked worktree to another, with a cwd inside the checkout.
        yield* fileSystem.makeDirectory(path.join(nested, "src"), { recursive: true });
        expect(
          yield* references.resolve({ cwd: path.join(nested, "src"), path: "only-feature.lua" }),
        ).toEqual({ path: path.join(feature, "src", "only-feature.lua"), source: "worktree" });
      }),
    );

    it.effect("prefers the most recently modified copy", () =>
      Effect.gen(function* () {
        const references = yield* WorkspaceFileReferences.WorkspaceFileReferences;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { repo, feature, nested } = yield* makeRepo;
        const older = path.join(feature, "notes", "plan.md");
        const newer = path.join(nested, "notes", "plan.md");
        yield* writeTextFile(older, "old\n");
        yield* writeTextFile(newer, "new\n");
        yield* fileSystem.utimes(older, OLDER_TIME, OLDER_TIME);
        yield* fileSystem.utimes(newer, NEWER_TIME, NEWER_TIME);

        expect(yield* references.resolve({ cwd: repo, path: "notes/plan.md" })).toEqual({
          path: newer,
          source: "worktree",
        });
      }),
    );

    it.effect("returns nothing for a missing file, outside paths and non-repositories", () =>
      Effect.gen(function* () {
        const references = yield* WorkspaceFileReferences.WorkspaceFileReferences;
        const path = yield* Path.Path;
        const { root, repo } = yield* makeRepo;
        yield* writeTextFile(path.join(root, "loose", "file.txt"));
        const notFound = { path: null, source: null };

        expect(yield* references.resolve({ cwd: repo, path: "src/missing.ts" })).toEqual(notFound);
        expect(yield* references.resolve({ cwd: repo, path: "shared.txt/below" })).toEqual(
          notFound,
        );
        // A reference outside the workspace is not looked for in the worktrees.
        expect(yield* references.resolve({ cwd: repo, path: "../feature-only.txt" })).toEqual(
          notFound,
        );
        expect(
          yield* references.resolve({ cwd: path.join(root, "loose"), path: "nope/file.txt" }),
        ).toEqual(notFound);
      }),
    );
  });
});
