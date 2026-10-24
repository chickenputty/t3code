import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per thread, outside the event log: a retro is derived analysis that a person can run
  // again, so it neither needs replay nor belongs in the per-event thread payload. project_id and
  // created_at are columns so the zoomed-out rollup filters without decoding every document.
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_task_retros (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      retro_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_task_retros_project
    ON thread_task_retros(project_id, created_at)
  `;
});
