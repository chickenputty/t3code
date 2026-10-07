/**
 * Where a chat file chip's file really is on the environment host. A bare
 * filename (`thumb.png`) resolves against the workspace root, which is rarely
 * where it lives, so the workspace index is asked first, as the files panel
 * does. Preview, open in editor, open file, open parent folder and the copy
 * actions all go through here so they agree on one path.
 */
import { formatFilePathPosition } from "@t3tools/client-runtime/markdown-links";
import * as Schema from "effect/Schema";

import type { MarkdownFileLinkMeta } from "./markdown-links";
import { resolvePathLinkTarget } from "./terminal-links";

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
  /** Workspace-relative match for a bare filename, or null. */
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
      relativePath: match,
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
