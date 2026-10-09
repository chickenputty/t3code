/**
 * Fork (chickenputty/t3code): one saved view, filling the window below the
 * shared top bar. The top bar keeps the brand and view switcher where the
 * Threads view has them; the rest of it belongs to this view.
 */
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { SavedView } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { DraftInput } from "~/components/ui/draft-input";
import { Input } from "~/components/ui/input";
import { SidebarInset } from "~/components/ui/sidebar";
import { SidebarBrand } from "~/components/sidebar/SidebarChrome";
import { useNavigateToMainApp } from "~/components/sidebar/mainAppLocation";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "~/components/WorkspaceBreadcrumb";
import { isElectron } from "~/env";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useThreadSearch } from "~/state/queries";
import { useEnvironments } from "~/state/environments";

import { ThreadInspector } from "./ThreadInspector";
import { useSavedViews } from "./useSavedViews";
import { type ViewBulkAction, useViewThreadOps } from "./useViewThreadOps";
import { useViewRows } from "./useViewRows";
import {
  BoardLayout,
  GalleryLayout,
  ListLayout,
  TableLayout,
  type ViewLayoutProps,
} from "./ViewLayouts";
import { ViewSwitcher } from "./ViewSwitcher";
import { ViewToolbar } from "./ViewToolbar";
import {
  filterViewRows,
  groupViewRows,
  isEditableGrouping,
  sortViewRows,
  type ViewProperty,
  type ViewPropertyOption,
  type ViewRow,
} from "./viewEngine";

export function SavedViewPage({
  viewId,
  openKey,
  onOpenKeyChange,
}: {
  readonly viewId: string;
  readonly openKey: string | null;
  readonly onOpenKeyChange: (key: string | null) => void;
}) {
  const { views } = useSavedViews();
  const view = views.find((candidate) => candidate.id === viewId);
  const navigateToMainApp = useNavigateToMainApp();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {view ? (
        <SavedViewContent view={view} openKey={openKey} onOpenKeyChange={onOpenKeyChange} />
      ) : (
        <div className="flex h-full flex-col">
          <ViewTopBar viewId={null}>{null}</ViewTopBar>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
            This view no longer exists.
            <Button variant="outline" size="sm" onClick={() => void navigateToMainApp()}>
              Back to Threads
            </Button>
          </div>
        </div>
      )}
    </SidebarInset>
  );
}

function ViewTopBar({ viewId, children }: { viewId: string | null; children: ReactNode }) {
  return (
    <header
      className={cn(
        "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 border-border/60 border-b pr-(--workspace-gutter-end) wco:pr-(--workspace-native-controls-inset)",
        isElectron && "drag-region",
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 max-md:ps-3">
        <SidebarBrand onBackdrop={false} />
        <ViewSwitcher currentViewId={viewId} />
      </div>
      {children}
    </header>
  );
}

function SavedViewContent({
  view,
  openKey,
  onOpenKeyChange,
}: {
  view: SavedView;
  openKey: string | null;
  onOpenKeyChange: (key: string | null) => void;
}) {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const { views, update, duplicate, remove } = useSavedViews();
  const ops = useViewThreadOps();
  const { rows, nowMs, archivedLoading } = useViewRows(view.showArchived);
  const { environments } = useEnvironments();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);

  const updateView = useCallback(
    (patch: Partial<Omit<SavedView, "id">>) => update(view.id, patch),
    [update, view.id],
  );

  // Content search runs on the server; titles match here, instantly.
  const environmentIds = useMemo(
    () => environments.map((environment) => environment.environmentId),
    [environments],
  );
  const contentSearch = useThreadSearch(environmentIds, query);
  const snippets = useMemo(() => {
    const map = new Map<string, string>();
    for (const match of contentSearch.matches) {
      map.set(scopedThreadKey(scopeThreadRef(match.environmentId, match.threadId)), match.snippet);
    }
    return map;
  }, [contentSearch.matches]);

  const visibleRows = useMemo(() => {
    const filtered = filterViewRows(rows, view, nowMs);
    const needle = query.trim().toLowerCase();
    const searched =
      needle === ""
        ? filtered
        : filtered.filter(
            (row) => row.title.toLowerCase().includes(needle) || snippets.has(row.key),
          );
    return sortViewRows(searched, view.sorts);
  }, [nowMs, query, rows, snippets, view]);

  const groupBy = view.layout === "board" && view.groupBy === null ? "project" : view.groupBy;
  const groups = useMemo(
    () =>
      groupViewRows(visibleRows, groupBy, {
        // Board columns that accept drops stay visible even when empty.
        hideEmpty:
          view.hideEmptyGroups && !(view.layout === "board" && isEditableGrouping(groupBy)),
        nowMs,
        showArchived: view.showArchived,
      }),
    [groupBy, nowMs, view.hideEmptyGroups, view.layout, view.showArchived, visibleRows],
  );
  const orderedRows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const rowByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const openRow = openKey === null ? undefined : rowByKey.get(openKey);
  const selectedRows = useMemo(
    () => orderedRows.filter((row) => selected.has(row.key)),
    [orderedRows, selected],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openKey === null && selected.size > 0) {
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openKey, selected.size]);

  const { openMenu } = useThreadActionMenu({
    threadRef: null,
    projectCwd: null,
    // Rename happens in the inspector's title field.
    onStartRename: (ref) => onOpenKeyChange(scopedThreadKey(ref)),
  });

  const optionsFor = useCallback(
    (property: ViewProperty): readonly ViewPropertyOption[] => {
      if (property.options) return property.options;
      const seen = new Map<string, string>();
      for (const row of rows) {
        const value = property.value(row);
        if (value === null || value === "") continue;
        const key = String(value);
        if (!seen.has(key)) seen.set(key, property.display?.(row) ?? key);
      }
      return [...seen]
        .map(([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label));
    },
    [rows],
  );

  const runAction = useCallback(
    (targets: readonly ViewRow[], action: ViewBulkAction) => {
      void ops.runBulk(targets, action).then(() => {
        if (action === "delete" || action === "archive") setSelected(new Set());
      });
    },
    [ops],
  );

  const handlers: Omit<
    ViewLayoutProps,
    "view" | "groups" | "selected" | "openKey" | "nowMs" | "snippets"
  > = {
    onOpen: (row) =>
      onOpenKeyChange(openKey === row.key && view.openMode === "peek" ? null : row.key),
    onContextMenu: (row: ViewRow, event: MouseEvent) => {
      event.preventDefault();
      if (row.section === "archived") {
        onOpenKeyChange(row.key);
        return;
      }
      openMenu({ x: event.clientX, y: event.clientY }, row.ref);
    },
    onToggleSelect: (row: ViewRow, event: MouseEvent) => {
      setSelected((current) => {
        const next = new Set(current);
        if (event.shiftKey && anchorKey !== null) {
          const from = orderedRows.findIndex((candidate) => candidate.key === anchorKey);
          const to = orderedRows.findIndex((candidate) => candidate.key === row.key);
          if (from !== -1 && to !== -1) {
            for (const candidate of orderedRows.slice(Math.min(from, to), Math.max(from, to) + 1)) {
              next.add(candidate.key);
            }
            return next;
          }
        }
        if (next.has(row.key)) next.delete(row.key);
        else next.add(row.key);
        return next;
      });
      setAnchorKey(row.key);
    },
    onMoveToSection: (row, section) => void ops.moveToSection(row, section),
    onRename: (row, title) => void ops.rename(row.ref, title),
    onSortBy: (propertyId) => {
      const current = view.sorts[0];
      const direction =
        current?.property === propertyId ? (current.direction === "asc" ? "desc" : "asc") : "asc";
      updateView({ sorts: [{ property: propertyId, direction }] });
    },
  };

  const layoutProps: ViewLayoutProps = {
    ...handlers,
    view: { ...view, groupBy },
    groups,
    selected,
    openKey,
    nowMs,
    snippets,
  };

  const deleteView = async () => {
    const confirmed = await settlePromise(
      () =>
        readLocalApi()?.dialogs.confirm(`Delete the view "${view.name}"?`) ?? Promise.resolve(true),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    const index = views.findIndex((candidate) => candidate.id === view.id);
    const fallback = views[index + 1] ?? views[index - 1];
    remove(view.id);
    if (fallback && fallback.id !== view.id) {
      void navigate({ to: "/views/$viewId", params: { viewId: fallback.id }, search: {} });
    } else {
      void navigateToMainApp();
    }
  };

  const pageInspector = openRow !== undefined && view.openMode === "page";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ViewTopBar viewId={view.id}>
        <WorkspaceBreadcrumb ariaLabel="View breadcrumb" className="min-w-0 flex-1">
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current className="min-w-0">
            {renaming ? (
              <DraftInput
                // biome-ignore lint/a11y/noAutofocus: renaming starts typing at once
                autoFocus
                size="compact"
                aria-label="View name"
                value={view.name}
                onCommit={(name) => {
                  setRenaming(false);
                  if (name.trim() !== "") updateView({ name: name.trim() });
                }}
              />
            ) : (
              <button
                type="button"
                className="min-w-0 truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${view.name}. Double-click to rename.`}
                onDoubleClick={() => setRenaming(true)}
              >
                <WorkspaceBreadcrumbText>{view.name}</WorkspaceBreadcrumbText>
              </button>
            )}
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbText className="font-normal tabular-nums">
              {visibleRows.length} thread{visibleRows.length === 1 ? "" : "s"}
              {archivedLoading ? " …" : ""}
            </WorkspaceBreadcrumbText>
          </WorkspaceBreadcrumbItem>
          {openRow && pageInspector ? (
            <>
              <WorkspaceBreadcrumbSeparator />
              <WorkspaceBreadcrumbItem current className="min-w-0">
                <WorkspaceBreadcrumbText>{openRow.title}</WorkspaceBreadcrumbText>
              </WorkspaceBreadcrumbItem>
            </>
          ) : null}
        </WorkspaceBreadcrumb>
        <div className="relative hidden w-56 shrink sm:block">
          <Input
            type="search"
            size="compact"
            aria-label="Search this view"
            placeholder="Search titles and messages"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <ViewToolbar
          view={view}
          update={updateView}
          optionsFor={optionsFor}
          onRename={() => setRenaming(true)}
          onDuplicate={() => {
            const copy = duplicate(view.id);
            if (copy)
              void navigate({ to: "/views/$viewId", params: { viewId: copy.id }, search: {} });
          }}
          onDelete={() => void deleteView()}
        />
      </ViewTopBar>
      <div className="relative min-h-0 flex-1">
        {pageInspector ? (
          <ThreadInspector
            row={openRow}
            mode="page"
            nowMs={nowMs}
            onClose={() => onOpenKeyChange(null)}
            onAction={(row, action) => runAction([row], action)}
            onRename={(row, title) => void ops.rename(row.ref, title)}
          />
        ) : (
          <div
            className={cn(
              "h-full",
              view.layout === "board" ? "overflow-hidden" : "overflow-y-auto",
            )}
          >
            {visibleRows.length === 0 ? (
              <div className="flex h-full items-center justify-center p-8 text-muted-foreground text-sm">
                {query.trim() !== ""
                  ? "No threads match this search."
                  : "No threads match this view."}
              </div>
            ) : view.layout === "board" ? (
              <BoardLayout {...layoutProps} />
            ) : view.layout === "gallery" ? (
              <GalleryLayout {...layoutProps} />
            ) : view.layout === "table" ? (
              <TableLayout {...layoutProps} />
            ) : (
              <ListLayout {...layoutProps} />
            )}
          </div>
        )}
        {openRow && view.openMode !== "page" ? (
          <ThreadInspector
            key={openRow.key}
            row={openRow}
            mode={view.openMode}
            nowMs={nowMs}
            onClose={() => onOpenKeyChange(null)}
            onAction={(row, action) => runAction([row], action)}
            onRename={(row, title) => void ops.rename(row.ref, title)}
          />
        ) : null}
        {selectedRows.length > 0 ? (
          <BulkBar
            rows={selectedRows}
            onAction={(action) => runAction(selectedRows, action)}
            onClear={() => setSelected(new Set())}
          />
        ) : null}
      </div>
    </div>
  );
}

const BULK_ACTIONS: readonly { action: ViewBulkAction; label: string }[] = [
  { action: "pin", label: "Pin" },
  { action: "settle", label: "Settle" },
  { action: "snooze", label: "Snooze" },
  { action: "mark-unread", label: "Mark unread" },
  { action: "archive", label: "Archive" },
];

function BulkBar({
  rows,
  onAction,
  onClear,
}: {
  rows: readonly ViewRow[];
  onAction: (action: ViewBulkAction) => void;
  onClear: () => void;
}) {
  const archivedOnly = rows.every((row) => row.section === "archived");
  return (
    <div className="-translate-x-1/2 absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-2rem)] items-center gap-1 overflow-x-auto rounded-xl border border-border bg-popover px-2 py-1.5 shadow-lg">
      <span className="shrink-0 px-2 text-sm tabular-nums">{rows.length} selected</span>
      {archivedOnly ? (
        <Button variant="ghost" size="xs" onClick={() => onAction("unarchive")}>
          Unarchive
        </Button>
      ) : (
        BULK_ACTIONS.map((entry) => (
          <Button
            key={entry.action}
            variant="ghost"
            size="xs"
            onClick={() => onAction(entry.action)}
          >
            {entry.label}
          </Button>
        ))
      )}
      {archivedOnly ? null : (
        <Button variant="ghost-destructive" size="xs" onClick={() => onAction("delete")}>
          Delete
        </Button>
      )}
      <Button variant="ghost-muted" size="icon-xs" aria-label="Clear selection" onClick={onClear}>
        <XIcon />
      </Button>
    </div>
  );
}
