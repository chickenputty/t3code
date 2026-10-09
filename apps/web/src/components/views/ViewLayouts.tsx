/**
 * Fork (chickenputty/t3code): the four saved-view layouts. They only render
 * rows the page already filtered, sorted and grouped; every action goes back
 * to the page through the handlers.
 */
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { SavedView } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, PinIcon } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  memo,
  useState,
} from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";

import {
  formatViewPropertyValue,
  isEditableGrouping,
  type ViewGroup,
  type ViewProperty,
  type ViewRow,
  type ViewSection,
  viewProperty,
} from "./viewEngine";

export interface ViewLayoutHandlers {
  readonly onOpen: (row: ViewRow, event: MouseEvent | KeyboardEvent) => void;
  readonly onContextMenu: (row: ViewRow, event: MouseEvent) => void;
  readonly onToggleSelect: (row: ViewRow, event: MouseEvent) => void;
  readonly onMoveToSection: (row: ViewRow, section: ViewSection) => void;
  readonly onRename: (row: ViewRow, title: string) => void;
  readonly onSortBy: (propertyId: string) => void;
}

export interface ViewLayoutProps extends ViewLayoutHandlers {
  readonly view: SavedView;
  readonly groups: readonly ViewGroup[];
  readonly selected: ReadonlySet<string>;
  readonly openKey: string | null;
  readonly nowMs: number;
  /** Text under each card title, by thread key: a search match or a message preview. */
  readonly snippets: ReadonlyMap<string, string>;
}

const STATUS_DOT: Record<ViewRow["status"], string> = {
  approval: "bg-warning",
  input: "bg-warning",
  failed: "bg-destructive",
  limited: "bg-destructive",
  woke: "bg-success",
  done: "bg-success",
  working: "bg-info",
  waiting: "bg-muted-foreground/60",
  idle: "bg-muted-foreground/30",
};

export function StatusDot({
  status,
  className,
}: {
  status: ViewRow["status"];
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_DOT[status], className)}
    />
  );
}

function visibleProperties(view: SavedView): readonly ViewProperty[] {
  return view.properties.flatMap((id) => {
    const property = viewProperty(id);
    return property && property.id !== "title" ? [property] : [];
  });
}

// The page already chose each card's text (search match or preview), so this only reads it.
function previewText(snippet: string | undefined): string | null {
  return snippet ?? null;
}

/** Click opens; a modifier click selects, so cards stay one-click to open. */
function clickHandler(row: ViewRow, handlers: ViewLayoutHandlers) {
  return (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      event.preventDefault();
      handlers.onToggleSelect(row, event);
      return;
    }
    handlers.onOpen(row, event);
  };
}

function keyHandler(row: ViewRow, handlers: ViewLayoutHandlers) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handlers.onOpen(row, event);
    }
  };
}

function GroupHeader({ group }: { group: ViewGroup }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-4 pb-1.5 text-muted-foreground text-xs font-medium">
      <span className="truncate">{group.label}</span>
      <span className="tabular-nums opacity-70">{group.rows.length}</span>
    </div>
  );
}

// Off-screen rows skip layout and paint, so long lists stay cheap without a virtualizer.
const OFFSCREEN_ROW: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 44px",
};
const OFFSCREEN_CARD: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 140px",
};

// ── Card (board and gallery) ──────────────────────────────────────────────

interface CardProps {
  readonly row: ViewRow;
  readonly view: SavedView;
  readonly selected: boolean;
  readonly open: boolean;
  readonly nowMs: number;
  readonly snippet: string | undefined;
  readonly handlers: ViewLayoutHandlers;
  readonly dragging?: boolean;
}

export const ViewCard = memo(function ViewCard({
  row,
  view,
  selected,
  open,
  nowMs,
  snippet,
  handlers,
  dragging,
}: CardProps) {
  const properties = visibleProperties(view);
  const preview = previewText(snippet);
  const compact = view.density === "compact";
  const previewLines =
    view.cardSize === "small"
      ? "line-clamp-2"
      : view.cardSize === "large"
        ? "line-clamp-6"
        : "line-clamp-3";
  return (
    <div
      role="button"
      tabIndex={0}
      data-selected={selected || undefined}
      data-open={open || undefined}
      onClick={clickHandler(row, handlers)}
      onKeyDown={keyHandler(row, handlers)}
      onContextMenu={(event) => handlers.onContextMenu(row, event)}
      className={cn(
        "group/card flex w-full min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border border-border bg-card text-left text-card-foreground shadow-xs/5 outline-none hover:border-ring/50 focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "p-2" : "p-3",
        selected && "border-ring bg-accent/40",
        open && "border-ring",
        dragging && "opacity-90 shadow-lg",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <StatusDot status={row.status} className="mt-1.5" />
        <span className={cn("min-w-0 flex-1 font-medium text-sm", row.unread && "font-semibold")}>
          <span className="line-clamp-2 break-words">{row.title}</span>
        </span>
        {row.pinned ? <PinIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : null}
      </div>
      {preview ? (
        <p
          className={cn(
            "whitespace-pre-line break-words text-muted-foreground text-xs",
            previewLines,
          )}
        >
          {preview}
        </p>
      ) : null}
      {properties.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted-foreground text-xs">
          {properties.map((property) => {
            const text = formatViewPropertyValue(property, row, nowMs);
            if (text === "") return null;
            return (
              <span
                key={property.id}
                className="max-w-full truncate"
                aria-label={`${property.label}: ${text}`}
              >
                {text}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

// ── List ──────────────────────────────────────────────────────────────────

export function ListLayout(props: ViewLayoutProps) {
  const { view, groups, selected, openKey, nowMs, snippets } = props;
  const properties = visibleProperties(view);
  const compact = view.density === "compact";
  const grouped = groups.length > 1 || view.groupBy !== null;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
      {groups.map((group) => (
        <section key={group.key}>
          {grouped ? <GroupHeader group={group} /> : <div className="h-3" />}
          <ul className="divide-y divide-border/60 rounded-lg border border-border/70 bg-card/40">
            {group.rows.map((row) => {
              const preview = previewText(snippets.get(row.key));
              return (
                <li key={row.key} style={OFFSCREEN_ROW}>
                  <div
                    role="button"
                    tabIndex={0}
                    data-selected={selected.has(row.key) || undefined}
                    onClick={clickHandler(row, props)}
                    onKeyDown={keyHandler(row, props)}
                    onContextMenu={(event) => props.onContextMenu(row, event)}
                    className={cn(
                      "group/row flex min-w-0 cursor-pointer items-center gap-3 px-3 outline-none hover:bg-accent/50 focus-visible:bg-accent/60",
                      compact ? "py-1.5" : "py-2.5",
                      selected.has(row.key) && "bg-accent/50",
                      openKey === row.key && "bg-accent/70",
                    )}
                  >
                    <StatusDot status={row.status} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={cn(
                          "truncate text-sm",
                          row.unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {row.title}
                      </span>
                      {preview && !compact ? (
                        <span className="truncate text-muted-foreground text-xs">{preview}</span>
                      ) : null}
                    </div>
                    <div className="hidden shrink-0 items-center gap-3 text-muted-foreground text-xs sm:flex">
                      {properties.map((property) => (
                        <span key={property.id} className="max-w-40 truncate">
                          {formatViewPropertyValue(property, row, nowMs)}
                        </span>
                      ))}
                    </div>
                    {row.pinned ? (
                      <PinIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ── Gallery ───────────────────────────────────────────────────────────────

const GALLERY_MIN_WIDTH: Record<SavedView["cardSize"], number> = {
  small: 200,
  medium: 260,
  large: 340,
};

export function GalleryLayout(props: ViewLayoutProps) {
  const { view, groups, selected, openKey, nowMs, snippets } = props;
  const grouped = groups.length > 1 || view.groupBy !== null;
  return (
    <div className="w-full px-4 pb-10 sm:px-6">
      {groups.map((group) => (
        <section key={group.key}>
          {grouped ? <GroupHeader group={group} /> : <div className="h-3" />}
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${GALLERY_MIN_WIDTH[view.cardSize]}px, 1fr))`,
            }}
          >
            {group.rows.map((row) => (
              <div key={row.key} style={OFFSCREEN_CARD}>
                <ViewCard
                  row={row}
                  view={view}
                  selected={selected.has(row.key)}
                  open={openKey === row.key}
                  nowMs={nowMs}
                  snippet={snippets.get(row.key)}
                  handlers={props}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────

const BOARD_COLUMN_WIDTH: Record<SavedView["cardSize"], number> = {
  small: 240,
  medium: 290,
  large: 360,
};

function BoardCard(props: CardProps & { readonly draggable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.row.key,
    disabled: !props.draggable,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // The card itself is the button; dnd-kit's role would double it.
      role={undefined}
      tabIndex={undefined}
      className={cn(isDragging && "opacity-40")}
    >
      <ViewCard {...props} />
    </div>
  );
}

function BoardColumn({
  group,
  width,
  droppable,
  children,
}: {
  group: ViewGroup;
  width: number;
  droppable: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.key, disabled: !droppable });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex max-h-full shrink-0 flex-col rounded-xl bg-muted/40",
        isOver && "ring-2 ring-ring/60",
      )}
      style={{ width }}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 text-sm font-medium">
        <span className="truncate">{group.label}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{group.rows.length}</span>
      </div>
      <div className="flex min-h-12 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

export function BoardLayout(props: ViewLayoutProps) {
  const { view, groups, selected, openKey, nowMs, snippets } = props;
  const editable = isEditableGrouping(view.groupBy);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const rowByKey = new Map(
    groups.flatMap((group) => group.rows.map((row) => [row.key, row] as const)),
  );
  const activeRow = activeKey === null ? undefined : rowByKey.get(activeKey);
  const width = BOARD_COLUMN_WIDTH[view.cardSize];

  const onDragStart = (event: DragStartEvent) => setActiveKey(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setActiveKey(null);
    const row = rowByKey.get(String(event.active.id));
    const target = event.over?.id;
    if (!row || target === undefined || target === row.section) return;
    props.onMoveToSection(row, String(target) as ViewSection);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveKey(null)}
    >
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto px-4 pt-3 pb-4 sm:px-6">
        {groups.map((group) => (
          <BoardColumn key={group.key} group={group} width={width} droppable={editable}>
            {group.rows.map((row) => (
              <div key={row.key} style={OFFSCREEN_CARD}>
                <BoardCard
                  row={row}
                  view={view}
                  selected={selected.has(row.key)}
                  open={openKey === row.key}
                  nowMs={nowMs}
                  snippet={snippets.get(row.key)}
                  handlers={props}
                  draggable={editable}
                />
              </div>
            ))}
          </BoardColumn>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeRow ? (
          <div style={{ width: width - 16 }}>
            <ViewCard
              row={activeRow}
              view={view}
              selected={false}
              open={false}
              nowMs={nowMs}
              snippet={undefined}
              handlers={props}
              dragging
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────

function TitleCell({
  row,
  onRename,
}: {
  row: ViewRow;
  onRename: (row: ViewRow, title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: inline rename starts typing at once
        autoFocus
        defaultValue={row.title}
        aria-label="Thread title"
        className="w-full min-w-0 rounded-sm border border-ring bg-background px-1.5 py-0.5 text-sm outline-none"
        onClick={(event) => event.stopPropagation()}
        onBlur={(event) => {
          setEditing(false);
          if (event.currentTarget.value.trim() !== row.title)
            onRename(row, event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.currentTarget.value = row.title;
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span
      className={cn("block truncate", row.unread ? "font-semibold" : "font-medium")}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      {row.title}
    </span>
  );
}

export function TableLayout(props: ViewLayoutProps) {
  const { view, groups, selected, openKey, nowMs } = props;
  const properties = visibleProperties(view);
  const compact = view.density === "compact";
  const primarySort = view.sorts[0];
  const grouped = groups.length > 1 || view.groupBy !== null;
  const SortIcon = primarySort?.direction === "asc" ? ArrowUpIcon : ArrowDownIcon;
  const header = (id: string, label: string, className?: string) => (
    <th
      key={id}
      scope="col"
      className={cn("sticky top-0 z-10 bg-background p-0 text-left font-medium", className)}
    >
      <button
        type="button"
        onClick={() => props.onSortBy(id)}
        className="flex w-full items-center gap-1 px-3 py-2 text-muted-foreground text-xs hover:text-foreground"
      >
        <span className="truncate">{label}</span>
        {primarySort?.property === id ? <SortIcon className="size-3 shrink-0" /> : null}
      </button>
    </th>
  );
  return (
    <div className="w-full px-4 pb-10 sm:px-6">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="[&>th]:border-border [&>th]:border-b">
            <th scope="col" className="sticky top-0 z-10 w-8 bg-background" aria-label="Select" />
            {header("title", "Title", "min-w-72")}
            {properties.map((property) => header(property.id, property.label))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            {grouped ? (
              <tr>
                <td colSpan={properties.length + 2}>
                  <GroupHeader group={group} />
                </td>
              </tr>
            ) : null}
            {group.rows.map((row) => (
              <tr
                key={row.key}
                style={OFFSCREEN_ROW}
                tabIndex={0}
                data-selected={selected.has(row.key) || undefined}
                onClick={clickHandler(row, props)}
                onKeyDown={keyHandler(row, props)}
                onContextMenu={(event) => props.onContextMenu(row, event)}
                className={cn(
                  "group/row cursor-pointer outline-none hover:bg-accent/40 focus-visible:bg-accent/50 [&>td]:border-border/60 [&>td]:border-b",
                  selected.has(row.key) && "bg-accent/40",
                  openKey === row.key && "bg-accent/60",
                )}
              >
                <td
                  className={cn(
                    "w-8 px-2",
                    !selected.has(row.key) &&
                      "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100",
                  )}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    aria-label={`Select ${row.title}`}
                    checked={selected.has(row.key)}
                    onClick={(event) => props.onToggleSelect(row, event)}
                  />
                </td>
                <td className={cn("max-w-md px-3", compact ? "py-1" : "py-2")}>
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusDot status={row.status} />
                    <div className="min-w-0 flex-1">
                      <TitleCell row={row} onRename={props.onRename} />
                    </div>
                    {row.pinned ? (
                      <PinIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                  </div>
                </td>
                {properties.map((property) => (
                  <td
                    key={property.id}
                    className={cn(
                      "max-w-64 truncate px-3 text-muted-foreground",
                      compact ? "py-1" : "py-2",
                    )}
                  >
                    {formatViewPropertyValue(property, row, nowMs)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
