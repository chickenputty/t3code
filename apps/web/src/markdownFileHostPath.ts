/**
 * Where a chat file chip's file really is on the environment host. A bare
 * filename (`thumb.png`) resolves against the workspace root, which is rarely
 * where it lives, so the workspace index is asked first, as the files panel
 * does; a path with folders the index does not have is then looked for in the
 * repository's other git worktrees. Preview, open in editor, open file, open parent folder and the copy
 * actions all go through here so they agree on one path.
 */
import { formatFilePathPosition, resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { isAbsolutePath } from "@t3tools/shared/path";
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
    meta.workspaceRelativePath && cwd
      ? await input.findWorkspaceMatch(meta.workspaceRelativePath)
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
  if (!hostPath.matched) return meta.targetPath;
  return formatFilePathPosition({
    path: hostPath.absolutePath,
    ...(meta.line !== undefined ? { line: meta.line } : {}),
    ...(meta.column !== undefined ? { column: meta.column } : {}),
  });
}
