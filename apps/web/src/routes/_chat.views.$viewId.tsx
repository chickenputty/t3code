import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { SavedViewPage } from "../components/views/SavedViewPage";

export interface SavedViewSearch {
  /** The scoped key of the thread open in the inspector, so the open item is linkable. */
  readonly open?: string;
}

export const Route = createFileRoute("/_chat/views/$viewId")({
  validateSearch: (raw: Record<string, unknown>): SavedViewSearch =>
    typeof raw.open === "string" && raw.open !== "" ? { open: raw.open } : {},
  component: SavedViewRouteView,
});

function SavedViewRouteView() {
  const { viewId } = Route.useParams();
  const { open } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const setOpenKey = useCallback(
    (key: string | null) => {
      void navigate({ search: key === null ? {} : { open: key }, replace: true });
    },
    [navigate],
  );
  return <SavedViewPage viewId={viewId} openKey={open ?? null} onOpenKeyChange={setOpenKey} />;
}
