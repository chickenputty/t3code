/**
 * Shared "open with the OS" and copy-path entries for every file menu (chat
 * file chips, changed-files cards, the diff panel, the files tree and the
 * open-in picker), so their wording and order stay identical. Opening rides
 * `shell.openInEditor` with the "file-manager" editor and no reveal flag: a
 * file opens in its default app and a folder opens in the file manager.
 */
import {
  defaultOpenBlockedExtension,
  DIRECTORY_LAUNCH_EXTENSIONS,
  type ContextMenuItem,
} from "@t3tools/contracts";

export type FileEntryKind = "file" | "directory";

export type FileOpenMenuAction =
  | "open-file"
  | "open-parent-folder"
  | "copy-relative-path"
  | "copy-full-path";

export const OPEN_PARENT_FOLDER_LABEL = "Open Parent Folder";
export const COPY_RELATIVE_PATH_LABEL = "Copy relative path";
export const COPY_FULL_PATH_LABEL = "Copy full path";

export function openEntryLabel(kind: FileEntryKind): string {
  return kind === "directory" ? "Open Folder" : "Open File";
}

/**
 * Parent directory of an absolute host path, keeping its separator style.
 * Null for a filesystem or drive root, which has no parent to open.
 */
export function parentDirectoryPath(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (separatorIndex < 0) return null;
  const parent = trimmed.slice(0, separatorIndex);
  if (parent.length === 0) return trimmed.startsWith("/") ? "/" : null;
  // `C:\file` lives in the drive root, which needs its separator to mean the root.
  if (/^[a-zA-Z]:$/.test(parent)) return `${parent}${trimmed.charAt(separatorIndex)}`;
  return parent;
}

/**
 * Whether "Open File"/"Open Folder" may launch `path`. Opening a script,
 * installer or shortcut with its default app runs it, so those are left to
 * "Open Parent Folder"; the server refuses them too. Folders only open in the
 * file manager, except macOS bundles (.app, .pkg) that launch.
 */
export function canOpenEntryWithDefaultApp(path: string, kind: FileEntryKind): boolean {
  const blocked = defaultOpenBlockedExtension(path);
  return (
    blocked === undefined ||
    (kind === "directory" && !DIRECTORY_LAUNCH_EXTENSIONS.includes(blocked))
  );
}

/**
 * "Open File"/"Open Folder" plus "Open Parent Folder" for a file that has a
 * parent. `path` is the absolute host path when it is known.
 */
export function buildFileOpenMenuItems(input: {
  readonly kind: FileEntryKind;
  readonly canOpen: boolean;
  readonly path: string;
}): ContextMenuItem<FileOpenMenuAction>[] {
  if (!input.canOpen) return [];
  const items: ContextMenuItem<FileOpenMenuAction>[] = [];
  if (canOpenEntryWithDefaultApp(input.path, input.kind)) {
    items.push({
      id: "open-file",
      label: openEntryLabel(input.kind),
      icon: input.kind === "directory" ? "folder" : "pencil",
    });
  }
  if (input.kind === "file" && parentDirectoryPath(input.path) !== null) {
    items.push({ id: "open-parent-folder", label: OPEN_PARENT_FOLDER_LABEL, icon: "folder" });
  }
  return items;
}

export function buildCopyPathMenuItems(input: {
  readonly canCopyFullPath: boolean;
}): ContextMenuItem<FileOpenMenuAction>[] {
  return [
    { id: "copy-relative-path", label: COPY_RELATIVE_PATH_LABEL, icon: "copy" },
    ...(input.canCopyFullPath
      ? [{ id: "copy-full-path", label: COPY_FULL_PATH_LABEL, icon: "copy" } as const]
      : []),
  ];
}
