import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { useExplorerStore } from "../components/explorer/explorerStore";
import { readMainAppHref } from "../components/sidebar/mainAppLocation";
import { buildThreadRouteParams } from "../threadRoutes";

export interface SavedViewSearch {
  /** The scoped key of a thread to open beside the view. */
  readonly open?: string;
}

/**
 * Fork (chickenputty/t3code): a deep link to a saved view. Views live in the
 * sidebar explorer, so this picks the view and goes on to the thread in
 * `?open=`, else the last main app location, else the thread list.
 */
export const Route = createFileRoute("/_chat/views/$viewId")({
  validateSearch: (raw: Record<string, unknown>): SavedViewSearch =>
    typeof raw.open === "string" && raw.open !== "" ? { open: raw.open } : {},
  beforeLoad: ({ params, search, preload }) => {
    // A hovered link preloads this route; only a real visit picks the view.
    if (!preload) useExplorerStore.getState().showView(params.viewId);
    const openRef = search.open === undefined ? null : parseScopedThreadKey(search.open);
    if (openRef !== null) {
      throw redirect({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(openRef),
        replace: true,
      });
    }
    throw redirect({ href: readMainAppHref() ?? "/", replace: true });
  },
});
