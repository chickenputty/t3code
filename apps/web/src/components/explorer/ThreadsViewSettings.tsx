/**
 * Fork (chickenputty/t3code): the Threads view's settings menu in the native
 * sidebar header: duplicate any Threads view, rename or delete a copy. The
 * name is edited in a small popover under the menu button.
 */
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

import { DraftInput } from "~/components/ui/draft-input";
import { Popover, PopoverPopup } from "~/components/ui/popover";
import { readLocalApi } from "~/localApi";

import { SettingsControl } from "../views/ViewToolbar";
import type { ThreadsViewOptions } from "./useThreadsViewOptions";

export function ThreadsViewSettings(props: { options: ThreadsViewOptions }) {
  const { view, update, duplicateView, deleteView } = props.options;
  const [renaming, setRenaming] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const confirmDelete = async () => {
    const confirmed = await settlePromise(
      () =>
        readLocalApi()?.dialogs.confirm(`Delete the view "${view.name}"?`) ?? Promise.resolve(true),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    deleteView();
  };

  return (
    <span ref={anchorRef} className="inline-flex">
      <SettingsControl
        view={view}
        update={update}
        onRename={() => setRenaming(true)}
        onDuplicate={duplicateView}
        onDelete={() => void confirmDelete()}
      />
      <Popover open={renaming} onOpenChange={setRenaming}>
        <PopoverPopup anchor={anchorRef} align="end" className="w-60">
          <span
            className="block"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") setRenaming(false);
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
                if (name.trim() !== "") update({ name: name.trim() });
              }}
            />
          </span>
        </PopoverPopup>
      </Popover>
    </span>
  );
}
