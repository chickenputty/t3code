/**
 * Command ids under this prefix are minted by the server's MCP paths (`stableCommandId`), where
 * they double as idempotency keys for work such as the ledger judge. A client that could send one
 * could pre-seed or replay that work, so client-dispatched commands may not use it. Clients
 * allocate random UUIDs (optionally with a suffix), never this prefix.
 */
const RESERVED_COMMAND_ID_PREFIX = "command:mcp:";

export const isReservedCommandId = (commandId: string): boolean =>
  commandId.startsWith(RESERVED_COMMAND_ID_PREFIX);
