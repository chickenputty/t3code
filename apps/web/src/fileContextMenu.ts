import {
  AuthOrchestrationOperateScope,
  buildRemoteOpenUrl,
  EDITORS,
  type ContextMenuItem,
  type EditorId,
  type EnvironmentId,
  type ContextMenuSource,
} from "@t3tools/contracts";

import { contextMenuSourceOf } from "./contextMenuSource";
import { resolveDiffPathForWorkspace } from "./diffFileActions";
import {
  buildCopyPathMenuItems,
  buildFileOpenMenuItems,
  canOpenEntryWithDefaultApp,
  parentDirectoryPath,
  type FileEntryKind,
  type FileOpenMenuAction,
} from "./fileOpenMenu";
import { useEditorMenuIcons } from "./editorMenuIcons";
import { writeTextToClipboard } from "./hooks/useCopyToClipboard";
import { readLocalApi } from "./localApi";
import {
  openRemoteEditorUrl,
  useRemoteCapableEditors,
  useRemoteOpenResolution,
} from "./remoteOpen";
import { serverEnvironment } from "./state/server";
import { useEnvironmentScope } from "./state/session";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { toastManager } from "./components/ui/toast";
import { useAtomValue } from "@effect/atom-react";
import { msg, useMessages } from "gt-react";

import type { MessageResolver } from "./i18n/messages";

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

export function buildFileContextMenuItems(input: {
  readonly kind?: FileEntryKind | undefined;
  readonly absolutePath: string | null;
  readonly capabilities: FileContextMenuCapabilities;
  readonly editorIcons: ReadonlyMap<EditorId, string>;
  readonly resolve: MessageResolver;
}): readonly ContextMenuItem<FileContextMenuAction>[] {
  const kind = input.kind ?? "file";
  const hasAbsolutePath = input.absolutePath !== null;
  const items: ContextMenuItem<FileContextMenuAction>[] = [
    ...buildFileOpenMenuItems({
      kind,
      canOpen: hasAbsolutePath && input.capabilities.canOpenDefault,
      path: input.absolutePath ?? "",
    }),
  ];
  const editorIds = input.capabilities.editorIds.filter((id) => id !== "file-manager");
  if (hasAbsolutePath && editorIds.length > 0) {
    items.push({
      id: "open-with",
      label: input.resolve(msg("Open with")),
      children: editorIds.map((editorId) => {
        const iconImage = input.editorIcons.get(editorId);
        return {
          id: `editor:${editorId}` as FileContextMenuAction,
          label: EDITOR_LABEL_BY_ID.get(editorId) ?? editorId,
          ...(iconImage === undefined ? {} : { iconImage }),
        };
      }),
    });
  }
  const copyItems = buildCopyPathMenuItems({ canCopyFullPath: hasAbsolutePath });
  return [
    ...items,
    ...copyItems.map((item, index) =>
      index === 0 && items.length > 0 ? { ...item, separatorBefore: true } : item,
    ),
  ];
}

export function useFileContextMenu(environmentId: EnvironmentId | null) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const resolve = useMessages();

  const remoteOpen = useRemoteOpenResolution(environmentId);
  const remoteCapableEditors = useRemoteCapableEditors();
  const mode = environmentId !== null && remoteOpen.isResolved ? remoteOpen.state.mode : null;
  // Shell actions run on the server host, which is the viewer's machine only in local-exec.
  const canOperateHost = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const isLocalExec = mode === "local-exec" && canOperateHost;
  const remoteHost = remoteOpen.state.mode === "remote-links" ? remoteOpen.state.host : null;

  const availableEditors = isLocalExec
    ? (serverConfig?.availableEditors ?? [])
    : mode === "remote-links"
      ? remoteCapableEditors
      : [];
  const capabilities: FileContextMenuCapabilities = {
    canOpenDefault: isLocalExec && availableEditors.includes("file-manager"),
    editorIds: availableEditors,
  };
  const editorIcons = useEditorMenuIcons(availableEditors);

  const editorFailureTitle = (editor: EditorId) =>
    resolve(
      msg("Could not open in {editor}", {
        editor: EDITOR_LABEL_BY_ID.get(editor) ?? editor,
      }),
    );

  const copyPath = async (value: string, which: "relative" | "full"): Promise<void> => {
    try {
      await writeTextToClipboard(value);
      toastManager.add({
        type: "success",
        title:
          which === "relative"
            ? resolve(msg("Relative path copied"))
            : resolve(msg("Full path copied")),
        description: value,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title:
          which === "relative"
            ? resolve(msg("Failed to copy relative path"))
            : resolve(msg("Failed to copy full path")),
        description: error instanceof Error ? error.message : resolve(msg("An error occurred.")),
      });
    }
  };

  const activate = async (
    action: FileContextMenuAction,
    target: FileContextMenuTarget,
  ): Promise<void> => {
    if (action === "copy-relative-path") {
      await copyPath(resolveFileContextMenuRelativePath(target), "relative");
      return;
    }
    const absolutePath = resolveFileContextMenuAbsolutePath(target);
    if (absolutePath === null) return;
    if (action === "copy-full-path") {
      await copyPath(absolutePath, "full");
      return;
    }
    if (environmentId === null || action === "open-with") return;

    let launchPath = absolutePath;
    let editor: EditorId = "file-manager";
    let failureTitle: string;
    if (action === "open-file") {
      if (!capabilities.canOpenDefault) return;
      if (!canOpenEntryWithDefaultApp(absolutePath, target.kind ?? "file")) return;
      failureTitle =
        target.kind === "directory"
          ? resolve(msg("Could not open folder"))
          : resolve(msg("Could not open file"));
    } else if (action === "open-parent-folder") {
      if (!capabilities.canOpenDefault) return;
      const parent = parentDirectoryPath(absolutePath);
      if (parent === null) return;
      launchPath = parent;
      failureTitle = resolve(msg("Could not open parent folder"));
    } else {
      editor = action.slice("editor:".length) as EditorId;
      if (!capabilities.editorIds.includes(editor)) return;
      failureTitle = editorFailureTitle(editor);
    }

    if (remoteHost !== null) {
      const url = buildRemoteOpenUrl({
        editor,
        ...remoteHost,
        absolutePath,
        isFile: target.kind !== "directory",
      });
      if (url !== undefined && (await openRemoteEditorUrl(url))) return;
      toastManager.add({
        type: "error",
        title: editorFailureTitle(editor),
        description: absolutePath,
      });
      return;
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
      absolutePath: resolveFileContextMenuAbsolutePath(target),
      capabilities,
      editorIcons,
      resolve,
    });

  const show = async (
    target: FileContextMenuTarget,
    position?: { x: number; y: number },
    source?: ContextMenuSource,
  ): Promise<void> => {
    const api = readLocalApi();
    const items = buildItems(target);
    if (items.length === 0 || api === undefined) return;
    const clicked = await api.contextMenu.show(items, position, source);
    if (clicked === null) return;
    await activate(clicked as FileContextMenuAction, target);
  };

  return { buildItems, capabilities, activate, show };
}

export function useFileContextMenuHandler(environmentId: EnvironmentId | null) {
  const contextMenu = useFileContextMenu(environmentId);
  return (
    target: FileContextMenuTarget,
    event?: Pick<MouseEvent, "type" | "button" | "detail" | "clientX" | "clientY">,
  ) => {
    void contextMenu.show(
      target,
      event ? { x: event.clientX, y: event.clientY } : undefined,
      event ? contextMenuSourceOf(event) : undefined,
    );
  };
}
