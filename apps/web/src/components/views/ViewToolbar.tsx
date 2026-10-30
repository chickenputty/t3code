/**
 * Fork (chickenputty/t3code): a saved view's own controls: filter, sort,
 * group, visible properties and the view's settings menu. In the sidebar
 * (`compact`) they are icon buttons with tooltips. Edits write straight to
 * the saved view; text fields commit on blur.
 */
import type {
  SavedView,
  SavedViewCardSize,
  SavedViewDensity,
  SavedViewFilterCondition,
  SavedViewLayout,
  SavedViewPreview,
  SavedViewSort,
} from "@t3tools/contracts";
import {
  ArrowDownUpIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  FilterIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { cloneElement, type ReactElement, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { DraftInput } from "~/components/ui/draft-input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { VIEW_LAYOUT_ICONS } from "./ViewSwitcher";
import {
  BUILT_IN_THREADS_VIEW_ID,
  VIEW_LAYOUT_LABELS,
  VIEW_OPERATORS,
  VIEW_PROPERTIES,
  type ViewProperty,
  type ViewPropertyOption,
  viewOperator,
  viewProperty,
} from "./viewEngine";

type UpdateView = (patch: Partial<Omit<SavedView, "id">>) => void;

const LAYOUTS: readonly SavedViewLayout[] = ["list", "board", "gallery", "table"];

const CARD_SIZE_LABELS: Record<SavedViewCardSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};
const PREVIEW_LABELS: Record<SavedViewPreview, string> = {
  none: "None",
  first: "First message",
  last: "Last message",
};
const DENSITY_LABELS: Record<SavedViewDensity, string> = {
  compact: "Compact",
  comfortable: "Comfortable",
};

function MenuSubValue({ children }: { children: ReactNode }) {
  return <span className="flex-1 ps-4 text-end text-muted-foreground text-xs">{children}</span>;
}

/** A control's trigger: labelled in a wide toolbar, an icon with a tooltip when compact. */
export function ToolbarTrigger({
  compact,
  label,
  trigger,
  children,
}: {
  compact: boolean;
  label: string;
  trigger: ReactElement;
  children: ReactNode;
}) {
  if (!compact) return cloneElement(trigger, undefined, children);
  return (
    <Tooltip>
      <TooltipTrigger render={trigger}>{children}</TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function MiniSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: readonly ViewPropertyOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(String(next));
      }}
    >
      <SelectTrigger aria-label={label} size="xs" className={className}>
        <SelectValue>
          {options.find((option) => option.value === value)?.label ?? value}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

const PROPERTY_OPTIONS: readonly ViewPropertyOption[] = VIEW_PROPERTIES.map((property) => ({
  value: property.id,
  label: property.label,
}));

function defaultCondition(property: ViewProperty): SavedViewFilterCondition {
  const operator = VIEW_OPERATORS[property.type][0]!;
  const value =
    operator.input === "options"
      ? []
      : operator.input === "boolean"
        ? true
        : operator.input === "days"
          ? 7
          : "";
  return { property: property.id, operator: operator.id, value };
}

// ── Filter ─────────────────────────────────────────────────────────────────

function ConditionValue({
  condition,
  property,
  optionsFor,
  onChange,
}: {
  condition: SavedViewFilterCondition;
  property: ViewProperty;
  optionsFor: (property: ViewProperty) => readonly ViewPropertyOption[];
  onChange: (value: SavedViewFilterCondition["value"]) => void;
}) {
  const operator = viewOperator(property, condition.operator);
  switch (operator?.input) {
    case "none":
    case undefined:
      return null;
    case "boolean":
      return (
        <MiniSelect
          label="Value"
          value={condition.value === true || condition.value === "true" ? "true" : "false"}
          options={[
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]}
          onChange={(value) => onChange(value === "true")}
          className="w-20"
        />
      );
    case "days":
    case "number":
      return (
        <DraftInput
          size="compact"
          type="number"
          min={0}
          aria-label="Value"
          className="w-20"
          value={String(condition.value)}
          onCommit={(next) => onChange(Number(next) || 0)}
        />
      );
    case "text":
      return (
        <DraftInput
          size="compact"
          aria-label="Value"
          placeholder="Text"
          className="w-36"
          value={String(condition.value)}
          onCommit={(next) => onChange(next)}
        />
      );
    case "options": {
      const selected = Array.isArray(condition.value) ? condition.value : [];
      const options = optionsFor(property);
      const summary =
        selected.length === 0
          ? "Choose…"
          : selected
              .map((value) => options.find((option) => option.value === value)?.label ?? value)
              .join(", ");
      return (
        <Menu>
          <MenuTrigger render={<Button variant="outline" size="xs" className="max-w-48" />}>
            <span className="truncate">{summary}</span>
            <ChevronDownIcon className="size-3 opacity-60" />
          </MenuTrigger>
          <MenuPopup align="start" className="max-h-80 min-w-48">
            {options.length === 0 ? (
              <MenuItem disabled>No values</MenuItem>
            ) : (
              options.map((option) => (
                <MenuCheckboxItem
                  key={option.value}
                  checked={selected.includes(option.value)}
                  closeOnClick={false}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...selected, option.value]
                        : selected.filter((value) => value !== option.value),
                    )
                  }
                >
                  {option.label}
                </MenuCheckboxItem>
              ))
            )}
          </MenuPopup>
        </Menu>
      );
    }
  }
}

export function FilterControl({
  view,
  update,
  optionsFor,
  compact,
}: {
  view: SavedView;
  update: UpdateView;
  optionsFor: (property: ViewProperty) => readonly ViewPropertyOption[];
  compact: boolean;
}) {
  const { conditions, conjunction } = view.filter;
  const setConditions = (next: readonly SavedViewFilterCondition[]) =>
    update({ filter: { conjunction, conditions: [...next] } });
  const replace = (index: number, condition: SavedViewFilterCondition) =>
    setConditions(conditions.map((existing, at) => (at === index ? condition : existing)));
  return (
    <Popover>
      <ToolbarTrigger
        compact={compact}
        label={conditions.length > 0 ? `Filter (${conditions.length})` : "Filter"}
        trigger={
          <PopoverTrigger
            render={
              <Button
                variant={conditions.length > 0 ? "secondary" : "ghost-muted"}
                size={compact ? "icon-xs" : "xs"}
                aria-label="Filter"
              />
            }
          />
        }
      >
        <FilterIcon />
        {compact ? null : <span className="hidden lg:inline">Filter</span>}
        {conditions.length > 0 && !compact ? (
          <span className="tabular-nums">{conditions.length}</span>
        ) : null}
      </ToolbarTrigger>
      <PopoverPopup align="end" className="w-[min(36rem,calc(100vw-2rem))]">
        <div className="flex flex-col gap-2 py-1">
          {conditions.length > 1 ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              Match
              <MiniSelect
                label="Match"
                value={conjunction}
                options={[
                  { value: "and", label: "all" },
                  { value: "or", label: "any" },
                ]}
                onChange={(value) =>
                  update({
                    filter: { conjunction: value as "and" | "or", conditions: [...conditions] },
                  })
                }
                className="w-20"
              />
              of these
            </div>
          ) : null}
          {conditions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No filters. Every thread in the view shows.
            </p>
          ) : null}
          {conditions.map((condition, index) => {
            const property = viewProperty(condition.property);
            if (!property) return null;
            return (
              <div
                // oxlint-disable-next-line react/no-array-index-key -- conditions have no id; position is their identity
                key={`${index}-${condition.property}`}
                className="flex flex-wrap items-center gap-1.5"
              >
                <MiniSelect
                  label="Property"
                  value={condition.property}
                  options={PROPERTY_OPTIONS}
                  onChange={(id) => {
                    const next = viewProperty(id);
                    if (next) replace(index, defaultCondition(next));
                  }}
                  className="w-32"
                />
                <MiniSelect
                  label="Operator"
                  value={condition.operator}
                  options={VIEW_OPERATORS[property.type].map((operator) => ({
                    value: operator.id,
                    label: operator.label,
                  }))}
                  onChange={(operatorId) => {
                    const operator = viewOperator(property, operatorId);
                    const keepsValue =
                      operator?.input === viewOperator(property, condition.operator)?.input;
                    replace(index, {
                      ...condition,
                      operator: operatorId,
                      value: keepsValue ? condition.value : defaultCondition(property).value,
                    });
                  }}
                  className="w-40"
                />
                <ConditionValue
                  condition={condition}
                  property={property}
                  optionsFor={optionsFor}
                  onChange={(value) => replace(index, { ...condition, value })}
                />
                <Button
                  variant="ghost-muted"
                  size="icon-xs"
                  aria-label="Remove filter"
                  onClick={() => setConditions(conditions.filter((_, at) => at !== index))}
                >
                  <XIcon />
                </Button>
              </div>
            );
          })}
          <div className="flex items-center gap-2 pt-1">
            <Menu>
              <MenuTrigger render={<Button variant="outline" size="xs" />}>
                <PlusIcon />
                Add filter
              </MenuTrigger>
              <MenuPopup align="start" className="max-h-80">
                {VIEW_PROPERTIES.map((property) => (
                  <MenuItem
                    key={property.id}
                    onClick={() => setConditions([...conditions, defaultCondition(property)])}
                  >
                    {property.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
            {conditions.length > 0 ? (
              <Button variant="ghost-muted" size="xs" onClick={() => setConditions([])}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

// ── Sort ───────────────────────────────────────────────────────────────────

function SortControl({
  view,
  update,
  compact,
}: {
  view: SavedView;
  update: UpdateView;
  compact: boolean;
}) {
  const setSorts = (next: readonly SavedViewSort[]) => update({ sorts: [...next] });
  const unused = VIEW_PROPERTIES.filter(
    (property) => !view.sorts.some((sort) => sort.property === property.id),
  );
  return (
    <Popover>
      <ToolbarTrigger
        compact={compact}
        label="Sort"
        trigger={
          <PopoverTrigger
            render={
              <Button
                variant={view.sorts.length > 0 && compact ? "secondary" : "ghost-muted"}
                size={compact ? "icon-xs" : "xs"}
                aria-label="Sort"
              />
            }
          />
        }
      >
        <ArrowDownUpIcon />
        {compact ? null : <span className="hidden lg:inline">Sort</span>}
      </ToolbarTrigger>
      <PopoverPopup align="end" className="w-[min(26rem,calc(100vw-2rem))]">
        <div className="flex flex-col gap-2 py-1">
          {view.sorts.length === 0 ? (
            <p className="text-muted-foreground text-sm">Latest activity first.</p>
          ) : null}
          {view.sorts.map((sort, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- sorts have no id; position is their identity
            <div key={`${index}-${sort.property}`} className="flex items-center gap-1.5">
              <MiniSelect
                label="Sort by"
                value={sort.property}
                options={PROPERTY_OPTIONS}
                onChange={(property) =>
                  setSorts(
                    view.sorts.map((existing, at) =>
                      at === index ? { ...existing, property } : existing,
                    ),
                  )
                }
                className="w-36"
              />
              <MiniSelect
                label="Direction"
                value={sort.direction}
                options={[
                  { value: "asc", label: "Ascending" },
                  { value: "desc", label: "Descending" },
                ]}
                onChange={(direction) =>
                  setSorts(
                    view.sorts.map((existing, at) =>
                      at === index
                        ? { ...existing, direction: direction as "asc" | "desc" }
                        : existing,
                    ),
                  )
                }
                className="w-32"
              />
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => {
                  const next = [...view.sorts];
                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                  setSorts(next);
                }}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Remove sort"
                onClick={() => setSorts(view.sorts.filter((_, at) => at !== index))}
              >
                <XIcon />
              </Button>
            </div>
          ))}
          <div className="pt-1">
            <Menu>
              <MenuTrigger
                render={<Button variant="outline" size="xs" disabled={unused.length === 0} />}
              >
                <PlusIcon />
                Add sort
              </MenuTrigger>
              <MenuPopup align="start" className="max-h-80">
                {unused.map((property) => (
                  <MenuItem
                    key={property.id}
                    onClick={() =>
                      setSorts([
                        ...view.sorts,
                        {
                          property: property.id,
                          direction: property.type === "date" ? "desc" : "asc",
                        },
                      ])
                    }
                  >
                    {property.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

// ── Group and properties ───────────────────────────────────────────────────

export function GroupControl({
  view,
  update,
  compact,
}: {
  view: SavedView;
  update: UpdateView;
  compact: boolean;
}) {
  // Sections are the native Threads list's own shelves, so it never groups by them.
  const groupable = VIEW_PROPERTIES.filter(
    (property) => property.groupable && !(view.layout === "threads" && property.id === "section"),
  );
  const current = view.groupBy === null ? null : viewProperty(view.groupBy);
  return (
    <Menu>
      <ToolbarTrigger
        compact={compact}
        label={current ? `Group: ${current.label}` : "Group"}
        trigger={
          <MenuTrigger
            render={
              <Button
                variant={current ? "secondary" : "ghost-muted"}
                size={compact ? "icon-xs" : "xs"}
                aria-label="Group"
              />
            }
          />
        }
      >
        <LayersIcon />
        {compact ? null : (
          <span className="hidden lg:inline">{current ? `Group: ${current.label}` : "Group"}</span>
        )}
      </ToolbarTrigger>
      <MenuPopup align="end" className="min-w-52">
        <MenuRadioGroup
          value={view.groupBy ?? ""}
          onValueChange={(value) => update({ groupBy: value === "" ? null : String(value) })}
        >
          {view.layout === "board" ? null : <MenuRadioItem value="">No grouping</MenuRadioItem>}
          {groupable.map((property) => (
            <MenuRadioItem key={property.id} value={property.id}>
              {property.label}
              {property.id === "section" ? <MenuSubValue>drag to move</MenuSubValue> : null}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {/* The native Threads list never draws an empty group. */}
        {view.layout === "threads" ? null : (
          <>
            <MenuSeparator />
            <MenuCheckboxItem
              variant="switch"
              checked={view.hideEmptyGroups}
              onCheckedChange={(checked) => update({ hideEmptyGroups: checked })}
            >
              Hide empty groups
            </MenuCheckboxItem>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

export function PropertiesControl({
  view,
  update,
  compact,
}: {
  view: SavedView;
  update: UpdateView;
  compact: boolean;
}) {
  const shown = new Set(view.properties);
  return (
    <Menu>
      <ToolbarTrigger
        compact={compact}
        label="Properties"
        trigger={
          <MenuTrigger
            render={
              <Button
                variant="ghost-muted"
                size={compact ? "icon-xs" : "xs"}
                aria-label="Properties"
              />
            }
          />
        }
      >
        <SlidersHorizontalIcon />
        {compact ? null : <span className="hidden lg:inline">Properties</span>}
      </ToolbarTrigger>
      <MenuPopup align="end" className="max-h-96 min-w-52">
        <MenuGroup>
          <MenuGroupLabel>{view.layout === "table" ? "Columns" : "Shown on cards"}</MenuGroupLabel>
          {VIEW_PROPERTIES.filter((property) => property.id !== "title").map((property) => (
            <MenuCheckboxItem
              key={property.id}
              checked={shown.has(property.id)}
              closeOnClick={false}
              onCheckedChange={(checked) =>
                update({
                  properties: checked
                    ? [...view.properties, property.id]
                    : view.properties.filter((id) => id !== property.id),
                })
              }
            >
              {property.label}
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

// ── View settings ──────────────────────────────────────────────────────────

function RadioSub<T extends string>({
  label,
  value,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <MenuSub>
      <MenuSubTrigger>
        {label}
        <MenuSubValue>{labels[value]}</MenuSubValue>
      </MenuSubTrigger>
      <MenuSubPopup className="min-w-40">
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {(Object.keys(labels) as T[]).map((option) => (
            <MenuRadioItem key={option} value={option}>
              {labels[option]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}

/** Layout, card and visibility settings of a card view (list, board, gallery, table). */
function CardSettingsItems({ view, update }: { view: SavedView; update: UpdateView }) {
  return (
    <>
      <MenuSub>
        <MenuSubTrigger>
          Layout
          <MenuSubValue>{VIEW_LAYOUT_LABELS[view.layout]}</MenuSubValue>
        </MenuSubTrigger>
        <MenuSubPopup className="min-w-40">
          <MenuRadioGroup
            value={view.layout}
            onValueChange={(value) => {
              const layout = value as SavedViewLayout;
              // A board needs columns; keep the grouping the view had, or project.
              update(
                layout === "board" && view.groupBy === null
                  ? { layout, groupBy: "project" }
                  : { layout },
              );
            }}
          >
            {LAYOUTS.map((layout) => {
              const Icon = VIEW_LAYOUT_ICONS[layout];
              return (
                <MenuRadioItem key={layout} value={layout}>
                  <Icon className="size-4 text-muted-foreground" />
                  {VIEW_LAYOUT_LABELS[layout]}
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        </MenuSubPopup>
      </MenuSub>
      <RadioSub
        label="Card size"
        value={view.cardSize}
        labels={CARD_SIZE_LABELS}
        onChange={(cardSize) => update({ cardSize })}
      />
      <RadioSub
        label="Preview"
        value={view.preview}
        labels={PREVIEW_LABELS}
        onChange={(preview) => update({ preview })}
      />
      <RadioSub
        label="Density"
        value={view.density}
        labels={DENSITY_LABELS}
        onChange={(density) => update({ density })}
      />
      <MenuSeparator />
      <MenuCheckboxItem
        variant="switch"
        checked={view.showSettled}
        onCheckedChange={(checked) => update({ showSettled: checked })}
      >
        Show settled
      </MenuCheckboxItem>
      <MenuCheckboxItem
        variant="switch"
        checked={view.showArchived}
        onCheckedChange={(checked) => update({ showArchived: checked })}
      >
        Show archived
      </MenuCheckboxItem>
      <MenuCheckboxItem
        variant="switch"
        checked={view.showSubagents}
        onCheckedChange={(checked) => update({ showSubagents: checked })}
      >
        Show sub-agent chats
      </MenuCheckboxItem>
      <MenuSeparator />
    </>
  );
}

export function SettingsControl({
  view,
  update,
  onRename,
  onDuplicate,
  onDelete,
}: {
  view: SavedView;
  update: UpdateView;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const builtIn = view.id === BUILT_IN_THREADS_VIEW_ID;
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={<Button variant="ghost-muted" size="icon-xs" aria-label="View settings" />}
            />
          }
        >
          <EllipsisIcon />
        </TooltipTrigger>
        <TooltipPopup side="bottom">View settings</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" className="min-w-60">
        {/* The native Threads list has none of the card settings. */}
        {view.layout === "threads" ? null : <CardSettingsItems view={view} update={update} />}
        {builtIn ? null : (
          <MenuItem onClick={onRename}>
            <PencilIcon />
            Rename view
          </MenuItem>
        )}
        <MenuItem onClick={onDuplicate}>
          <CopyIcon />
          Duplicate view
        </MenuItem>
        {/* The built-in Threads view always exists and keeps its name. */}
        {builtIn ? null : (
          <MenuItem variant="destructive" onClick={onDelete}>
            <Trash2Icon />
            Delete view
          </MenuItem>
        )}
      </MenuPopup>
    </Menu>
  );
}

export function ViewToolbar(props: {
  view: SavedView;
  update: UpdateView;
  optionsFor: (property: ViewProperty) => readonly ViewPropertyOption[];
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Icon buttons with tooltips, for the sidebar. */
  compact?: boolean;
}) {
  const { view, update } = props;
  const compact = props.compact ?? false;
  // The native Threads list sorts itself; it takes filter, group and properties.
  const threadsLayout = view.layout === "threads";
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <FilterControl view={view} update={update} optionsFor={props.optionsFor} compact={compact} />
      {threadsLayout ? null : <SortControl view={view} update={update} compact={compact} />}
      <GroupControl view={view} update={update} compact={compact} />
      <PropertiesControl view={view} update={update} compact={compact} />
      <SettingsControl
        view={view}
        update={update}
        onRename={props.onRename}
        onDuplicate={props.onDuplicate}
        onDelete={props.onDelete}
      />
    </div>
  );
}
