// @effect-diagnostics nodeBuiltinImport:off
/**
 * WorkspaceFileReferences - finds the file a chat message refers to.
 *
 * Fork (chickenputty/t3code). Agents often work in a git worktree of the
 * project that T3 does not know about (`.claude/worktrees/<branch>`, or a
 * sibling folder), so a relative path in their message only exists there. The
 * workspace search index skips gitignored folders, so the client asks here by
 * name: the path in the workspace first, then the same path in each of the
 * repository's other worktrees.
 *
 * @module WorkspaceFileReferences
 */
import * as NodeFSP from "node:fs/promises";

import type {
  ProjectResolveFileReferenceInput,
  ProjectResolveFileReferenceResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/** Worktrees beyond this are not checked, so a repo with hundreds stays cheap. */
const MAX_WORKTREES_CHECKED = 50;

/** Stat codes that mean "nothing is there", as opposed to a failure. */
const MISSING_PATH_CODES = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG", "EINVAL"]);

export class WorkspaceFileReferenceStatError extends Schema.TaggedError<WorkspaceFileReferenceStatError>()(
  "WorkspaceFileReferenceStatError",
  {
    cwd: Schema.String,
    path: Schema.String,
    statPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to check '${this.statPath}' for file reference '${this.path}' in '${this.cwd}'.`;
  }
}

export class WorkspaceFileReferences extends Context.Service<
  WorkspaceFileReferences,
  {
    /**
     * The absolute host path a reference names. "exact" when it exists where it
     * points; "worktree" when it exists only in another git worktree of the
     * repository (the most recently modified one wins). A missing file is a
     * null result, not an error.
     */
    readonly resolve: (
      input: ProjectResolveFileReferenceInput,
    ) => Effect.Effect<ProjectResolveFileReferenceResult, WorkspaceFileReferenceStatError>;
  }
>()("t3/workspace/WorkspaceFileReferences") {}

const NOT_FOUND: ProjectResolveFileReferenceResult = { path: null, source: null };

function errorCode(cause: unknown): string | undefined {
  const code = (cause as { readonly code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;

  const isInside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };

  const realPath = (target: string) =>
    Effect.tryPromise(() => NodeFSP.realpath(target)).pipe(Effect.orElseSucceed(() => target));

  /** The worktree copy's modified time, or null when it is not there or unreadable. */
  const modifiedTime = (target: string) =>
    Effect.tryPromise(() => NodeFSP.stat(target)).pipe(
      Effect.map((stat) => stat.mtimeMs),
      Effect.orElseSucceed(() => null),
    );

  const findInOtherWorktrees = Effect.fn("WorkspaceFileReferences.findInOtherWorktrees")(function* (
    cwd: string,
    relativeToCwd: string,
  ) {
    const worktrees = yield* git.listWorktreePaths(cwd).pipe(
      Effect.tapError((error) =>
        Effect.logDebug("File reference lookup skipped worktrees", { cwd, error }),
      ),
      // Not a git repository (or git is unavailable): there are no other worktrees.
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
    );
    if (worktrees.length === 0) return NOT_FOUND;

    const realCwd = yield* realPath(cwd);
    // The worktree holding cwd, the deepest one when worktrees nest
    // (`<repo>/.claude/worktrees/<branch>` sits inside the main checkout).
    const ownWorktree =
      worktrees
        .filter((worktree) => isInside(worktree, realCwd) || isInside(worktree, cwd))
        .toSorted((left, right) => right.length - left.length)[0] ?? null;
    if (ownWorktree === null) return NOT_FOUND;
    // cwd may be a folder inside its worktree; the other worktrees mirror it.
    const cwdWithinWorktree = isInside(ownWorktree, realCwd)
      ? path.relative(ownWorktree, realCwd)
      : path.relative(ownWorktree, cwd);

    const candidates = worktrees
      .filter((worktree) => path.relative(worktree, ownWorktree) !== "")
      .slice(0, MAX_WORKTREES_CHECKED)
      .map((worktree) => path.join(worktree, cwdWithinWorktree, relativeToCwd));
    const found = yield* Effect.forEach(
      candidates,
      (candidate) =>
        modifiedTime(candidate).pipe(
          Effect.map((mtimeMs) => (mtimeMs === null ? null : { candidate, mtimeMs })),
        ),
      { concurrency: 8 },
    );
    const newest = found
      .filter((entry) => entry !== null)
      .reduce<{ readonly candidate: string; readonly mtimeMs: number } | null>(
        (best, entry) => (best === null || entry.mtimeMs > best.mtimeMs ? entry : best),
        null,
      );
    return newest === null ? NOT_FOUND : ({ path: newest.candidate, source: "worktree" } as const);
  });

  const resolve: WorkspaceFileReferences["Service"]["resolve"] = Effect.fn(
    "WorkspaceFileReferences.resolve",
  )(function* (input) {
    // Either separator is accepted; on POSIX a backslash is a folder separator here.
    const reference =
      path.sep === "/" ? input.path.trim().replaceAll("\\", "/") : input.path.trim();
    const cwd = path.resolve(input.cwd);
    const target = path.isAbsolute(reference)
      ? path.resolve(reference)
      : path.resolve(cwd, reference);

    const exists = yield* Effect.tryPromise({
      try: () =>
        NodeFSP.stat(target).then(
          () => true,
          (cause: unknown) => {
            if (MISSING_PATH_CODES.has(errorCode(cause) ?? "")) return false;
            throw cause;
          },
        ),
      catch: (cause) =>
        new WorkspaceFileReferenceStatError({
          cwd: input.cwd,
          path: input.path,
          statPath: target,
          cause,
        }),
    });
    if (exists) return { path: target, source: "exact" } as const;

    if (!isInside(cwd, target) || path.relative(cwd, target) === "") return NOT_FOUND;
    return yield* findInOtherWorktrees(cwd, path.relative(cwd, target));
  });

  return WorkspaceFileReferences.of({ resolve });
});

export const layer = Layer.effect(WorkspaceFileReferences, make);
