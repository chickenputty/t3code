import * as Effect from "effect/Effect";

import * as LedgerMcpService from "../../LedgerMcpService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { LedgerToolkit } from "./tools.ts";

// Writes act as the caller (live run, not a read-only client) and reads need only a thread
// credential; the service re-checks the thread because it is the only place a ledger is chosen.
const handlers = {
  ledger_create: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* LedgerMcpService.LedgerMcpService;
      return yield* service.create(scope, input);
    }),
  ),
  ledger_add_items: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* LedgerMcpService.LedgerMcpService;
      return yield* service.addItems(scope, input);
    }),
  ),
  ledger_update_item: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* LedgerMcpService.LedgerMcpService;
      return yield* service.updateItem(scope, input);
    }),
  ),
  ledger_set_checkpoint: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* LedgerMcpService.LedgerMcpService;
      return yield* service.setCheckpoint(scope, input);
    }),
  ),
  ledger_close: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* LedgerMcpService.LedgerMcpService;
      return yield* service.close(scope, input);
    }),
  ),
  ledger_reopen: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* LedgerMcpService.LedgerMcpService;
      return yield* service.reopen(scope, input);
    }),
  ),
  ledger_read: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* LedgerMcpService.LedgerMcpService;
      return yield* service.read(scope);
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof LedgerToolkit.tools>;

export const layer = McpToolAccess.toLayer(LedgerToolkit, handlers);
