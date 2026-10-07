/**
 * Right-click actions for a workspace file or folder: open it with the OS
 * (default app for a file, file manager for a folder), open a file's parent
 * folder, open it in a detected editor, and copy its paths. Opening rides
 * `shell.openInEditor` with the "file-manager" editor, so it works for every
 * client and connection mode. The shared wording lives in `fileOpenMenu`.
 */
import {
  EDITORS,
  type ContextMenuItem,
  type EditorId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { resolveDiffPathForWorkspace } from "./diffFileActions";
import {
  buildCopyPathMenuItems,
  buildFileOpenMenuItems,
  parentDirectoryPath,
  type FileEntryKind,
  type FileOpenMenuAction,
} from "./fileOpenMenu";
import { writeTextToClipboard } from "./hooks/useCopyToClipboard";
import { readLocalApi } from "./localApi";
import { serverEnvironment } from "./state/server";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { resolvePathLinkTarget } from "./terminal-links";
import { toastManager } from "./components/ui/toast";
import { useAtomValue } from "@effect/atom-react";

export type FileContextMenuAction =
  | FileOpenMenuAction
  /** Submenu parent; never the activated id. */
  | "open-with"
  | `editor:${EditorId}`;

export interface FileContextMenuTarget {
  readonly environmentId: EnvironmentId | null;
  /** Repo- or workspace-relative path, as shown in diffs. */
  readonly filePath: string;
  readonly workspaceRoot: string | undefined;
  readonly repositoryRoot?: string | undefined;
  /** Defaults to "file". */
  readonly kind?: FileEntryKind | undefined;
}

/**
 * Absolute path on the environment host for a diff-style target, resolving
 * repo-relative paths through the workspace root like every other diff
 * surface. Returns null when the path cannot be resolved, which callers must
 * treat as "no open actions available".
 */
export function resolveFileContextMenuAbsolutePath(target: FileContextMenuTarget): string | null {
  const workspaceFilePath = resolveDiffPathForWorkspace({
    filePath: target.filePath,
    workspaceRoot: target.workspaceRoot,
    repositoryRoot: target.repositoryRoot,
  });
  if (workspaceFilePath === null) return null;
  if (target.workspaceRoot === undefined) {
    return workspaceFilePath.startsWith("/") || /^[a-zA-Z]:/.test(workspaceFilePath)
      ? workspaceFilePath
      : null;
  }
  return resolvePathLinkTarget(workspaceFilePath, target.workspaceRoot);
}

/** The path "Copy relative path" copies: workspace-relative when it resolves, else as shown. */
export function resolveFileContextMenuRelativePath(target: FileContextMenuTarget): string {
  return (
    resolveDiffPathForWorkspace({
      filePath: target.filePath,
      workspaceRoot: target.workspaceRoot,
      repositoryRoot: target.repositoryRoot,
    }) ?? target.filePath
  );
}

const EDITOR_LABEL_BY_ID = new Map(EDITORS.map((editor) => [editor.id, editor.label]));

export interface FileContextMenuCapabilities {
  readonly canOpenDefault: boolean;
  readonly editorIds: ReadonlyArray<EditorId>;
}

/**
 * Menu items for a target: "Open File"/"Open Folder", "Open Parent Folder"
 * (files), an "Open with" submenu of detected editors (files), then the copy
 * actions. Open actions need a resolvable absolute path; copying the relative
 * path always works.
 */
export function buildFileContextMenuItems(input: {
  readonly kind?: FileEntryKind | undefined;
  readonly hasAbsolutePath: boolean;
  readonly capabilities: FileContextMenuCapabilities;
}): readonly ContextMenuItem<FileContextMenuAction>[] {
  const kind = input.kind ?? "file";
  const items: ContextMenuItem<FileContextMenuAction>[] = [
    ...buildFileOpenMenuItems({
      kind,
      canOpen: input.hasAbsolutePath && input.capabilities.canOpenDefault,
    }),
  ];
  const editorIds = input.capabilities.editorIds.filter((id) => id !== "file-manager");
  if (input.hasAbsolutePath && kind === "file" && editorIds.length > 0) {
    items.push({
      id: "open-with",
      label: "Open with",
      children: editorIds.map((editorId) => ({
        id: `editor:${editorId}` as FileContextMenuAction,
        label: EDITOR_LABEL_BY_ID.get(editorId) ?? editorId,
      })),
    });
  }
  const copyItems = buildCopyPathMenuItems({ canCopyFullPath: input.hasAbsolutePath });
  return [
    ...items,
    ...copyItems.map((item, index) =>
      index === 0 && items.length > 0 ? { ...item, separatorBefore: true } : item,
    ),
  ];
}

/**
 * Context-menu actions for files. The environment id is fixed per component
 * (a thread's environment, a file browser's environment), so capabilities
 * resolve once per hook call.
 */
export function useFileContextMenu(environmentId: EnvironmentId | null) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));

  return useMemo(() => {
    const availableEditors = serverConfig?.availableEditors ?? [];
    const capabilities: FileContextMenuCapabilities = {
      canOpenDefault: environmentId !== null && availableEditors.includes("file-manager"),
      editorIds: availableEditors,
    };

    const copyPath = async (value: string, title: string): Promise<void> => {
      try {
        await writeTextToClipboard(value);
        toastManager.add({ type: "success", title: `${title} copied`, description: value });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: `Failed to copy ${title.toLowerCase()}`,
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    };

    const activate = async (
      action: FileContextMenuAction,
      target: FileContextMenuTarget,
    ): Promise<void> => {
      if (action === "copy-relative-path") {
        await copyPath(resolveFileContextMenuRelativePath(target), "Relative path");
        return;
      }
      const absolutePath = resolveFileContextMenuAbsolutePath(target);
      if (absolutePath === null) return;
      if (action === "copy-full-path") {
        await copyPath(absolutePath, "Full path");
        return;
      }
      if (environmentId === null || action === "open-with") return;

      let launchPath = absolutePath;
      let editor: EditorId = "file-manager";
      let failureTitle: string;
      if (action === "open-file") {
        failureTitle =
          target.kind === "directory" ? "Could not open folder" : "Could not open file";
      } else if (action === "open-parent-folder") {
        const parent = parentDirectoryPath(absolutePath);
        if (parent === null) return;
        launchPath = parent;
        failureTitle = "Could not open parent folder";
      } else {
        editor = action.slice("editor:".length) as EditorId;
        if (!capabilities.editorIds.includes(editor)) return;
        failureTitle = `Could not open in ${EDITOR_LABEL_BY_ID.get(editor) ?? editor}`;
      }

      const result = await openInEditor({
        environmentId,
        input: { cwd: launchPath, editor },
      });
      if (result._tag !== "Failure") return;
      toastManager.add({ type: "error", title: failureTitle, description: launchPath });
    };

    const buildItems = (target: FileContextMenuTarget) =>
      buildFileContextMenuItems({
        kind: target.kind,
        hasAbsolutePath: resolveFileContextMenuAbsolutePath(target) !== null,
        capabilities,
      });

    const show = async (
      target: FileContextMenuTarget,
      position?: { x: number; y: number },
    ): Promise<void> => {
      const api = readLocalApi();
      const items = buildItems(target);
      if (items.length === 0 || api === undefined) return;
      const clicked = await api.contextMenu.show(items, position);
      if (clicked === null) return;
      await activate(clicked as FileContextMenuAction, target);
    };

    return { buildItems, capabilities, activate, show };
  }, [environmentId, openInEditor, serverConfig]);
}

/** Returns an onContextMenu callback that shows the menu at the pointer. */
export function useFileContextMenuHandler(environmentId: EnvironmentId | null) {
  const contextMenu = useFileContextMenu(environmentId);
  return useCallback(
    (target: FileContextMenuTarget, event?: { clientX: number; clientY: number }) => {
      void contextMenu.show(target, event ? { x: event.clientX, y: event.clientY } : undefined);
    },
    [contextMenu],
  );
}
