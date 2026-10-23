import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // No backfill: ledger events did not exist before this table, so replay fills it.
  yield* sql`
    CREATE TABLE IF NOT EXISTS orchestration_v2_projection_ledgers (
      thread_id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      -- Open plus in_progress items, so "does this thread have unfinished work" needs no JSON.
      open_item_count INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL
    )
  `;
});
