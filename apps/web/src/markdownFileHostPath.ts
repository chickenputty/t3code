/**
 * Where a chat file chip's file really is on the host. A bare filename asks the
 * workspace index first, then other git worktrees (fork), since the workspace root
 * is rarely right. Every chip action resolves through here so they agree on one path.
 */
import { formatFilePathPosition, resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { isAbsolutePath, workspaceRelativeFilePath } from "@t3tools/shared/path";
import * as Schema from "effect/Schema";

import type { MarkdownFileLinkMeta } from "./markdown-links";

export class MarkdownFileParentFolderUnavailableError extends Schema.TaggedError<MarkdownFileParentFolderUnavailableError>()(
  "MarkdownFileParentFolderUnavailableError",
  {
    targetPath: Schema.String,
  },
) {
  override get message(): string {
    return `${this.targetPath} has no parent folder.`;
  }
}

export interface MarkdownFileHostPath {
  /** Absolute host path, without a line/column suffix. */
  readonly absolutePath: string;
  /** Workspace-relative path when the file is inside the workspace. */
  readonly relativePath: string | null;
  /** Whether the workspace index moved the link to a different file. */
  readonly matched: boolean;
}

export async function resolveMarkdownFileHostPath(input: {
  readonly meta: MarkdownFileLinkMeta;
  readonly cwd: string | undefined;
  /**
   * The file the reference names: workspace-relative from the index, or an
   * absolute host path when it lives in another git worktree. Null when not found.
   */
  readonly findWorkspaceMatch: (workspaceRelativePath: string) => Promise<string | null>;
}): Promise<MarkdownFileHostPath> {
  const { meta, cwd } = input;
  const match =
    meta.workspaceLookupPath && cwd
      ? await input.findWorkspaceMatch(meta.workspaceLookupPath)
      : null;
  if (match && cwd) {
    return {
      absolutePath: resolvePathLinkTarget(match, cwd),
      // A match in another worktree keeps the link's own repo-relative path.
      relativePath: isAbsolutePath(match) ? meta.workspaceRelativePath : match,
      matched: true,
    };
  }
  return { absolutePath: meta.filePath, relativePath: meta.workspaceRelativePath, matched: false };
}

/** The editor target for a resolved chip, keeping the link's line and column. */
export function markdownFileEditorTarget(
  meta: MarkdownFileLinkMeta,
  hostPath: MarkdownFileHostPath,
): string {
  return hostPath.matched
    ? formatFilePathPosition({ ...meta, path: hostPath.absolutePath })
    : meta.targetPath;
}

export function markdownFileCopyPaths(
  meta: MarkdownFileLinkMeta,
  hostPath: MarkdownFileHostPath,
  cwd: string | undefined,
) {
  const fullPath = markdownFileEditorTarget(meta, hostPath);
  return {
    fullPath,
    relativePath: formatFilePathPosition({
      ...meta,
      path:
        workspaceRelativeFilePath(hostPath.absolutePath, cwd) ??
        hostPath.relativePath ??
        meta.filePath,
    }),
  };
}
