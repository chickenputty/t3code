import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo, useState } from "react";

import { useServerConfigs } from "~/state/entities";
import { orchestrationEnvironment } from "~/state/orchestration";

import type { ViewRow } from "./viewEngine";

export interface ThreadPreview {
  readonly first: string | null;
  readonly last: string | null;
}

// The server takes at most 200 threads per request.
const MAX_PER_ENVIRONMENT = 200;
const ENVIRONMENT_SEPARATOR = "\u001e";
const FIELD_SEPARATOR = "\u001f";

const EMPTY: ReadonlyMap<string, ThreadPreview> = new Map();

/** One atom per set of requested threads, keyed by environment and sorted ids. */
const previewsAtom = Atom.family((key: string) =>
  Atom.make((get): ReadonlyMap<string, ThreadPreview> => {
    const previews = new Map<string, ThreadPreview>();
    for (const entry of key.split(ENVIRONMENT_SEPARATOR)) {
      const [environmentId, ...threadIds] = entry.split(FIELD_SEPARATOR) as [
        EnvironmentId,
        ...ThreadId[],
      ];
      const result = get(
        orchestrationEnvironment.threadPreviews({ environmentId, input: { threadIds } }),
      );
      const value = Option.getOrNull(AsyncResult.value(result));
      for (const preview of value?.previews ?? []) {
        previews.set(scopedThreadKey(scopeThreadRef(environmentId, preview.threadId)), {
          first: preview.first,
          last: preview.last,
        });
      }
    }
    return previews;
  }).pipe(Atom.withLabel(`web:view-thread-previews:${key}`)),
);

/**
 * Message previews for the threads a view shows. Shells carry no message
 * bodies, so a view asks for short snippets only while it shows previews,
 * and only from servers that can answer.
 */
export function useThreadPreviews(
  rows: readonly ViewRow[],
  enabled: boolean,
): ReadonlyMap<string, ThreadPreview> {
  const serverConfigs = useServerConfigs();
  const key = useMemo(() => {
    if (!enabled) return null;
    const idsByEnvironment = new Map<EnvironmentId, ThreadId[]>();
    for (const row of rows) {
      const environmentId = row.ref.environmentId;
      if (serverConfigs.get(environmentId)?.environment.capabilities.threadPreviews !== true) {
        continue;
      }
      const ids = idsByEnvironment.get(environmentId) ?? [];
      if (ids.length < MAX_PER_ENVIRONMENT) ids.push(row.ref.threadId);
      idsByEnvironment.set(environmentId, ids);
    }
    if (idsByEnvironment.size === 0) return null;
    return [...idsByEnvironment]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([environmentId, ids]) => [environmentId, ...ids.toSorted()].join(FIELD_SEPARATOR))
      .join(ENVIRONMENT_SEPARATOR);
  }, [enabled, rows, serverConfigs]);
  const previews = useAtomValue(key === null ? EMPTY_ATOM : previewsAtom(key));
  // A changed thread set refetches; keep showing the last previews until it lands.
  const [held, setHeld] = useState(previews);
  if (previews.size > 0 && previews !== held) setHeld(previews);
  if (key === null) return EMPTY;
  return previews.size > 0 ? previews : held;
}

const EMPTY_ATOM = Atom.make(EMPTY).pipe(Atom.withLabel("web:view-thread-previews:empty"));
