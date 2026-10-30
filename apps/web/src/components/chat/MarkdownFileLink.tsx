import { formatFilePathForClipboard } from "@t3tools/client-runtime/media-actions";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  memo,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { readLocalApi } from "../../localApi";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import { shouldOpenMarkdownFileLinkInEditor } from "../../markdown-links";
import { buildFileOpenMenuItems } from "../../fileOpenMenu";
import { useFileMetadata } from "../../hooks/useFileMetadata";
import { documentChipKindForFileName } from "../../pierre-icons";
import { ContextChip } from "../ContextChip";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { FileTagChipContent } from "./FileTagChip";
import {
  hasMarkdownFilePrimaryAction,
  markdownFileCopyMenuItems,
  shouldUseMarkdownFileBrowserPrimaryAction,
} from "./MarkdownFileLink.logic";
import { reportMarkdownActionFailure } from "./markdownActionFailure";
import { WorkspaceEntryTooltip } from "./WorkspaceEntryIcon";

interface MarkdownFileLinkProps {
  environmentId: EnvironmentId | null;
  href: string;
  targetPath: string;
  iconPath: string;
  workspaceRelativePath: string | null;
  panelPath: string | null;
  line?: number | undefined;
  label: string;
  copyMarkdown: string;
  theme: "light" | "dark";
  threadRef?: ScopedThreadRef | undefined;
  onOpen?: (() => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
  onOpenInPanel: (panelPath: string, line: number | undefined) => void;
  /** Menu label for `onOpen`; omitted when the preferred editor is the file
      manager, which "Open File" already covers. */
  openInEditorMenuLabel?: string | undefined;
  onOpenInBrowser?: (() => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
  onOpenMedia?: (() => void) | undefined;
  /** Opens the file with its default app on the environment host. */
  onOpenFile?: (() => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
  /** Opens the file's folder in the environment host's file manager. */
  onOpenParentFolder?: (() => Promise<AtomCommandResult<unknown, unknown>>) | undefined;
  /** The paths the copy actions write, resolved the same way as the open actions. */
  resolveCopyPaths?:
    | (() => Promise<{ readonly fullPath: string; readonly relativePath: string }>)
    | undefined;
}

/** Per-link actions a file chip receives, cached so the chip's memo holds. */
export type MarkdownFileChipActions = Pick<
  MarkdownFileLinkProps,
  | "onOpen"
  | "onOpenMedia"
  | "onOpenFile"
  | "onOpenParentFolder"
  | "resolveCopyPaths"
  | "onOpenInBrowser"
>;

const MARKDOWN_FILE_LINK_CLASS_NAME = "chat-markdown-file-link";

export const MarkdownFileLink = memo(function MarkdownFileLink({
  environmentId,
  href,
  targetPath,
  iconPath,
  workspaceRelativePath,
  panelPath,
  line,
  label,
  copyMarkdown,
  theme,
  threadRef,
  onOpen,
  onOpenInPanel,
  openInEditorMenuLabel,
  onOpenInBrowser,
  onOpenMedia,
  onOpenFile,
  onOpenParentFolder,
  resolveCopyPaths,
}: MarkdownFileLinkProps) {
  // Fork (chickenputty/t3code): a chip that names a folder opens it in the
  // system file manager; the files panel only shows files. The query is the
  // one the chip's icon already makes.
  const isDirectory = useFileMetadata(environmentId, iconPath)?.kind === "directory";
  const handleOpenInEditor = () => {
    if (!onOpen) {
      return;
    }
    void (async () => {
      try {
        const result = await onOpen();
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        reportMarkdownActionFailure(
          { operation: "open-file-in-editor", target: targetPath },
          result.cause,
        );
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      } catch (cause) {
        reportMarkdownActionFailure(
          { operation: "open-file-in-editor", target: targetPath },
          cause,
        );
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file",
            description: cause instanceof Error ? cause.message : "An error occurred.",
          }),
        );
      }
    })();
  };

  const handleOpenInFilePreview = () => {
    if (threadRef && panelPath) {
      onOpenInPanel(panelPath, line);
      return;
    }
    if (onOpenMedia) {
      onOpenMedia();
      return;
    }
    handleOpenInEditor();
  };

  const handleOpenInBrowser = () => {
    if (!onOpenInBrowser) {
      return;
    }
    void (async () => {
      try {
        const result = await onOpenInBrowser();
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        reportMarkdownActionFailure(
          { operation: "open-file-in-browser", target: targetPath },
          result.cause,
        );
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file in browser",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      } catch (cause) {
        reportMarkdownActionFailure(
          { operation: "open-file-in-browser", target: targetPath },
          cause,
        );
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open file in browser",
            description: cause instanceof Error ? cause.message : "An error occurred.",
          }),
        );
      }
    })();
  };

  const runFileManagerAction = (
    action: (() => Promise<AtomCommandResult<unknown, unknown>>) | undefined,
    operation: string,
    failureTitle: string,
  ) => {
    if (!action) {
      return;
    }
    void (async () => {
      try {
        const result = await action();
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        reportMarkdownActionFailure({ operation, target: targetPath }, result.cause);
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: failureTitle,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      } catch (cause) {
        reportMarkdownActionFailure({ operation, target: targetPath }, cause);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: failureTitle,
            description: cause instanceof Error ? cause.message : "An error occurred.",
          }),
        );
      }
    })();
  };

  const handleCopy = (resolveValue: () => Promise<string>, title: string) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to copy ${title.toLowerCase()}`,
          description: "Clipboard API unavailable.",
        }),
      );
      return;
    }

    const value = resolveValue().then((text) => formatFilePathForClipboard(text, targetPath));
    // Start the write before workspace lookup finishes so Safari retains the user gesture.
    const write =
      typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined"
        ? navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": value.then((text) => new Blob([text], { type: "text/plain" })),
            }),
          ])
        : value.then((text) => navigator.clipboard.writeText(text));
    void Promise.all([write, value]).then(
      ([, text]) => {
        toastManager.add({
          type: "success",
          title: `${title} copied`,
          description: text,
        });
      },
      (error) => {
        reportMarkdownActionFailure(
          { operation: "copy-file-path", target: targetPath, copyTarget: title },
          error,
        );
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to copy ${title.toLowerCase()}`,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  };

  const showFileContextMenu = async (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;

    try {
      const copyItems = markdownFileCopyMenuItems({ targetPath, workspaceRelativePath });
      const clicked = await api.contextMenu.show(
        [
          ...(onOpenMedia ? ([{ id: "preview-media", label: "Preview media" }] as const) : []),
          ...(onOpen && openInEditorMenuLabel
            ? ([{ id: "open", label: openInEditorMenuLabel }] as const)
            : []),
          ...(onOpenInBrowser
            ? ([{ id: "open-in-browser", label: "Open in integrated browser" }] as const)
            : []),
          ...buildFileOpenMenuItems({
            kind: isDirectory ? "directory" : "file",
            canOpen: onOpenFile !== undefined && onOpenParentFolder !== undefined,
            path: iconPath,
          }),
          ...copyItems.map(({ id, label }) => ({ id, label })),
        ],
        position,
      );

      if (clicked === "preview-media") {
        onOpenMedia?.();
        return;
      }
      if (clicked === "open") {
        handleOpenInEditor();
        return;
      }
      if (clicked === "open-in-browser") {
        handleOpenInBrowser();
        return;
      }
      if (clicked === "open-file") {
        runFileManagerAction(
          onOpenFile,
          "open-file-with-default-app",
          isDirectory ? "Unable to open folder" : "Unable to open file",
        );
        return;
      }
      if (clicked === "open-parent-folder") {
        runFileManagerAction(
          onOpenParentFolder,
          "open-file-parent-folder",
          "Unable to open parent folder",
        );
        return;
      }
      if (clicked === "copy-relative" || clicked === "copy-full") {
        const copyItem = copyItems.find((item) => item.id === clicked);
        handleCopy(
          () =>
            resolveCopyPaths
              ? resolveCopyPaths().then((paths) =>
                  clicked === "copy-relative" ? paths.relativePath : paths.fullPath,
                )
              : Promise.resolve(copyItem?.value ?? targetPath),
          clicked === "copy-relative" ? "Relative path" : "Full path",
        );
      }
    } catch (cause) {
      reportMarkdownActionFailure(
        { operation: "show-file-context-menu", target: targetPath },
        cause,
      );
    }
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const position =
      event.clientX === 0 && event.clientY === 0
        ? (() => {
            const bounds = event.currentTarget.getBoundingClientRect();
            return { x: bounds.left, y: bounds.bottom };
          })()
        : { x: event.clientX, y: event.clientY };
    void showFileContextMenu(position);
  };

  const canOpenInEditor = onOpen !== undefined;
  const canOpenInBrowser = onOpenInBrowser !== undefined;
  const canOpenInPanel = threadRef !== undefined && Boolean(panelPath);
  const openFolderOnClick = isDirectory && onOpenFile !== undefined;
  const hasPrimaryAction =
    openFolderOnClick ||
    hasMarkdownFilePrimaryAction({
      canOpenInEditor,
      canOpenInBrowser,
      canOpenInPanel,
      canOpenMedia: onOpenMedia !== undefined,
    });
  const useBrowserPrimaryAction = shouldUseMarkdownFileBrowserPrimaryAction({
    iconPath,
    canOpenInEditor,
    canOpenInBrowser,
    canOpenInPanel,
  });
  const chipKind = documentChipKindForFileName(iconPath) ?? "mention";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          hasPrimaryAction ? (
            <ContextChip
              kind={chipKind}
              dir="ltr"
              render={<a href={href} />}
              className={MARKDOWN_FILE_LINK_CLASS_NAME}
              data-markdown-copy={copyMarkdown}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (onOpen && shouldOpenMarkdownFileLinkInEditor(event)) {
                  handleOpenInEditor();
                  return;
                }
                if (openFolderOnClick) {
                  runFileManagerAction(onOpenFile, "open-folder", "Unable to open folder");
                  return;
                }
                if (useBrowserPrimaryAction) {
                  handleOpenInBrowser();
                  return;
                }
                handleOpenInFilePreview();
              }}
              onContextMenu={handleContextMenu}
            >
              <FileTagChipContent
                path={iconPath}
                environmentId={environmentId}
                label={label}
                theme={theme}
              />
            </ContextChip>
          ) : (
            <ContextChip
              kind={chipKind}
              dir="ltr"
              render={<button type="button" />}
              aria-label={`File options for ${label}`}
              aria-haspopup="menu"
              className={cn(MARKDOWN_FILE_LINK_CLASS_NAME, "select-text")}
              data-markdown-copy={copyMarkdown}
              onClick={handleContextMenu}
              onContextMenu={handleContextMenu}
            >
              <FileTagChipContent
                path={iconPath}
                environmentId={environmentId}
                label={label}
                theme={theme}
              />
            </ContextChip>
          )
        }
      />
      <TooltipPopup side="top" variant="code">
        <ScrolledToEnd className="overflow-x-auto whitespace-nowrap scrollbar-thumb-border/78 scrollbar-track-transparent [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/78 [&::-webkit-scrollbar-track]:bg-transparent">
          <WorkspaceEntryTooltip path={iconPath} label={targetPath} environmentId={environmentId} />
        </ScrolledToEnd>
      </TooltipPopup>
    </Tooltip>
  );
}, areMarkdownFileLinkPropsEqual);

/**
 * Fork (chickenputty/t3code): a horizontal scroller that shows its end, so a
 * long path tooltip opens on the file name rather than the drive letter. It
 * re-pins when the content grows (the file size arrives after the path).
 */
function ScrolledToEnd(props: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resize observer pinning the DOM scroll position to the end
  useLayoutEffect(() => {
    const element = ref.current;
    const content = contentRef.current;
    if (!element || !content) return;
    const pinToEnd = () => {
      element.scrollLeft = element.scrollWidth;
    };
    pinToEnd();
    return observeResize(content, pinToEnd);
  }, []);
  return (
    <div ref={ref} className={props.className}>
      <span ref={contentRef} className="inline-block">
        {props.children}
      </span>
    </div>
  );
}

function areMarkdownFileLinkPropsEqual(
  previous: Readonly<MarkdownFileLinkProps>,
  next: Readonly<MarkdownFileLinkProps>,
): boolean {
  return (
    previous.href === next.href &&
    previous.targetPath === next.targetPath &&
    previous.iconPath === next.iconPath &&
    previous.environmentId === next.environmentId &&
    previous.workspaceRelativePath === next.workspaceRelativePath &&
    previous.panelPath === next.panelPath &&
    previous.line === next.line &&
    previous.label === next.label &&
    previous.copyMarkdown === next.copyMarkdown &&
    previous.theme === next.theme &&
    previous.threadRef === next.threadRef &&
    previous.onOpen === next.onOpen &&
    previous.onOpenInPanel === next.onOpenInPanel &&
    previous.openInEditorMenuLabel === next.openInEditorMenuLabel &&
    previous.onOpenInBrowser === next.onOpenInBrowser &&
    previous.onOpenMedia === next.onOpenMedia &&
    previous.onOpenFile === next.onOpenFile &&
    previous.onOpenParentFolder === next.onOpenParentFolder &&
    previous.resolveCopyPaths === next.resolveCopyPaths
  );
}
