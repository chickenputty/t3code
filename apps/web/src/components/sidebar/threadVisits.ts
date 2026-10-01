/**
 * Fork (chickenputty/t3code): which threads were opened, when, and in what
 * order. The sidebar's "Recently opened" sort reads `openedAt`; the chat
 * header's back and forward buttons walk `trail`, a browser-style history of
 * opened threads only (settings, drafts and other screens are not in it).
 *
 * Upstream's `threadLastVisitedAtById` cannot stand in for `openedAt`: it is
 * stamped with the completion the user has read, not the time they opened it.
 */
import { create } from "zustand";

const STORAGE_KEY = "t3code:fork:thread-visits:v1";
const MAX_TRAIL = 100;
const MAX_OPENED = 500;

export interface ThreadVisits {
  /** Thread key to when it was last opened, in ms. */
  readonly openedAt: Readonly<Record<string, number>>;
  /** Thread keys in the order they were opened, oldest first. */
  readonly trail: readonly string[];
  /** Where in `trail` the user is. */
  readonly index: number;
  /** The thread a back or forward step is opening: its arrival is not a new visit. */
  readonly pending: string | null;
}

const EMPTY_VISITS: ThreadVisits = { openedAt: {}, trail: [], index: -1, pending: null };

/** A thread was opened, by a click or by a back or forward step. */
export function recordThreadOpen(
  visits: ThreadVisits,
  threadKey: string,
  at: number,
): ThreadVisits {
  let openedAt: Record<string, number> = { ...visits.openedAt, [threadKey]: at };
  const keys = Object.keys(openedAt);
  if (keys.length > MAX_OPENED) {
    const keep = new Set(
      keys.toSorted((a, b) => (openedAt[b] ?? 0) - (openedAt[a] ?? 0)).slice(0, MAX_OPENED),
    );
    openedAt = Object.fromEntries(Object.entries(openedAt).filter(([key]) => keep.has(key)));
  }
  // A step already moved the index; a reopen of where the user is adds nothing.
  if (visits.pending === threadKey || visits.trail[visits.index] === threadKey) {
    return { ...visits, openedAt, pending: null };
  }
  // Opening a thread from anywhere else drops the forward history, as a browser does.
  const trail = [...visits.trail.slice(0, visits.index + 1), threadKey].slice(-MAX_TRAIL);
  return { openedAt, trail, index: trail.length - 1, pending: null };
}

/**
 * The thread one step back (-1) or forward (+1), skipping threads that no
 * longer exist, or null at the end. Away from the trail (a draft, settings),
 * back returns to the thread the user left.
 */
export function findThreadStep(
  visits: ThreadVisits,
  direction: -1 | 1,
  currentKey: string | null,
  exists: (threadKey: string) => boolean,
): { readonly threadKey: string; readonly index: number } | null {
  const onTrail = currentKey !== null && visits.trail[visits.index] === currentKey;
  let index = onTrail || direction === 1 ? visits.index + direction : visits.index;
  while (index >= 0 && index < visits.trail.length) {
    const threadKey = visits.trail[index];
    if (threadKey !== undefined && threadKey !== currentKey && exists(threadKey)) {
      return { threadKey, index };
    }
    index += direction;
  }
  return null;
}

function readPersistedVisits(): ThreadVisits {
  if (typeof window === "undefined") return EMPTY_VISITS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_VISITS;
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof value !== "object" || value === null) return EMPTY_VISITS;
    const trail = Array.isArray(value.trail)
      ? value.trail.filter((key): key is string => typeof key === "string").slice(-MAX_TRAIL)
      : [];
    const openedAt =
      typeof value.openedAt === "object" && value.openedAt !== null
        ? Object.fromEntries(
            Object.entries(value.openedAt as Record<string, unknown>).filter(
              (entry): entry is [string, number] => typeof entry[1] === "number",
            ),
          )
        : {};
    const index = typeof value.index === "number" ? value.index : trail.length - 1;
    return {
      openedAt,
      trail,
      index: Math.min(Math.max(index, -1), trail.length - 1),
      pending: null,
    };
  } catch {
    return EMPTY_VISITS;
  }
}

interface ThreadVisitsState extends ThreadVisits {
  readonly recordOpen: (threadKey: string) => void;
  /** Moves to a step `findThreadStep` found, before navigating to it. */
  readonly moveTo: (step: { readonly threadKey: string; readonly index: number }) => void;
}

export const useThreadVisitsStore = create<ThreadVisitsState>((set) => ({
  ...readPersistedVisits(),
  recordOpen: (threadKey) => set((state) => recordThreadOpen(state, threadKey, Date.now())),
  moveTo: (step) => set({ index: step.index, pending: step.threadKey }),
}));

useThreadVisitsStore.subscribe((state) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ openedAt: state.openedAt, trail: state.trail, index: state.index }),
    );
  } catch {
    // Storage can be full or disabled; history still works for this session.
  }
});
