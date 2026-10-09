/**
 * Fork (chickenputty/t3code): making, naming and filling custom categories
 * from a view. The page owns the writes; these only collect a name or a pick.
 */
import type { ThreadCategory } from "@t3tools/contracts";
import {
  EllipsisIcon,
  FolderInputIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { DraftInput } from "~/components/ui/draft-input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";

import type { ViewGroup } from "./viewEngine";

export interface CategoryTools {
  readonly create: (name: string) => void;
  readonly rename: (id: string, name: string) => void;
  readonly remove: (id: string) => void;
}

/** A name field that commits on Enter or blur and gives up on Escape or an empty name. */
function NameInput({
  value,
  label,
  placeholder,
  onCommit,
  onDone,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onDone: () => void;
}) {
  return (
    <span
      className="contents"
      onBlur={onDone}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onDone();
      }}
      // A board column must not start a drag from inside the field.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <DraftInput
        // biome-ignore lint/a11y/noAutofocus: naming starts typing at once
        autoFocus
        size="compact"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onCommit={(name) => {
          onDone();
          if (name.trim() !== "") onCommit(name.trim());
        }}
      />
    </span>
  );
}

/** A group's title; a category's carries a menu to rename or delete it. */
export function GroupTitle({
  group,
  tools,
  count,
}: {
  group: ViewGroup;
  tools: CategoryTools | null;
  count: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  // The closing menu would hand focus back and blur the name field at once.
  const startingRename = useRef(false);
  const categoryId = group.categoryId;
  if (renaming && categoryId !== undefined && tools) {
    return (
      <NameInput
        value={group.label}
        label="Category name"
        onCommit={(name) => tools.rename(categoryId, name)}
        onDone={() => {
          startingRename.current = false;
          setRenaming(false);
        }}
      />
    );
  }
  return (
    <>
      <span className="truncate">{group.label}</span>
      {count}
      {categoryId !== undefined && tools ? (
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label={`${group.label} options`}
                className="ms-auto"
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end" finalFocus={() => !startingRename.current}>
            <MenuItem
              onClick={() => {
                startingRename.current = true;
                setRenaming(true);
              }}
            >
              <PencilIcon />
              Rename category
            </MenuItem>
            <MenuItem variant="destructive" onClick={() => tools.remove(categoryId)}>
              <Trash2Icon />
              Delete category
            </MenuItem>
          </MenuPopup>
        </Menu>
      ) : null}
    </>
  );
}

/** The board's last column: a button that becomes a name field. */
export function NewCategoryColumn({ tools, width }: { tools: CategoryTools; width: number }) {
  const [naming, setNaming] = useState(false);
  return (
    <div className="shrink-0 px-1 pt-2" style={{ width }}>
      {naming ? (
        <NameInput
          value=""
          label="New category name"
          placeholder="Category name"
          onCommit={tools.create}
          onDone={() => setNaming(false)}
        />
      ) : (
        <Button variant="ghost-muted" size="sm" onClick={() => setNaming(true)}>
          <PlusIcon />
          New category
        </Button>
      )}
    </div>
  );
}

/** Files the selected threads under a category, a new one, or none. */
export function CategoryPicker({
  categories,
  onAssign,
  onCreate,
}: {
  categories: readonly ThreadCategory[];
  onAssign: (categoryId: string | null) => void;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const close = () => {
    setNaming(false);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="xs" />}>
        <FolderInputIcon />
        Category
      </PopoverTrigger>
      <PopoverPopup side="top" padding="compact">
        <div className="flex w-56 flex-col gap-0.5">
          {categories.map((category) => (
            <Button
              key={category.id}
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => {
                onAssign(category.id);
                close();
              }}
            >
              <span className="truncate">{category.name}</span>
            </Button>
          ))}
          {naming ? (
            <NameInput
              value=""
              label="New category name"
              placeholder="Category name"
              onCommit={(name) => {
                onCreate(name);
                close();
              }}
              onDone={() => setNaming(false)}
            />
          ) : (
            <Button
              variant="ghost-muted"
              size="sm"
              className="justify-start"
              onClick={() => setNaming(true)}
            >
              <PlusIcon />
              New category
            </Button>
          )}
          {categories.length > 0 ? (
            <Button
              variant="ghost-muted"
              size="sm"
              className="justify-start"
              onClick={() => {
                onAssign(null);
                close();
              }}
            >
              <XIcon />
              Remove from category
            </Button>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
