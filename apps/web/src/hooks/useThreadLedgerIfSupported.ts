import type { EnvironmentId, Ledger, ScopedThreadRef } from "@t3tools/contracts";

import { useServerConfigs, useThreadLedger } from "~/state/entities";

export function useSupportsThreadLedger(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  return (
    environmentId !== null &&
    configs.get(environmentId)?.environment.capabilities.threadLedger === true
  );
}

/**
 * The thread's ledger, or null when the environment lacks `threadLedger`. An unsupported
 * environment never reads the thread atom, so the ledger UI costs it nothing.
 */
export function useThreadLedgerIfSupported(threadRef: ScopedThreadRef | null): Ledger | null {
  const supported = useSupportsThreadLedger(threadRef?.environmentId ?? null);
  return useThreadLedger(supported ? threadRef : null);
}
