import type {
  LedgerMcpAddItemsInput,
  LedgerMcpCreateInput,
  LedgerMcpRetryInput,
  LedgerMcpSetCheckpointInput,
  LedgerMcpUpdateItemInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as LedgerMcpService from "../../LedgerMcpService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { LedgerToolkit } from "./tools.ts";

type Use<P, A, E> = (
  service: LedgerMcpService.LedgerMcpService["Service"],
  scope: McpInvocationContext.McpInvocationScope,
  input: P,
) => Effect.Effect<A, E>;

const withService =
  <P, A, E>(use: Use<P, A, E>) =>
  (input: P) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* LedgerMcpService.LedgerMcpService;
      return yield* use(service, scope, input);
    });

// Writes act as the caller (live run, not a read-only client) and reads need only a thread
// credential; the service re-checks the thread because it is the only place a ledger is chosen.
const handlers = {
  ledger_create: McpToolAccess.actsAsCaller(
    withService((service, scope, input: LedgerMcpCreateInput) => service.create(scope, input)),
  ),
  ledger_add_items: McpToolAccess.actsAsCaller(
    withService((service, scope, input: LedgerMcpAddItemsInput) => service.addItems(scope, input)),
  ),
  ledger_update_item: McpToolAccess.actsAsCaller(
    withService((service, scope, input: LedgerMcpUpdateItemInput) =>
      service.updateItem(scope, input),
    ),
  ),
  ledger_set_checkpoint: McpToolAccess.actsAsCaller(
    withService((service, scope, input: LedgerMcpSetCheckpointInput) =>
      service.setCheckpoint(scope, input),
    ),
  ),
  ledger_close: McpToolAccess.actsAsCaller(
    withService((service, scope, input: LedgerMcpRetryInput) => service.close(scope, input)),
  ),
  ledger_reopen: McpToolAccess.actsAsCaller(
    withService((service, scope, input: LedgerMcpRetryInput) => service.reopen(scope, input)),
  ),
  ledger_read: McpToolAccess.readsAsCaller(
    withService((service, scope, _input: Record<string, never>) => service.read(scope)),
  ),
} satisfies McpToolAccess.Handlers<typeof LedgerToolkit.tools>;

export const layer = McpToolAccess.toLayer(LedgerToolkit, handlers);
