import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  type Loadout,
  SOLO_LOADOUT_ID,
  type ScopedThreadRef,
  type ThreadLoadout,
} from "@t3tools/contracts";
import { resolveLoadout, withSolo } from "@t3tools/shared/loadouts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useProject, useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";

export interface ComposerLoadout {
  readonly loadouts: ReadonlyArray<Loadout>;
  /** The loadout the thread runs under; solo when none was chosen or it was since deleted. */
  readonly active: Loadout;
  readonly choice: ThreadLoadout | null;
  readonly onSelect: (loadoutId: string) => void;
  readonly onClear: () => void;
}

/**
 * A server thread's loadout and the list its project resolves to. Absent for a draft, which has
 * no thread yet to hold a choice; every thread starts solo and the picker appears with it.
 */
export function useComposerLoadout(
  environmentId: EnvironmentId,
  threadRef: ScopedThreadRef | null,
): ComposerLoadout | null {
  const shell = useThreadShell(threadRef);
  const project = useProject(
    shell === null ? null : scopeProjectRef(environmentId, shell.projectId),
  );
  const settings = useEnvironmentSettings(environmentId);
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: true,
  });
  if (shell === null) return null;
  const loadouts = withSolo(
    resolveProjectSettings(settings, shell.projectId, project ?? undefined).settings.loadouts,
  );
  const choice = shell.loadout ?? null;
  return {
    loadouts,
    active: resolveLoadout(loadouts, choice?.id),
    choice,
    // Hands the slot back so the agent may propose again; a user pick otherwise stands for good.
    onClear: () => {
      if (choice === null) return;
      void updateMetadata({ environmentId, input: { threadId: shell.id, loadout: null } });
    },
    onSelect: (loadoutId) => {
      if (loadoutId === (choice?.id ?? SOLO_LOADOUT_ID) && choice?.setBy !== "agent") return;
      void updateMetadata({
        environmentId,
        input: { threadId: shell.id, loadout: { id: loadoutId, reason: null, setBy: "user" } },
      });
    },
  };
}
