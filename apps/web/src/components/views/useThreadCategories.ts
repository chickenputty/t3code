import type { ThreadCategories, ThreadCategory } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import {
  usePrimarySettings,
  usePrimarySettingsAvailable,
  useUpdatePrimarySettings,
} from "~/hooks/useSettings";

import { createPendingSetting } from "./pendingSetting";

const EMPTY: ThreadCategories = { categories: [], assignments: {} };
const pending = createPendingSetting<ThreadCategories>();

function newCategoryId(): string {
  return `category-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Custom categories and which threads are in them, on the primary server.
 * Every write replaces both together, so a delete takes its threads with it.
 */
export function useThreadCategories() {
  const stored = usePrimarySettings((settings) => settings.threadCategories);
  const canEdit = usePrimarySettingsAvailable();
  const updateSettings = useUpdatePrimarySettings();
  const value = pending.usePending(stored) ?? stored ?? EMPTY;

  const write = useCallback(
    (next: ThreadCategories) => {
      pending.set(next);
      updateSettings({ threadCategories: next });
    },
    [updateSettings],
  );

  const actions = useMemo(() => {
    // Always build on the newest value, including writes not yet echoed.
    const current = () => pending.read() ?? value;
    return {
      create(name: string, threadKeys: readonly string[] = []): ThreadCategory {
        const { categories, assignments } = current();
        const category = { id: newCategoryId(), name };
        const nextAssignments = { ...assignments };
        for (const key of threadKeys) nextAssignments[key] = category.id;
        write({ categories: [...categories, category], assignments: nextAssignments });
        return category;
      },
      rename(id: string, name: string) {
        const { categories, assignments } = current();
        write({
          categories: categories.map((category) =>
            category.id === id ? { ...category, name } : category,
          ),
          assignments,
        });
      },
      remove(id: string) {
        const { categories, assignments } = current();
        write({
          categories: categories.filter((category) => category.id !== id),
          assignments: Object.fromEntries(
            Object.entries(assignments).filter(([, categoryId]) => categoryId !== id),
          ),
        });
      },
      /** Files threads under a category, or takes them out of theirs with null. */
      assign(threadKeys: readonly string[], categoryId: string | null) {
        const { categories, assignments } = current();
        const nextAssignments = { ...assignments };
        for (const key of threadKeys) {
          if (categoryId === null) delete nextAssignments[key];
          else nextAssignments[key] = categoryId;
        }
        write({ categories, assignments: nextAssignments });
      },
    };
  }, [value, write]);

  return { categories: value.categories, assignments: value.assignments, canEdit, ...actions };
}

export type ThreadCategoryActions = ReturnType<typeof useThreadCategories>;
