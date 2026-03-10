import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  GitPullRequestIcon,
  PlusIcon,
  RocketIcon,
  SparklesIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  XIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_MODEL_BY_PROVIDER,
  type DesktopUpdateState,
  ProjectId,
  ThreadId,
  type GitStatusResult,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useAppSettings } from "../appSettings";
import { isElectron } from "../env";
import { APP_STAGE_LABEL } from "../branding";
import { buildLocalDraftThread, hasDraftThreadContent } from "../draftThreads";
import { copyTextToClipboard } from "../lib/clipboard";
import { newCommandId, newProjectId, newThreadId } from "../lib/utils";
import {
  DEFAULT_SIDEBAR_THREAD_SORT,
  SIDEBAR_THREAD_SORT_OPTIONS,
} from "../sidebarThreadSort";
import { useStore } from "../store";
import { isChatNewLocalShortcut, isChatNewShortcut, shortcutLabelForCommand } from "../keybindings";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import { gitRemoveWorktreeMutationOptions, gitStatusQueryOptions } from "../lib/gitReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { useThreadRunStateStore } from "../threadRunStateStore";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { toastManager } from "./ui/toast";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldHighlightDesktopUpdateError,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
} from "./ui/sidebar";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import {
  deriveThreadStatusPill,
  filterSidebarThreads,
  getThreadLatestActivityAt,
  sortSidebarThreads,
} from "./Sidebar.logic";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { isNonEmpty as isNonEmptyString } from "effect/String";
import { MobileContextMenu, type MobileContextMenuItem } from "./MobileContextMenu";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const THREAD_PREVIEW_LIMIT = 6;
const DRAFT_THREAD_LABEL_CLASS_NAME =
  "inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-medium text-[10px] text-amber-700 dark:text-amber-300";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface TerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

interface PrStatusIndicator {
  label: "PR open" | "PR closed" | "PR merged";
  colorClass: string;
  tooltip: string;
  url: string;
}

type ThreadPr = GitStatusResult["pr"];

function terminalStatusFromRunningIds(
  runningTerminalIds: string[],
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null;
  }
  return {
    label: "Terminal process running",
    colorClass: "text-teal-600 dark:text-teal-300/90",
    pulse: true,
  };
}

function prStatusIndicator(pr: ThreadPr): PrStatusIndicator | null {
  if (!pr) return null;

  if (pr.state === "open") {
    return {
      label: "PR open",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${pr.number} PR open: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${pr.number} PR closed: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "merged") {
    return {
      label: "PR merged",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${pr.number} PR merged: ${pr.title}`,
      url: pr.url,
    };
  }
  return null;
}

function T3Wordmark() {
  return (
    <svg
      aria-label="T3"
      className="h-2.5 w-auto shrink-0 text-foreground"
      viewBox="15.5309 37 94.3941 56.96"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Derives the server's HTTP origin (scheme + host + port) from the same
 * sources WsTransport uses, converting ws(s) to http(s).
 */
function getServerHttpOrigin(): string {
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsUrl =
    bridgeUrl && bridgeUrl.length > 0
      ? bridgeUrl
      : envUrl && envUrl.length > 0
        ? envUrl
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`;
  // Parse to extract just the origin, dropping path/query (e.g. ?token=…)
  const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}

const serverHttpOrigin = getServerHttpOrigin();

function ProjectFavicon({ cwd }: { cwd: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  const src = `${serverHttpOrigin}/api/project-favicon?cwd=${encodeURIComponent(cwd)}`;

  if (status === "error") {
    return <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/50" />;
  }

  return (
    <img
      src={src}
      alt=""
      className={`size-3.5 shrink-0 rounded-sm object-contain ${status === "loading" ? "hidden" : ""}`}
      onLoad={() => setStatus("loaded")}
      onError={() => setStatus("error")}
    />
  );
}

export default function Sidebar() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const markThreadUnread = useStore((store) => store.markThreadUnread);
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const toggleProject = useStore((store) => store.toggleProject);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearThreadDraft);
  const draftsByThreadId = useComposerDraftStore((store) => store.draftsByThreadId);
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const pendingRunByThreadId = useThreadRunStateStore((state) => state.pendingRunByThreadId);
  const clearPendingRun = useThreadRunStateStore((state) => state.clearPendingRun);
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const navigate = useNavigate();
  const isOnSettings = useLocation({ select: (loc) => loc.pathname === "/settings" });
  const { settings: appSettings, updateSettings } = useAppSettings();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const [addingProject, setAddingProject] = useState(false);
  const [newCwd, setNewCwd] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [autoRenamingProjectId, setAutoRenamingProjectId] = useState<ProjectId | null>(null);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const addProjectInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set());
  const [threadSearchByProject, setThreadSearchByProject] = useState<
    ReadonlyMap<ProjectId, string>
  >(() => new Map());
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);

  // Mobile context menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileMenuThreadId, setMobileMenuThreadId] = useState<ThreadId | null>(null);
  const [mobileMenuPosition, setMobileMenuPosition] = useState({ x: 0, y: 0 });
  const [mobileMenuProjectId, setMobileMenuProjectId] = useState<ProjectId | null>(null);

  const shouldBrowseForProjectImmediately = isElectron;
  const shouldShowProjectPathEntry = addingProject && !shouldBrowseForProjectImmediately;
  const pendingApprovalByThreadId = useMemo(() => {
    const map = new Map<ThreadId, boolean>();
    for (const thread of threads) {
      map.set(thread.id, derivePendingApprovals(thread.activities).length > 0);
    }
    return map;
  }, [threads]);
  const pendingUserInputByThreadId = useMemo(() => {
    const map = new Map<ThreadId, boolean>();
    for (const thread of threads) {
      map.set(thread.id, derivePendingUserInputs(thread.activities).length > 0);
    }
    return map;
  }, [threads]);
  const projectModelById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.model] as const)),
    [projects],
  );
  const serverThreadIdSet = useMemo(() => new Set(threads.map((thread) => thread.id)), [threads]);
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const draftThreads = useMemo(
    () =>
      (Object.entries(draftThreadsByThreadId) as [ThreadId, DraftThreadState][])
        .flatMap(([threadId, draftThread]) => {
          if (serverThreadIdSet.has(threadId)) {
            return [];
          }
          const fallbackModel = projectModelById.get(draftThread.projectId);
          if (!fallbackModel) {
            return [];
          }
          return [
            buildLocalDraftThread({
              threadId,
              draftThread,
              fallbackModel,
              composerDraft: draftsByThreadId[threadId],
              error: null,
            }),
          ];
        }),
    [draftThreadsByThreadId, draftsByThreadId, projectModelById, serverThreadIdSet],
  );
  const sidebarThreads = useMemo(() => [...threads, ...draftThreads], [draftThreads, threads]);
  const sidebarThreadById = useMemo(
    () => new Map(sidebarThreads.map((thread) => [thread.id, thread] as const)),
    [sidebarThreads],
  );
  const draftThreadIdSet = useMemo(
    () => new Set(draftThreads.map((thread) => thread.id)),
    [draftThreads],
  );
  const threadGitTargets = useMemo(
    () =>
      sidebarThreads.map((thread) => ({
        threadId: thread.id,
        branch: thread.branch,
        cwd: thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null,
      })),
    [projectCwdById, sidebarThreads],
  );
  const threadGitStatusCwds = useMemo(
    () => [
      ...new Set(
        threadGitTargets
          .filter((target) => target.branch !== null)
          .map((target) => target.cwd)
          .filter((cwd): cwd is string => cwd !== null),
      ),
    ],
    [threadGitTargets],
  );
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusCwds.map((cwd) => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const prByThreadId = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < threadGitStatusCwds.length; index += 1) {
      const cwd = threadGitStatusCwds[index];
      if (!cwd) continue;
      const status = threadGitStatusQueries[index]?.data;
      if (status) {
        statusByCwd.set(cwd, status);
      }
    }

    const map = new Map<ThreadId, ThreadPr>();
    for (const target of threadGitTargets) {
      const status = target.cwd ? statusByCwd.get(target.cwd) : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      map.set(target.threadId, branchMatches ? (status?.pr ?? null) : null);
    }
    return map;
  }, [threadGitStatusCwds, threadGitStatusQueries, threadGitTargets]);

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => {
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async () => {
        setProjectDraftThreadId(projectId, threadId, {
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });

        await navigate({
          to: "/$threadId",
          params: { threadId },
        });
      })();
    },
    [navigate, setProjectDraftThreadId],
  );

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId) => {
      const latestThread = sidebarThreads
        .filter((thread) => thread.projectId === projectId)
        .toSorted((a, b) => {
          const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          if (byDate !== 0) return byDate;
          return b.id.localeCompare(a.id);
        })[0];
      if (!latestThread) return;

      void navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
    },
    [navigate, sidebarThreads],
  );

  const addProjectFromPath = useCallback(
    async (rawCwd: string) => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return;
      const api = readNativeApi();
      if (!api) return;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setNewCwd("");
        setAddProjectError(null);
        setAddingProject(false);
      };

      const existing = projects.find((project) => project.cwd === cwd);
      if (existing) {
        focusMostRecentThreadForProject(existing.id);
        finishAddingProject();
        return;
      }

      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;
      try {
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
          createdAt,
        });
        await handleNewThread(projectId).catch(() => undefined);
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "An error occurred while adding the project.";
        setIsAddingProject(false);
        if (shouldBrowseForProjectImmediately) {
          toastManager.add({
            type: "error",
            title: "Failed to add project",
            description,
          });
        } else {
          setAddProjectError(description);
        }
        return;
      }
      finishAddingProject();
    },
    [
      focusMostRecentThreadForProject,
      handleNewThread,
      isAddingProject,
      projects,
      shouldBrowseForProjectImmediately,
    ],
  );

  const handleAddProject = () => {
    void addProjectFromPath(newCwd);
  };

  const handlePickFolder = async () => {
    const api = readNativeApi();
    if (!api || isPickingFolder) return;
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder();
    } catch {
      // Ignore picker failures and leave the current thread selection unchanged.
    }
    if (pickedPath) {
      await addProjectFromPath(pickedPath);
    } else if (!shouldBrowseForProjectImmediately) {
      addProjectInputRef.current?.focus();
    }
    setIsPickingFolder(false);
  };

  const handleAutorenameProjectThreads = useCallback(
    async (projectId: ProjectId, projectName: string) => {
      if (autoRenamingProjectId === projectId) return;

      const api = readNativeApi();
      if (!api) return;

      setAutoRenamingProjectId(projectId);
      try {
        const result = await api.orchestration.autorenameProjectThreads({ projectId });
        const renamedCount = result.renamed.length;
        const failedCount = result.failed.length;

        if (renamedCount > 0) {
          toastManager.add({
            type: failedCount > 0 ? "warning" : "success",
            title: renamedCount === 1 ? "Renamed 1 thread" : `Renamed ${renamedCount} threads`,
            description:
              failedCount > 0
                ? `${failedCount} thread${failedCount === 1 ? "" : "s"} failed to rename.`
                : `Updated titles in ${projectName}.`,
          });
          return;
        }

        if (failedCount > 0) {
          toastManager.add({
            type: "error",
            title: "Could not rename threads",
            description: result.failed[0]?.message ?? "An error occurred.",
          });
          return;
        }

        toastManager.add({
          type: "info",
          title: "No titles changed",
          description: `No thread titles needed updating in ${projectName}.`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not rename threads",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      } finally {
        setAutoRenamingProjectId((current) => (current === projectId ? null : current));
      }
    },
    [autoRenamingProjectId],
  );
  const handleStartAddProject = () => {
    setAddProjectError(null);
    if (shouldBrowseForProjectImmediately) {
      void handlePickFolder();
      return;
    }
    setAddingProject((prev) => !prev);
  };

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  // ── Context menu action handlers (shared by native right-click + mobile long-press) ──
  const handleThreadContextMenuAction = useCallback(
    async (threadId: ThreadId, clicked: string | null) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = sidebarThreadById.get(threadId);
      if (!thread) return;
      const isDraftThread = draftThreadIdSet.has(threadId);

      if (clicked === "rename" && !isDraftThread) {
        setRenamingThreadId(threadId);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread" && !isDraftThread) {
        markThreadUnread(threadId);
        return;
      }
      if (clicked === "copy-thread-id") {
        try {
          await copyTextToClipboard(threadId);
          toastManager.add({
            type: "success",
            title: "Thread ID copied",
            description: threadId,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to copy thread ID",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      if (clicked === "force-delete" && !isDraftThread) {
        const confirmed = await api.dialogs.confirm(
          [
            `Force delete thread "${thread.title}"?`,
            "This hard-deletes the thread record, messages, attachments, and checkpoints from local app state.",
            "It does not delete your code or worktree files.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }

        const shouldNavigateToFallback = routeThreadId === threadId;
        const fallbackThreadId = sidebarThreads.find((entry) => entry.id !== threadId)?.id ?? null;

        try {
          await api.terminal.close({
            threadId,
            deleteHistory: true,
          });
        } catch {
          // Terminal may already be closed
        }

        try {
          const snapshot = await api.orchestration.forceDeleteThread({ threadId });
          syncServerReadModel(snapshot);
          clearComposerDraftForThread(threadId);
          clearProjectDraftThreadById(thread.projectId, thread.id);
          clearPendingRun(threadId);
          clearTerminalState(threadId);
          if (shouldNavigateToFallback) {
            if (fallbackThreadId) {
              void navigate({
                to: "/$threadId",
                params: { threadId: fallbackThreadId },
                replace: true,
              });
            } else {
              void navigate({ to: "/", replace: true });
            }
          }
          toastManager.add({
            type: "success",
            title: "Thread force deleted",
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to force delete thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }

      if (clicked !== "delete") return;
      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          isDraftThread
            ? [
                `Delete draft "${thread.title}"?`,
                "This removes the unsent draft for this thread.",
              ].join("\n")
            : [
                `Delete thread "${thread.title}"?`,
                "This permanently clears conversation history for this thread.",
              ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      const shouldNavigateToFallback = routeThreadId === threadId;
      const fallbackThreadId = sidebarThreads.find((entry) => entry.id !== threadId)?.id ?? null;

      if (isDraftThread) {
        try {
          await api.terminal.close({
            threadId,
            deleteHistory: true,
          });
        } catch {
          // Terminal may already be closed
        }
        clearComposerDraftForThread(threadId);
        clearTerminalState(threadId);
        if (shouldNavigateToFallback) {
          if (fallbackThreadId) {
            void navigate({
              to: "/$threadId",
              params: { threadId: fallbackThreadId },
              replace: true,
            });
          } else {
            void navigate({ to: "/", replace: true });
          }
        }
        return;
      }

      const threadProject = projects.find((project) => project.id === thread.projectId);
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(threads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
      const shouldDeleteWorktree =
        canDeleteWorktree &&
        (await api.dialogs.confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      try {
        await api.terminal.close({
          threadId,
          deleteHistory: true,
        });
      } catch {
        // Terminal may already be closed
      }

      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId,
      });
      clearComposerDraftForThread(threadId);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      clearPendingRun(threadId);
      clearTerminalState(threadId);
      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: fallbackThreadId },
            replace: true,
          });
        } else {
          void navigate({ to: "/", replace: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return;
      }

      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }
    },
    [
      appSettings.confirmThreadDelete,
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearPendingRun,
      clearTerminalState,
      markThreadUnread,
      navigate,
      projects,
      removeWorktreeMutation,
      routeThreadId,
      sidebarThreadById,
      sidebarThreads,
      syncServerReadModel,
      draftThreadIdSet,
      threads,
    ],
  );

  // Extracted action handler from handleProjectContextMenu so mobile menu can reuse it
  const handleProjectContextMenuAction = useCallback(
    async (projectId: ProjectId, clicked: string | null) => {
      const api = readNativeApi();
      if (!api) return;
      if (clicked !== "delete") return;

      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;

      const projectThreads = sidebarThreads.filter((thread) => thread.projectId === projectId);
      if (projectThreads.length > 0) {
        toastManager.add({
          type: "warning",
          title: "Project is not empty",
          description: "Delete all threads and drafts in this project before deleting it.",
        });
        return;
      }

      const confirmed = await api.dialogs.confirm(
        [`Delete project "${project.name}"?`, "This action cannot be undone."].join("\n"),
      );
      if (!confirmed) return;

      try {
        clearProjectDraftThreadId(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error deleting project.";
        console.error("Failed to remove project", { projectId, error });
        toastManager.add({
          type: "error",
          title: `Failed to delete "${project.name}"`,
          description: message,
        });
      }
    },
    [
      clearProjectDraftThreadId,
      projects,
      sidebarThreads,
    ],
  );

  // ── Native (right-click) context menu handlers ──────────────────────
  const handleThreadContextMenu = useCallback(
    async (threadId: ThreadId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = sidebarThreadById.get(threadId);
      if (!thread) return;
      const isDraftThread = draftThreadIdSet.has(threadId);
      const clicked = await api.contextMenu.show(
        isDraftThread
          ? [
              { id: "copy-thread-id", label: "Copy Thread ID" },
              { id: "delete", label: "Delete draft", destructive: true },
            ]
          : [
              { id: "rename", label: "Rename thread" },
              { id: "mark-unread", label: "Mark unread" },
              { id: "copy-thread-id", label: "Copy Thread ID" },
              { id: "delete", label: "Delete", destructive: true },
              { id: "force-delete", label: "Force delete", destructive: true },
            ],
        position,
      );
      await handleThreadContextMenuAction(threadId, clicked);
    },
    [sidebarThreadById, draftThreadIdSet, handleThreadContextMenuAction],
  );

  const handleProjectContextMenu = useCallback(
    async (projectId: ProjectId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [{ id: "delete", label: "Delete", destructive: true }],
        position,
      );
      await handleProjectContextMenuAction(projectId, clicked);
    },
    [handleProjectContextMenuAction],
  );

  // ── Mobile context menu helpers (long-press) ──────────────────────
  const openMobileThreadMenu = useCallback(
    (threadId: ThreadId, position: { x: number; y: number }) => {
      setMobileMenuThreadId(threadId);
      setMobileMenuProjectId(null);
      setMobileMenuPosition(position);
      setMobileMenuOpen(true);
    },
    [],
  );

  const openMobileProjectMenu = useCallback(
    (projectId: ProjectId, position: { x: number; y: number }) => {
      setMobileMenuProjectId(projectId);
      setMobileMenuThreadId(null);
      setMobileMenuPosition(position);
      setMobileMenuOpen(true);
    },
    [],
  );

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
    setMobileMenuThreadId(null);
    setMobileMenuProjectId(null);
  }, []);

  const handleMobileMenuSelect = useCallback(
    (id: string) => {
      closeMobileMenu();
      if (mobileMenuThreadId) {
        void handleThreadContextMenuAction(mobileMenuThreadId, id);
      } else if (mobileMenuProjectId) {
        void handleProjectContextMenuAction(mobileMenuProjectId, id);
      }
    },
    [closeMobileMenu, mobileMenuThreadId, mobileMenuProjectId, handleThreadContextMenuAction, handleProjectContextMenuAction],
  );

  // Derive mobile menu items based on what's selected
  const mobileMenuItems: MobileContextMenuItem[] = useMemo(() => {
    if (mobileMenuThreadId) {
      const isDraft = draftThreadIdSet.has(mobileMenuThreadId);
      if (isDraft) {
        return [
          { id: "copy-thread-id", label: "Copy Thread ID" },
          { id: "delete", label: "Delete draft", destructive: true },
        ];
      }
      return [
        { id: "rename", label: "Rename thread" },
        { id: "mark-unread", label: "Mark unread" },
        { id: "copy-thread-id", label: "Copy Thread ID" },
        { id: "delete", label: "Delete", destructive: true },
        { id: "force-delete", label: "Force delete", destructive: true },
      ];
    }
    if (mobileMenuProjectId) {
      return [{ id: "delete", label: "Delete project", destructive: true }];
    }
    return [];
  }, [mobileMenuThreadId, mobileMenuProjectId, draftThreadIdSet]);

  const mobileMenuTitle = useMemo(() => {
    if (mobileMenuThreadId) {
      const thread = sidebarThreadById.get(mobileMenuThreadId);
      return thread?.title ?? "Thread";
    }
    if (mobileMenuProjectId) {
      const project = projects.find((p) => p.id === mobileMenuProjectId);
      return project?.name ?? "Project";
    }
    return undefined;
  }, [mobileMenuThreadId, mobileMenuProjectId, sidebarThreadById, projects]);

  // Long press state for mobile context menu (shared across all thread/project items)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const makeThreadTouchHandlers = useCallback(
    (threadId: ThreadId) => ({
      onTouchStart: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        longPressStartRef.current = { x: touch.clientX, y: touch.clientY };
        longPressFiredRef.current = false;
        clearLongPress();
        longPressTimerRef.current = setTimeout(() => {
          longPressFiredRef.current = true;
          openMobileThreadMenu(threadId, { x: touch.clientX, y: touch.clientY });
        }, 500);
      },
      onTouchMove: (e: React.TouchEvent) => {
        if (!longPressStartRef.current) return;
        const touch = e.touches[0];
        if (!touch) return;
        const dx = touch.clientX - longPressStartRef.current.x;
        const dy = touch.clientY - longPressStartRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) clearLongPress();
      },
      onTouchEnd: (e: React.TouchEvent) => {
        clearLongPress();
        if (longPressFiredRef.current) {
          e.preventDefault();
          longPressFiredRef.current = false;
        }
      },
      onTouchCancel: () => {
        clearLongPress();
        longPressFiredRef.current = false;
      },
    }),
    [clearLongPress, openMobileThreadMenu],
  );

  const makeProjectTouchHandlers = useCallback(
    (projectId: ProjectId) => ({
      onTouchStart: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        longPressStartRef.current = { x: touch.clientX, y: touch.clientY };
        longPressFiredRef.current = false;
        clearLongPress();
        longPressTimerRef.current = setTimeout(() => {
          longPressFiredRef.current = true;
          openMobileProjectMenu(projectId, { x: touch.clientX, y: touch.clientY });
        }, 500);
      },
      onTouchMove: (e: React.TouchEvent) => {
        if (!longPressStartRef.current) return;
        const touch = e.touches[0];
        if (!touch) return;
        const dx = touch.clientX - longPressStartRef.current.x;
        const dy = touch.clientY - longPressStartRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) clearLongPress();
      },
      onTouchEnd: (e: React.TouchEvent) => {
        clearLongPress();
        if (longPressFiredRef.current) {
          e.preventDefault();
          longPressFiredRef.current = false;
        }
      },
      onTouchCancel: () => {
        clearLongPress();
        longPressFiredRef.current = false;
      },
    }),
    [clearLongPress, openMobileProjectMenu],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const activeThread = routeThreadId
        ? threads.find((thread) => thread.id === routeThreadId)
        : undefined;
      const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;
      if (isChatNewLocalShortcut(event, keybindings)) {
        const projectId =
          activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
        if (!projectId) return;
        event.preventDefault();
        void handleNewThread(projectId);
        return;
      }

      if (!isChatNewShortcut(event, keybindings)) return;
      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
      if (!projectId) return;
      event.preventDefault();
      void handleNewThread(projectId, {
        branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
        worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
        envMode: activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
      });
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [getDraftThread, handleNewThread, keybindings, projects, routeThreadId, threads]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);

  const desktopUpdateTooltip = desktopUpdateState
    ? getDesktopUpdateButtonTooltip(desktopUpdateState)
    : "Update available";

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const desktopUpdateButtonInteractivityClasses = desktopUpdateButtonDisabled
    ? "cursor-not-allowed opacity-60"
    : "hover:bg-accent hover:text-foreground";
  const desktopUpdateButtonClasses =
    desktopUpdateState?.status === "downloaded"
      ? "text-emerald-500"
      : desktopUpdateState?.status === "downloading"
        ? "text-sky-400"
        : shouldHighlightDesktopUpdateError(desktopUpdateState)
          ? "text-rose-500 animate-pulse"
          : "text-amber-500 animate-pulse";
  const newThreadShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(keybindings, "chat.newLocal") ??
      shortcutLabelForCommand(keybindings, "chat.new"),
    [keybindings],
  );
  const threadSort = appSettings.sidebarThreadSort ?? DEFAULT_SIDEBAR_THREAD_SORT;

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);

  const setProjectThreadSearch = useCallback((projectId: ProjectId, value: string) => {
    setThreadSearchByProject((current) => {
      const next = new Map(current);
      if (value.length === 0) {
        next.delete(projectId);
      } else {
        next.set(projectId, value);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const activeProjectIds = new Set(projects.map((project) => project.id));
    setThreadSearchByProject((current) => {
      let changed = false;
      const next = new Map<ProjectId, string>();
      for (const [projectId, search] of current) {
        if (!activeProjectIds.has(projectId)) {
          changed = true;
          continue;
        }
        next.set(projectId, search);
      }
      return changed ? next : current;
    });
  }, [projects]);

  const wordmark = (
    <div className="flex items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <div className="flex min-w-0 flex-1 items-center gap-1 mt-1.5 ml-1">
        <T3Wordmark />
        <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
          Code
        </span>
        <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
          {APP_STAGE_LABEL}
        </span>
      </div>
    </div>
  );

  return (
    <>
      {isElectron ? (
        <>
          <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px]">
            {wordmark}
            {showDesktopUpdateButton && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={desktopUpdateTooltip}
                      aria-disabled={desktopUpdateButtonDisabled || undefined}
                      disabled={desktopUpdateButtonDisabled}
                      className={`inline-flex size-7 ml-auto mt-1.5 items-center justify-center rounded-md text-muted-foreground transition-colors ${desktopUpdateButtonInteractivityClasses} ${desktopUpdateButtonClasses}`}
                      onClick={handleDesktopUpdateButtonClick}
                    >
                      <RocketIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup side="bottom">{desktopUpdateTooltip}</TooltipPopup>
              </Tooltip>
            )}
          </SidebarHeader>
        </>
      ) : (
        <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">
          {wordmark}
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0">
        {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
          <SidebarGroup className="px-2 pt-2 pb-0">
            <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
              <TriangleAlertIcon />
              <AlertTitle>Intel build on Apple Silicon</AlertTitle>
              <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
              {desktopUpdateButtonAction !== "none" ? (
                <AlertAction>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={desktopUpdateButtonDisabled}
                    onClick={handleDesktopUpdateButtonClick}
                  >
                    {desktopUpdateButtonAction === "download"
                      ? "Download ARM build"
                      : "Install ARM build"}
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          </SidebarGroup>
        ) : null}
        <SidebarGroup className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Projects
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Add project"
                    aria-pressed={shouldShowProjectPathEntry}
                    className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    onClick={handleStartAddProject}
                  />
                }
              >
                <PlusIcon
                  className={`size-3.5 transition-transform duration-150 ${
                    shouldShowProjectPathEntry ? "rotate-45" : "rotate-0"
                  }`}
                />
              </TooltipTrigger>
              <TooltipPopup side="right">Add project</TooltipPopup>
            </Tooltip>
          </div>

          {shouldShowProjectPathEntry && (
            <div className="mb-2 px-1">
              {isElectron && (
                <button
                  type="button"
                  className="mb-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary py-1.5 text-xs text-foreground/80 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void handlePickFolder()}
                  disabled={isPickingFolder || isAddingProject}
                >
                  <FolderIcon className="size-3.5" />
                  {isPickingFolder ? "Picking folder..." : "Browse for folder"}
                </button>
              )}
              <div className="flex gap-1.5">
                <input
                  ref={addProjectInputRef}
                  className={`min-w-0 flex-1 rounded-md border bg-secondary px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none ${
                    addProjectError
                      ? "border-red-500/70 focus:border-red-500"
                      : "border-border focus:border-ring"
                  }`}
                  placeholder="/path/to/project"
                  value={newCwd}
                  onChange={(event) => {
                    setNewCwd(event.target.value);
                    setAddProjectError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleAddProject();
                    if (event.key === "Escape") {
                      setAddingProject(false);
                      setAddProjectError(null);
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60"
                  onClick={handleAddProject}
                  disabled={isAddingProject}
                >
                  {isAddingProject ? "Adding..." : "Add"}
                </button>
              </div>
              {addProjectError && (
                <p className="mt-1 px-0.5 text-[11px] leading-tight text-red-400">
                  {addProjectError}
                </p>
              )}
              <div className="mt-1.5 px-0.5">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  onClick={() => {
                    setAddingProject(false);
                    setAddProjectError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {projects.length > 0 && (
            <div className="px-1 pb-2">
              <label className="block space-y-1">
                <span className="px-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                  Thread sort
                </span>
                <Select
                  items={SIDEBAR_THREAD_SORT_OPTIONS.map((option) => ({
                    label: option.label,
                    value: option.value,
                  }))}
                  value={threadSort}
                  onValueChange={(value) => {
                    if (!value) return;
                    updateSettings({ sidebarThreadSort: value });
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    variant="ghost"
                    className="h-7 w-full rounded-md px-2 text-xs text-muted-foreground/80 hover:text-foreground"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {SIDEBAR_THREAD_SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{option.label}</span>
                          <span className="truncate text-[10px] text-muted-foreground/70">
                            {option.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
            </div>
          )}
          <SidebarMenu>
            {projects.map((project) => {
              const projectThreadSearch = threadSearchByProject.get(project.id) ?? "";
              const hasActiveThreadSearch = projectThreadSearch.trim().length > 0;
              const allProjectThreads = sidebarThreads.filter((thread) => thread.projectId === project.id);
              const showThreadSearch = allProjectThreads.length >= THREAD_PREVIEW_LIMIT;
              const filteredProjectThreads = filterSidebarThreads(
                allProjectThreads,
                projectThreadSearch,
              );
              const projectThreads = sortSidebarThreads(
                filteredProjectThreads,
                {
                  sortBy: threadSort,
                  hasPendingApprovalsByThreadId: pendingApprovalByThreadId,
                  hasPendingUserInputByThreadId: pendingUserInputByThreadId,
                },
              );
              const isThreadListExpanded = expandedThreadListsByProject.has(project.id);
              const hasHiddenThreads =
                !hasActiveThreadSearch && projectThreads.length > THREAD_PREVIEW_LIMIT;
              const isAutoRenamingProject = autoRenamingProjectId === project.id;
              const visibleThreads =
                hasHiddenThreads && !isThreadListExpanded
                  ? projectThreads.slice(0, THREAD_PREVIEW_LIMIT)
                  : projectThreads;

              return (
                <Collapsible
                  key={project.id}
                  className="group/collapsible"
                  open={project.expanded}
                  onOpenChange={(open) => {
                    if (open === project.expanded) return;
                    toggleProject(project.id);
                  }}
                >
                  <SidebarMenuItem>
                    <div className="group/project-header relative">
                      <CollapsibleTrigger
                        render={
                          <SidebarMenuButton
                            size="sm"
                            className="gap-2 px-2 py-1.5 pr-12 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground"
                          />
                        }
                        onContextMenu={(event) => {
                          event.preventDefault();
                          void handleProjectContextMenu(project.id, {
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                        {...makeProjectTouchHandlers(project.id)}
                      >
                        <ChevronRightIcon
                          className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                            project.expanded ? "rotate-90" : ""
                          }`}
                        />
                        <ProjectFavicon cwd={project.cwd} />
                        <span className="flex-1 truncate text-xs font-medium text-foreground/90">
                          {project.name}
                        </span>
                      </CollapsibleTrigger>
                      <div className="absolute top-1 right-1 flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label={`Auto-rename threads in ${project.name}`}
                                className="inline-flex size-5 items-center justify-center rounded-md p-0 text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={isAutoRenamingProject || projectThreads.length === 0}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void handleAutorenameProjectThreads(project.id, project.name);
                                }}
                              >
                                <SparklesIcon
                                  className={`size-3.5 ${isAutoRenamingProject ? "animate-pulse" : ""}`}
                                />
                              </button>
                            }
                          />
                          <TooltipPopup side="top">
                            {isAutoRenamingProject
                              ? "Renaming thread titles..."
                              : "Magic rename thread titles"}
                          </TooltipPopup>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label={`Create new thread in ${project.name}`}
                                className="inline-flex size-5 items-center justify-center rounded-md p-0 text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void handleNewThread(project.id);
                                }}
                              >
                                <SquarePenIcon className="size-3.5" />
                              </button>
                            }
                          />
                          <TooltipPopup side="top">
                            {newThreadShortcutLabel
                              ? `New thread (${newThreadShortcutLabel})`
                              : "New thread"}
                          </TooltipPopup>
                        </Tooltip>
                      </div>
                    </div>

                    <CollapsibleContent>
                      <SidebarMenuSub className="mx-1 my-0 translate-x-0 gap-0 px-1.5 py-0">
                        {showThreadSearch && (
                          <SidebarMenuSubItem className="w-full">
                            <div className="px-2 py-1.5">
                              <InputGroup className="overflow-visible rounded-md border-border bg-background/70 shadow-none dark:bg-background/20">
                                <InputGroupInput
                                  type="search"
                                  size="sm"
                                  value={projectThreadSearch}
                                  placeholder="Search threads"
                                  aria-label={`Search threads in ${project.name}`}
                                  className="text-xs placeholder:text-muted-foreground/55"
                                  onChange={(event) => {
                                    setProjectThreadSearch(project.id, event.target.value);
                                  }}
                                  onKeyDown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === "Escape" && projectThreadSearch.length > 0) {
                                      event.preventDefault();
                                      setProjectThreadSearch(project.id, "");
                                    }
                                  }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                  }}
                                />
                                {hasActiveThreadSearch ? (
                                  <InputGroupAddon
                                    align="inline-end"
                                    className="pe-2.5 [&>button]:me-0"
                                  >
                                    <button
                                      type="button"
                                      aria-label={`Clear thread search in ${project.name}`}
                                      className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/50 transition-colors hover:text-foreground"
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                      }}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setProjectThreadSearch(project.id, "");
                                      }}
                                    >
                                      <XIcon className="size-3.5" />
                                    </button>
                                  </InputGroupAddon>
                                ) : null}
                              </InputGroup>
                            </div>
                          </SidebarMenuSubItem>
                        )}
                        {visibleThreads.map((thread) => {
                          const isActive = routeThreadId === thread.id;
                          const pendingRun = pendingRunByThreadId[thread.id] ?? null;
                          const threadStatus = deriveThreadStatusPill({
                            thread,
                            hasPendingApprovals: pendingApprovalByThreadId.get(thread.id) === true,
                            hasPendingUserInput: pendingUserInputByThreadId.get(thread.id) === true,
                            pendingRunPhase: pendingRun?.phase ?? null,
                          });
                          const isDraftThread =
                            draftThreadIdSet.has(thread.id) ||
                            hasDraftThreadContent(draftsByThreadId[thread.id]);
                          const prStatus = prStatusIndicator(prByThreadId.get(thread.id) ?? null);
                          const terminalStatus = terminalStatusFromRunningIds(
                            selectThreadTerminalState(terminalStateByThreadId, thread.id)
                              .runningTerminalIds,
                          );
                          const threadTimestamp =
                            threadSort === "activity"
                              ? getThreadLatestActivityAt(thread)
                              : thread.createdAt;
                          const threadTimestampTitle =
                            threadSort === "activity" ? "Last activity" : "Created";

                          return (
                            <SidebarMenuSubItem key={thread.id} className="w-full">
                              <SidebarMenuSubButton
                                render={<div role="button" tabIndex={0} />}
                                size="sm"
                                isActive={isActive}
                                className={`h-7 w-full translate-x-0 cursor-default justify-start px-2 text-left hover:bg-accent hover:text-foreground ${
                                  isActive
                                    ? "bg-accent/85 text-foreground font-medium ring-1 ring-border/70 dark:bg-accent/55 dark:ring-border/50"
                                    : "text-muted-foreground"
                                }`}
                                onClick={() => {
                                  void navigate({
                                    to: "/$threadId",
                                    params: { threadId: thread.id },
                                  });
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" && event.key !== " ") return;
                                  event.preventDefault();
                                  void navigate({
                                    to: "/$threadId",
                                    params: { threadId: thread.id },
                                  });
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  void handleThreadContextMenu(thread.id, {
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                                }}
                                {...makeThreadTouchHandlers(thread.id)}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                                  {prStatus && (
                                    <Tooltip>
                                      <TooltipTrigger
                                        render={
                                          <button
                                            type="button"
                                            aria-label={prStatus.tooltip}
                                            className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                                            onClick={(event) => {
                                              openPrLink(event, prStatus.url);
                                            }}
                                          >
                                            <GitPullRequestIcon className="size-3" />
                                          </button>
                                        }
                                      />
                                      <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
                                    </Tooltip>
                                  )}
                                  {threadStatus && (
                                    <span
                                      className={`inline-flex items-center gap-1 text-[10px] ${threadStatus.colorClass}`}
                                    >
                                      <span
                                        className={`h-1.5 w-1.5 rounded-full ${threadStatus.dotClass} ${
                                          threadStatus.pulse ? "animate-pulse" : ""
                                        }`}
                                      />
                                      <span className="hidden md:inline">{threadStatus.label}</span>
                                    </span>
                                  )}
                                  {isDraftThread && (
                                    <span className={DRAFT_THREAD_LABEL_CLASS_NAME}>Draft</span>
                                  )}
                                  {renamingThreadId === thread.id ? (
                                    <input
                                      ref={(el) => {
                                        if (el && renamingInputRef.current !== el) {
                                          renamingInputRef.current = el;
                                          el.focus();
                                          el.select();
                                        }
                                      }}
                                      className="min-w-0 flex-1 truncate text-xs bg-transparent outline-none border border-ring rounded px-0.5"
                                      value={renamingTitle}
                                      onChange={(e) => setRenamingTitle(e.target.value)}
                                      onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          renamingCommittedRef.current = true;
                                          void commitRename(thread.id, renamingTitle, thread.title);
                                        } else if (e.key === "Escape") {
                                          e.preventDefault();
                                          renamingCommittedRef.current = true;
                                          cancelRename();
                                        }
                                      }}
                                      onBlur={() => {
                                        if (!renamingCommittedRef.current) {
                                          void commitRename(thread.id, renamingTitle, thread.title);
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  ) : (
                                    <span className="min-w-0 flex-1 truncate text-xs">
                                      {thread.title}
                                    </span>
                                  )}
                                </div>
                                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                  {terminalStatus && (
                                    <span
                                      role="img"
                                      aria-label={terminalStatus.label}
                                      title={terminalStatus.label}
                                      className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
                                    >
                                      <TerminalIcon
                                        className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`}
                                      />
                                    </span>
                                  )}
                                  <span
                                    className={`text-[10px] ${
                                      isActive ? "text-foreground/65" : "text-muted-foreground/40"
                                    }`}
                                    title={`${threadTimestampTitle} ${formatRelativeTime(threadTimestamp)}`}
                                  >
                                    {formatRelativeTime(threadTimestamp)}
                                  </span>
                                </div>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}

                        {hasActiveThreadSearch && projectThreads.length === 0 && (
                          <SidebarMenuSubItem className="w-full">
                            <div className="px-2 py-1.5 text-[10px] text-muted-foreground/60">
                              No matching threads
                            </div>
                          </SidebarMenuSubItem>
                        )}

                        {hasHiddenThreads && !isThreadListExpanded && (
                          <SidebarMenuSubItem className="w-full">
                            <SidebarMenuSubButton
                              render={<button type="button" />}
                              size="sm"
                              className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                              onClick={() => {
                                expandThreadListForProject(project.id);
                              }}
                            >
                              <span>Show more</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )}
                        {hasHiddenThreads && isThreadListExpanded && (
                          <SidebarMenuSubItem className="w-full">
                            <SidebarMenuSubButton
                              render={<button type="button" />}
                              size="sm"
                              className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                              onClick={() => {
                                collapseThreadListForProject(project.id);
                              }}
                            >
                              <span>Show less</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>

          {projects.length === 0 && !shouldShowProjectPathEntry && (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
              No projects yet
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            {isOnSettings ? (
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={() => window.history.back()}
              >
                <ArrowLeftIcon className="size-3.5" />
                <span className="text-xs">Back</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={() => void navigate({ to: "/settings" })}
              >
                <SettingsIcon className="size-3.5" />
                <span className="text-xs">Settings</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Mobile long-press context menu */}
      <MobileContextMenu
        open={mobileMenuOpen}
        items={mobileMenuItems}
        position={mobileMenuPosition}
        onSelect={handleMobileMenuSelect}
        onClose={closeMobileMenu}
        title={mobileMenuTitle}
      />
    </>
  );
}
