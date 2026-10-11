/**
 * Fork (chickenputty/t3code): a thread opened from a saved view, like a
 * Notion database item. Side peek keeps the view live beside it, the modal
 * focuses it, the full page replaces the layout. Resume Chat always goes
 * back to the thread itself.
 */
import type { SavedViewOpenMode } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, MessageSquareIcon, PlayIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { ThreadActivityTab } from "~/components/thread/ThreadActivityTab";
import { ThreadFilesTab } from "~/components/thread/ThreadFilesTab";
import { ThreadOverviewTab } from "~/components/thread/ThreadOverviewTab";
import { ThreadUsageTab } from "~/components/thread/ThreadUsageTab";

import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { DraftInput } from "~/components/ui/draft-input";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { useThreadProjection } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";

import { buildInspectorModel, type InspectorModel } from "./inspectorModel";
import type { ViewBulkAction } from "./useViewThreadOps";
import { isWidgetEvent } from "./viewKeys";
import { StatusDot } from "./ViewLayouts";
import { formatRelativeMs, type ViewRow, VIEW_STATUS_OPTIONS } from "./viewEngine";

const TABS = ["overview", "messages", "files", "activity", "usage"] as const;
type InspectorTab = (typeof TABS)[number];
const TAB_LABELS: Record<InspectorTab, string> = {
  overview: "Overview",
  messages: "Messages",
  files: "Files",
  activity: "Activity",
  usage: "Usage",
};

export interface ThreadInspectorProps {
  readonly row: ViewRow;
  readonly mode: SavedViewOpenMode;
  readonly nowMs: number;
  readonly onClose: () => void;
  readonly onAction: (row: ViewRow, action: ViewBulkAction) => void;
  readonly onRename: (row: ViewRow, title: string) => void;
}

export function ThreadInspector(props: ThreadInspectorProps) {
  if (props.mode === "modal") {
    return (
      <Dialog open onOpenChange={(open) => !open && props.onClose()}>
        <DialogPopup className="h-[min(48rem,calc(100dvh-4rem))] max-w-3xl" showCloseButton={false}>
          <DialogTitle className="sr-only">{props.row.title}</DialogTitle>
          <InspectorBody {...props} />
        </DialogPopup>
      </Dialog>
    );
  }
  if (props.mode === "page") {
    return (
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col">
        <InspectorBody {...props} />
      </div>
    );
  }
  return (
    <aside
      aria-label={`Thread: ${props.row.title}`}
      className="absolute inset-y-0 right-0 z-20 flex w-[min(40rem,100%)] flex-col border-border border-s bg-popover text-popover-foreground shadow-xl"
    >
      <InspectorBody {...props} />
    </aside>
  );
}

function InspectorBody({ row, mode, nowMs, onClose, onAction, onRename }: ThreadInspectorProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<InspectorTab>("overview");
  const thread = useThreadProjection(row.ref);
  const model = useMemo(() => (thread ? buildInspectorModel(thread.projection) : null), [thread]);

  useEffect(() => {
    if (mode === "modal") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !isWidgetEvent(event)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, onClose]);

  const resume = () => {
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(row.ref) });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-border/70 border-b px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          {mode === "page" ? (
            <Button variant="ghost-muted" size="xs" onClick={onClose}>
              <ArrowLeftIcon />
              Back to view
            </Button>
          ) : null}
          <div className="min-w-0 flex-1" />
          <Button size="sm" onClick={resume}>
            <PlayIcon />
            Resume Chat
          </Button>
          {mode === "page" ? null : (
            <Button variant="ghost-muted" size="icon-sm" aria-label="Close" onClick={onClose}>
              <XIcon />
            </Button>
          )}
        </div>
        <DraftInput
          aria-label="Thread title"
          value={row.title}
          onCommit={(title) => {
            if (title.trim() !== "" && title.trim() !== row.title) onRename(row, title);
          }}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
          <span className="flex items-center gap-1.5">
            <StatusDot status={row.status} />
            {VIEW_STATUS_OPTIONS.find((option) => option.value === row.status)?.label}
          </span>
          <span>{row.projectLabel}</span>
          <span>{row.model}</span>
          <span>{formatRelativeMs(row.activityMs, nowMs)} ago</span>
        </div>
        <div
          role="tablist"
          aria-label="Thread details"
          className="-mb-3 flex gap-1 overflow-x-auto"
        >
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "border-b-2 px-2.5 pb-2 text-sm outline-none focus-visible:text-foreground",
                tab === id
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABELS[id]}
              {id === "files" && model && model.files.length > 0 ? (
                <span className="ms-1 tabular-nums opacity-60">{model.files.length}</span>
              ) : null}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "overview" ? (
          <ThreadOverviewTab row={row} model={model} nowMs={nowMs} onAction={onAction} />
        ) : model === null ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner className="size-4" />
            Loading conversation…
          </div>
        ) : tab === "messages" ? (
          <MessagesTab model={model} onResume={resume} />
        ) : tab === "files" ? (
          <ThreadFilesTab model={model} />
        ) : tab === "activity" ? (
          <ThreadActivityTab model={model} nowMs={nowMs} />
        ) : (
          <ThreadUsageTab model={model} />
        )}
      </div>
    </div>
  );
}

function highlight(text: string, query: string): ReactNode {
  if (query === "") return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;
  for (let index = lower.indexOf(query); index !== -1; index = lower.indexOf(query, at)) {
    parts.push(text.slice(at, index));
    parts.push(
      <mark key={index} className="rounded-sm bg-warning/30 text-inherit">
        {text.slice(index, index + query.length)}
      </mark>,
    );
    at = index + query.length;
  }
  parts.push(text.slice(at));
  return parts;
}

function MessagesTab({ model, onResume }: { model: InspectorModel; onResume: () => void }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const needle = query.trim().toLowerCase();
  const messages =
    needle === ""
      ? model.messages
      : model.messages.filter((m) => m.text.toLowerCase().includes(needle));
  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        size="compact"
        placeholder="Search this conversation"
        aria-label="Search this conversation"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {needle === "" ? "No messages yet." : "No messages match."}
        </p>
      ) : null}
      {messages.map((message) => {
        const open = expanded.has(message.id) || needle !== "";
        return (
          <article
            key={message.id}
            className={cn(
              "flex flex-col gap-1 rounded-lg border border-border/60 px-3 py-2",
              message.role === "user" && "bg-accent/30",
            )}
          >
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <MessageSquareIcon className="size-3" />
              <span className="font-medium">{message.role === "user" ? "You" : "Agent"}</span>
              <span>{new Date(message.createdMs).toLocaleString()}</span>
              <div className="flex-1" />
              <Button variant="ghost-muted" size="micro" onClick={onResume}>
                Open in chat
              </Button>
            </div>
            <p
              className={cn(
                "whitespace-pre-wrap break-words text-sm",
                !open && "line-clamp-8 cursor-pointer",
              )}
              onClick={() => setExpanded((current) => new Set(current).add(message.id))}
            >
              {highlight(message.text, needle)}
            </p>
          </article>
        );
      })}
    </div>
  );
}
