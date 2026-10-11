/**
 * Fork (chickenputty/t3code): edits to the stored saved-view list. The
 * built-in Threads view is only stored once it is first edited, so edits to it
 * insert it at the front, and it can never be removed.
 */
import type { SavedView } from "@t3tools/contracts";

import {
  BUILT_IN_THREADS_VIEW_ID,
  type LocalThreadsArrangement,
  synthesizeThreadsView,
  withBuiltInThreadsView,
} from "./viewEngine";

export function updateSavedView(
  list: readonly SavedView[],
  id: string,
  patch: Partial<Omit<SavedView, "id">>,
  local: LocalThreadsArrangement,
): readonly SavedView[] {
  if (id === BUILT_IN_THREADS_VIEW_ID && !list.some((view) => view.id === id)) {
    return [{ ...synthesizeThreadsView(local), ...patch }, ...list];
  }
  return list.map((view) => (view.id === id ? { ...view, ...patch } : view));
}

/** The list with a copy of `id` after it, or null when there is no such view. */
export function duplicateSavedView(
  list: readonly SavedView[],
  id: string,
  copyId: string,
  local: LocalThreadsArrangement,
): { readonly list: readonly SavedView[]; readonly copy: SavedView } | null {
  const source = withBuiltInThreadsView(list, local).find((view) => view.id === id);
  if (!source) return null;
  const copy = { ...source, id: copyId, name: `${source.name} copy` };
  // An unstored built-in view sits before the whole list, so its copy goes first.
  const index = list.findIndex((view) => view.id === id);
  return { list: [...list.slice(0, index + 1), copy, ...list.slice(index + 1)], copy };
}

export function removeSavedView(list: readonly SavedView[], id: string): readonly SavedView[] {
  if (id === BUILT_IN_THREADS_VIEW_ID) return list;
  return list.filter((view) => view.id !== id);
}
