/**
 * Fork (chickenputty/t3code): the Source Control tab in the right panel. An editor-style view
 * of the active thread's repository: branch, Staged Changes, Changes and Untracked lists
 * with one status letter per file, stage and unstage per file or per section, and a commit
 * box that commits exactly what is staged. The lists follow the vcs status stream, so an
 * agent's edits and the other git surfaces keep it current.
 */
import type { EnvironmentId, VcsChangedFile } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { CheckIcon, GitBranchIcon, MinusIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type Section = "staged" | "unstaged" | "untracked";

const SECTION_TITLES: Record<Section, string> = {
  staged: "Staged Changes",
  unstaged: "Changes",
  untracked: "Untracked",
};

const STATUS_CLASS: Record<VcsChangedFile["status"], string> = {
  M: "text-warning-foreground",
  A: "text-success-foreground",
  D: "text-destructive-foreground",
  R: "text-info-foreground",
  C: "text-info-foreground",
  T: "text-info-foreground",
  U: "text-success-foreground",
};

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>): void {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
  const failure = squashAtomCommandFailure(result);
  const description =
    failure instanceof Error
      ? failure.message
      : typeof failure === "object" && failure !== null && "message" in failure
        ? String(failure.message)
        : undefined;
  toastManager.add({ type: "error", title, ...(description ? { description } : {}) });
}

function splitPath(path: string): { name: string; directory: string } {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0
    ? { name: path, directory: "" }
    : { name: path.slice(cut + 1), directory: path.slice(0, cut) };
}

export default function SourceControlPanel(props: {
  environmentId: EnvironmentId;
  cwd: string;
  workspaceMutationId: string | null;
}) {
  const { environmentId, cwd, workspaceMutationId } = props;
  const target = useMemo(() => ({ environmentId, input: { cwd } }), [environmentId, cwd]);
  const query = useEnvironmentQuery(vcsEnvironment.workingChanges(target));
  const { data, error, isPending, refresh } = query;

  // Our own stage, unstage and commit refetch explicitly: the status stream only emits when
  // its summary changes, and moving a file between index and tree does not change it. Agent
  // edits arrive as a workspace mutation, and a window focus catches edits made outside T3.
  useWorkspaceMutationRefresh({
    mutationId: workspaceMutationId,
    refresh,
    resourceKey: `source-control:${environmentId}:${cwd}`,
  });
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const stage = useAtomCommand(vcsEnvironment.stage, { reportFailure: false });
  const unstage = useAtomCommand(vcsEnvironment.unstage, { reportFailure: false });
  const commitStaged = useAtomCommand(vcsEnvironment.commitStaged, { reportFailure: false });

  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<Section, boolean>>({
    staged: false,
    unstaged: false,
    untracked: false,
  });

  const runStage = useCallback(
    async (paths: readonly string[]) => {
      setBusy(true);
      try {
        reportFailure("Could not stage", await stage({ environmentId, input: { cwd, paths } }));
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [cwd, environmentId, refresh, stage],
  );
  const runUnstage = useCallback(
    async (paths: readonly string[]) => {
      setBusy(true);
      try {
        reportFailure("Could not unstage", await unstage({ environmentId, input: { cwd, paths } }));
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [cwd, environmentId, refresh, unstage],
  );
  const runCommit = useCallback(async () => {
    const trimmed = message.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    try {
      const result = await commitStaged({ environmentId, input: { cwd, message: trimmed } });
      if (result._tag === "Success") {
        setMessage("");
        toastManager.add({
          type: "success",
          title: "Committed",
          description: result.value.commitSha.slice(0, 7),
        });
      } else {
        reportFailure("Commit failed", result);
      }
    } finally {
      setBusy(false);
      refresh();
    }
  }, [commitStaged, cwd, environmentId, message, refresh]);

  const staged = data?.staged ?? [];
  const unstaged = data?.unstaged ?? [];
  const untracked = data?.untracked ?? [];
  const total = staged.length + unstaged.length + untracked.length;
  const canCommit = staged.length > 0 && message.trim().length > 0 && !busy;

  const toggle = (section: Section) =>
    setCollapsed((current) => ({ ...current, [section]: !current[section] }));

  const renderSection = (
    section: Section,
    files: readonly VcsChangedFile[],
    action: { label: string; icon: typeof PlusIcon; run: (paths: readonly string[]) => void },
  ) => {
    if (files.length === 0) return null;
    return (
      <div key={section} className="flex flex-col">
        {/* The section action sits beside the header button, not inside it: a button
            cannot contain a button. */}
        <div className="flex items-center gap-1 pr-2">
          <div className="min-w-0 flex-1">
            <CollapsibleSectionHeader
              expanded={!collapsed[section]}
              onClick={() => toggle(section)}
              accessory={<SectionHeaderStatus>{files.length}</SectionHeaderStatus>}
            >
              {SECTION_TITLES[section]}
            </CollapsibleSectionHeader>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost-muted"
                  size="icon-tiny"
                  aria-label={`${action.label} all`}
                  disabled={busy}
                  onClick={() => action.run(files.map((file) => file.path))}
                />
              }
            >
              <action.icon />
            </TooltipTrigger>
            <TooltipPopup>{action.label} all</TooltipPopup>
          </Tooltip>
        </div>
        {collapsed[section] ? null : (
          <ul className="flex flex-col">
            {files.map((file) => {
              const { name, directory } = splitPath(file.path);
              return (
                <li
                  key={`${section}:${file.path}`}
                  className="group/row flex h-7 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/60"
                >
                  <span className={cn("truncate", file.status === "D" && "line-through")}>
                    {name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {file.previousPath ? `${file.previousPath} → ` : ""}
                    {directory}
                  </span>
                  <Button
                    variant="ghost-muted"
                    size="icon-tiny"
                    aria-label={`${action.label} ${file.path}`}
                    disabled={busy}
                    onClick={() => action.run([file.path])}
                  >
                    <action.icon className="opacity-0 group-hover/row:opacity-100" />
                  </Button>
                  <span
                    className={cn(
                      "w-3 shrink-0 text-right text-xs font-semibold tabular-nums",
                      STATUS_CLASS[file.status],
                    )}
                  >
                    {file.status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="source-control-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <GitBranchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {data?.refName ?? (data ? "detached HEAD" : "…")}
        </span>
        <span className="text-muted-foreground tabular-nums">{data ? total : ""}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Refresh"
                disabled={isPending}
                onClick={() => refresh()}
              />
            }
          >
            <RefreshCwIcon className={cn(isPending && "animate-spin")} />
          </TooltipTrigger>
          <TooltipPopup>Refresh</TooltipPopup>
        </Tooltip>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-b p-2">
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canCommit) {
              event.preventDefault();
              void runCommit();
            }
          }}
          placeholder={
            staged.length === 0 ? "Stage changes to commit" : "Message (Ctrl+Enter to commit)"
          }
          rows={2}
          disabled={busy}
          aria-label="Commit message"
        />
        <Button size="sm" disabled={!canCommit} onClick={() => void runCommit()}>
          <CheckIcon />
          Commit{staged.length > 0 ? ` ${staged.length} staged` : ""}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-1">
          {error ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Could not read the repository</EmptyTitle>
                <EmptyDescription>{error}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : data && total === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No changes</EmptyTitle>
                <EmptyDescription>The working tree is clean.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {renderSection("staged", staged, {
                label: "Unstage",
                icon: MinusIcon,
                run: (paths) => void runUnstage(paths),
              })}
              {renderSection("unstaged", unstaged, {
                label: "Stage",
                icon: PlusIcon,
                run: (paths) => void runStage(paths),
              })}
              {renderSection("untracked", untracked, {
                label: "Stage",
                icon: PlusIcon,
                run: (paths) => void runStage(paths),
              })}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
