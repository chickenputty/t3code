// Fork: a saved card view inside the sidebar explorer.
// Rows are computed here, not in the chat, so a busy board never re-renders the chat.
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { SavedView, ThreadCategory } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useState } from "react";

import { useExplorerStore } from "~/components/explorer/explorerStore";
import { SidebarChromeFooter, SidebarChromeHeader } from "~/components/sidebar/SidebarChrome";
import { Button } from "~/components/ui/button";
import { DraftInput } from "~/components/ui/draft-input";
import { Input } from "~/components/ui/input";
import { useSidebar } from "~/components/ui/sidebar";
import { isElectron } from "~/env";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import { readLocalApi } from "~/localApi";
import { useThreadSearch } from "~/state/queries";
import { useEnvironments } from "~/state/environments";
import { buildThreadRouteParams, resolveThreadRouteRef } from "~/threadRoutes";
import { resolveSidebarSplitViewAction, useThreadSplitStore } from "~/threadSplitStore";

import { type CategoryTools, CategoryPicker } from "./CategoryControls";
import { isWidgetEvent } from "./viewKeys";
import { useSavedViews } from "./useSavedViews";
import { useThreadCategories } from "./useThreadCategories";
import { useThreadPreviews } from "./useThreadPreviews";
import { type ViewBulkAction, useViewThreadOps } from "./useViewThreadOps";
import { useViewRows } from "./useViewRows";
import {
  BoardLayout,
  GalleryLayout,
  ListLayout,
  TableLayout,
  type ViewLayoutProps,
} from "./ViewLayouts";
import { ViewToolbar } from "./ViewToolbar";
import {
  filterViewRows,
  groupViewRows,
  planGroupDrop,
  showsCategories,
  sortViewRows,
  type ViewProperty,
  type ViewPropertyOption,
  type ViewRow,
} from "./viewEngine";

export function SidebarViewPanel({ view }: { readonly view: SavedView }) {
  const navigate = useNavigate();
  const { views, update, duplicate, remove } = useSavedViews();
  const setActiveViewId = useExplorerStore((state) => state.setActiveViewId);
  const { isMobile, setOpenMobile } = useSidebar();
  const ops = useViewThreadOps();
  const categories = useThreadCategories();
  const { rows, nowMs, archivedLoading } = useViewRows(view.showArchived, categories);
  const { environments } = useEnvironments();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  // The thread in the route is the open card.
  const openKey = useParams({
    strict: false,
    select: (params) => {
      const ref = resolveThreadRouteRef(params);
      return ref === null ? null : scopedThreadKey(ref);
    },
  });

  const updateView = (patch: Partial<Omit<SavedView, "id">>) => update(view.id, patch);

  // Content search runs on the server; titles match here, instantly.
  const environmentIds = environments.map((environment) => environment.environmentId);
  const contentSearch = useThreadSearch(environmentIds, query);
  const snippets = (() => {
    const map = new Map<string, string>();
    for (const match of contentSearch.matches) {
      map.set(scopedThreadKey(scopeThreadRef(match.environmentId, match.threadId)), match.snippet);
    }
    return map;
  })();

  const filteredRows = filterViewRows(rows, view, nowMs);
  const visibleRows = (() => {
    const needle = query.trim().toLowerCase();
    const searched =
      needle === ""
        ? filteredRows
        : filteredRows.filter(
            (row) => row.title.toLowerCase().includes(needle) || snippets.has(row.key),
          );
    return sortViewRows(searched, view.sorts);
  })();

  const groupBy = view.layout === "board" && view.groupBy === null ? "project" : view.groupBy;
  const groups = groupViewRows(visibleRows, groupBy, {
    // Board sections accept drops, so they stay visible even when empty.
    hideEmpty: view.hideEmptyGroups && !(view.layout === "board" && groupBy === "section"),
    nowMs,
    showArchived: view.showArchived,
    categories: categories.categories,
  });
  const orderedRows = groups.flatMap((group) => group.rows);
  const selectedRows = orderedRows.filter((row) => selected.has(row.key));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener clears the selection on Escape
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !isWidgetEvent(event) &&
        selected.size > 0
      ) {
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected.size]);

  const openThread = (ref: ViewRow["ref"]) => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  // No onStartRename: a card cannot rename inline, so the menu leaves Rename out
  // (the open thread's header and the table's title cell rename instead).
  const { openMenu } = useThreadActionMenu({ threadRef: null, projectCwd: null });

  const optionsFor = (property: ViewProperty): readonly ViewPropertyOption[] => {
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
  };

  const runAction = (targets: readonly ViewRow[], action: ViewBulkAction) => {
    void ops.runBulk(targets, action).then(() => {
      if (action === "delete" || action === "archive") setSelected(new Set());
    });
  };

  const handlers: Omit<
    ViewLayoutProps,
    "view" | "groups" | "selected" | "openKey" | "nowMs" | "snippets" | "categoryTools"
  > = {
    onOpen: (row) => openThread(row.ref),
    onContextMenu: (row: ViewRow, event: MouseEvent) => {
      event.preventDefault();
      if (row.section === "archived") {
        openThread(row.ref);
        return;
      }
      openMenu({ x: event.clientX, y: event.clientY }, row.ref, {
        splitView: resolveSidebarSplitViewAction({
          threadKey: row.key,
          routeThreadKey: openKey,
          secondaryThreadKey: useThreadSplitStore.getState().secondaryThreadKey,
          isMobile,
        }),
      });
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
    onDropOnGroup: (row, groupKey) => {
      const drop = planGroupDrop(groupBy, row, groupKey);
      if (drop?.kind === "section") void ops.moveToSection(row, drop.section);
      else if (drop?.kind === "category") categories.assign([row.key], drop.categoryId);
    },
    onRename: (row, title) => void ops.rename(row.ref, title),
    onSortBy: (propertyId) => {
      const current = view.sorts[0];
      const direction =
        current?.property === propertyId ? (current.direction === "asc" ? "desc" : "asc") : "asc";
      updateView({ sorts: [{ property: propertyId, direction }] });
    },
  };

  const previews = useThreadPreviews(filteredRows, view.preview !== "none");
  // What each card says under its title: a search match first, else the chosen preview.
  const cardText = (() => {
    const map = new Map(snippets);
    if (view.preview === "none") return map;
    for (const [key, preview] of previews) {
      if (map.has(key)) continue;
      const text = view.preview === "first" ? (preview.first ?? preview.last) : preview.last;
      if (text) map.set(key, text);
    }
    return map;
  })();

  const deleteCategory = async (category: ThreadCategory) => {
    const confirmed = await settlePromise(
      () =>
        readLocalApi()?.dialogs.confirm(
          `Delete the category "${category.name}"? Its threads go back to their projects.`,
        ) ?? Promise.resolve(true),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    categories.remove(category.id);
  };
  const categoryTools: CategoryTools | null =
    categories.canEdit && showsCategories(groupBy)
      ? {
          create: (name) => void categories.create(name),
          rename: categories.rename,
          remove: (id) => {
            const category = categories.categories.find((candidate) => candidate.id === id);
            if (category) void deleteCategory(category);
          },
        }
      : null;

  const layoutProps: ViewLayoutProps = {
    ...handlers,
    view: { ...view, groupBy },
    groups,
    selected,
    openKey,
    nowMs,
    snippets: cardText,
    categoryTools,
  };

  const deleteView = async () => {
    const confirmed = await settlePromise(
      () =>
        readLocalApi()?.dialogs.confirm(`Delete the view "${view.name}"?`) ?? Promise.resolve(true),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    // The built-in Threads view leads the list, so a neighbour always exists.
    const index = views.findIndex((candidate) => candidate.id === view.id);
    const fallback = views[index + 1] ?? views[index - 1];
    remove(view.id);
    setActiveViewId(fallback?.id ?? null);
  };

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-2">
        <div className="flex min-w-0 items-center gap-1">
          {renaming ? (
            // Blur or Escape always ends renaming; DraftInput only commits a changed name.
            <span
              className="min-w-0 flex-1"
              onBlur={() => setRenaming(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenaming(false);
              }}
            >
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
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate ps-1 text-muted-foreground text-xs tabular-nums">
              {visibleRows.length} thread{visibleRows.length === 1 ? "" : "s"}
              {archivedLoading ? " …" : ""}
            </span>
          )}
          <ViewToolbar
            compact
            view={view}
            update={updateView}
            optionsFor={optionsFor}
            onRename={() => setRenaming(true)}
            onDuplicate={() => {
              const copy = duplicate(view.id);
              if (copy) setActiveViewId(copy.id);
            }}
            onDelete={() => void deleteView()}
          />
        </div>
        <Input
          type="search"
          size="compact"
          aria-label="Search this view"
          placeholder="Search titles and messages"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-auto">
          {visibleRows.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm">
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
        {selectedRows.length > 0 ? (
          <BulkBar
            rows={selectedRows}
            onAction={(action) => runAction(selectedRows, action)}
            onClear={() => setSelected(new Set())}
            category={
              categories.canEdit ? (
                <CategoryPicker
                  categories={categories.categories}
                  onAssign={(categoryId) =>
                    categories.assign(
                      selectedRows.map((row) => row.key),
                      categoryId,
                    )
                  }
                  onCreate={(name) =>
                    void categories.create(
                      name,
                      selectedRows.map((row) => row.key),
                    )
                  }
                />
              ) : null
            }
          />
        ) : null}
      </div>
      <SidebarChromeFooter />
    </>
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
  category,
}: {
  rows: readonly ViewRow[];
  onAction: (action: ViewBulkAction) => void;
  onClear: () => void;
  category: ReactNode;
}) {
  const archivedOnly = rows.every((row) => row.section === "archived");
  return (
    <div className="-translate-x-1/2 absolute bottom-3 left-1/2 z-30 flex max-w-[calc(100%-1rem)] items-center gap-1 overflow-x-auto rounded-xl border border-border bg-popover px-2 py-1.5 shadow-lg">
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
      {category}
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
