import { isAbsolutePath, isWindowsAbsolutePath } from "@t3tools/shared/path";

export const WORKSPACE_BASENAME_LOOKUP_LIMIT = 25;

// All callers open one panel; the newest click must win across callers.
let latestLookupSequence = 0;

export function claimWorkspaceBasenameLookup(): () => boolean {
  latestLookupSequence += 1;
  const claimed = latestLookupSequence;
  return () => claimed === latestLookupSequence;
}

export interface WorkspaceEntryCandidate {
  readonly path: string;
  readonly kind: "file" | "directory";
}

function basenameOfPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

function normalizeRelativePath(path: string): string {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/^(?:\.\/)+/, "");
}

// A bare filename resolves to the workspace root, which is rarely where it is.
// A relative path with folders (`core/verdicts.md`) is often written relative to
// a subfolder the agent was working in rather than the root, so it is looked up
// too; an exact path in the index still wins over a deeper match.
export function needsWorkspaceBasenameLookup(relativePath: string): boolean {
  const trimmed = normalizeRelativePath(relativePath);
  return (
    trimmed.length > 0 &&
    trimmed !== "." &&
    !trimmed.startsWith("/") &&
    !/^[A-Za-z]:/.test(trimmed) &&
    !trimmed.split("/").includes("..")
  );
}

// Picks the one file the reference names: the exact path, else the single file
// whose path ends with it. Several equal candidates have no right answer, so
// they resolve to nothing rather than opening whichever the index ranked first.
export function pickWorkspaceBasenameMatch(
  reference: string,
  entries: ReadonlyArray<WorkspaceEntryCandidate>,
): string | null {
  const target = normalizeRelativePath(reference);
  if (!target) return null;
  const files = entries.filter((entry) => entry.kind === "file");
  if (!target.includes("/")) {
    const exact = files.find((entry) => basenameOfPath(entry.path) === target);
    if (exact) return exact.path;
    // Folded matching covers casing that drifted from disk, but `FOO.ts`
    // against both `Foo.ts` and `foo.ts` resolves to nothing.
    const folded = target.toLowerCase();
    const foldedMatches = files.filter(
      (entry) => basenameOfPath(entry.path).toLowerCase() === folded,
    );
    return foldedMatches.length === 1 ? (foldedMatches[0]?.path ?? null) : null;
  }
  const exact = files.find((entry) => normalizeRelativePath(entry.path) === target);
  if (exact) return exact.path;
  const suffix = `/${target}`;
  const suffixMatches = files.filter((entry) => normalizeRelativePath(entry.path).endsWith(suffix));
  if (suffixMatches.length === 1) return suffixMatches[0]?.path ?? null;
  if (suffixMatches.length > 1) return null;
  const foldedSuffix = suffix.toLowerCase();
  const foldedMatches = files.filter((entry) =>
    normalizeRelativePath(entry.path).toLowerCase().endsWith(foldedSuffix),
  );
  return foldedMatches.length === 1 ? (foldedMatches[0]?.path ?? null) : null;
}

// Repository-relative paths can repeat the project's suffix in subfolder projects.
export function stripRepeatedWorkspacePrefix(relativePath: string, cwd: string): string | null {
  if (isAbsolutePath(relativePath)) return null;
  const pathSegments = relativePath.split(/[\\/]+/);
  const cwdSegments = cwd.split(/[\\/]+/).filter(Boolean);
  const fold = isWindowsAbsolutePath(cwd)
    ? (segment: string | undefined) => segment?.toLowerCase()
    : (segment: string | undefined) => segment;
  for (let count = Math.min(cwdSegments.length, pathSegments.length - 1); count > 0; count--) {
    const prefix = cwdSegments.slice(-count);
    if (prefix.every((segment, index) => fold(segment) === fold(pathSegments[index]))) {
      return pathSegments.slice(count).join("/") || null;
    }
  }
  return null;
}

export function pickStrippedWorkspaceMatch(
  strippedPath: string,
  cwd: string,
  entries: ReadonlyArray<WorkspaceEntryCandidate>,
): string | null {
  const caseInsensitive = isWindowsAbsolutePath(cwd);
  const key = (path: string) => {
    const normalized = path.replaceAll("\\", "/");
    return caseInsensitive ? normalized.toLowerCase() : normalized;
  };
  const files = entries.filter((entry) => entry.kind === "file");
  return files.find((entry) => key(entry.path) === key(strippedPath))?.path ?? null;
}
