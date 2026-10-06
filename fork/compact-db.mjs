// Shrinks T3's statev2.sqlite while T3 is closed: deletes what upstream's
// ProjectionMaintenance.compactEventStore calls obsolete (nothing in the app runs it yet), plus the
// V1 activity projection of threads already imported into V2, then VACUUMs.
//
//   node fork/compact-db.mjs <statev2.sqlite> [--dry-run]
//
// Rules, as in apps/server/src/orchestration-v2/ProjectionMaintenance.ts:
//   - V1 thread events and 'legacy' thread receipts of threads whose transcript V2 imported.
//   - V2 thread-state events whose payload is the whole thread: only the newest per thread counts.
//   - V2 message.updated / node.updated: only the newest per (type, thread, payload id) counts.
// Added here: projection_thread_activities rows of imported threads. Only migrations 024 and 025
// read that table, and they ran before V2 existed.
// Prints one JSON line with what it did. Exits 2 if the database is in use.
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";

const [dbPath, ...flags] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: node compact-db.mjs <statev2.sqlite> [--dry-run]");
  process.exit(1);
}
const dryRun = flags.includes("--dry-run");

const SUPERSEDABLE = [
  "thread.archived",
  "thread.unarchived",
  "thread.deleted",
  "thread.settled",
  "thread.unsettled",
  "thread.snoozed",
  "thread.unsnoozed",
  "thread.pinned",
  "thread.auto-settle-set",
  "thread.unpinned",
  "thread.pin-reordered",
  "thread.active-reordered",
  "thread.metadata-updated",
  "thread.pull-request-synced",
  "thread.runtime-mode-updated",
  "thread.interaction-mode-updated",
  "thread.model-selection-updated",
  "thread.provider-switched",
  "thread.visited",
  "thread.marked-unread",
];
const inList = SUPERSEDABLE.map((t) => `'${t}'`).join(",");
const IMPORTED = `SELECT thread_id FROM orchestration_v2_legacy_imports WHERE transcript_imported_at IS NOT NULL`;

const sizeOf = (p) => {
  let n = 0;
  for (const s of ["", "-wal"]) {
    try {
      n += statSync(p + s).size;
    } catch {}
  }
  return n;
};

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 0");
try {
  // Fails right away if T3 (or anything) holds the database.
  db.exec("BEGIN IMMEDIATE");
} catch (e) {
  console.log(JSON.stringify({ ok: false, reason: `database is in use: ${e.message}` }));
  process.exit(2);
}

const before = sizeOf(dbPath);
const t0 = Date.now();
const count = (sql) => db.prepare(sql).get().n;

const targets = {
  v1Events: `FROM orchestration_events WHERE application_event_version = 1 AND aggregate_kind = 'thread' AND stream_id IN (${IMPORTED})`,
  supersededThreadEvents: `FROM orchestration_events WHERE sequence IN (
      SELECT sequence FROM (
        SELECT sequence, ROW_NUMBER() OVER (PARTITION BY stream_id ORDER BY sequence DESC) AS rn
        FROM orchestration_events
        WHERE application_event_version = 2 AND aggregate_kind = 'thread' AND event_type IN (${inList})
      ) WHERE rn > 1)`,
  supersededEntityEvents: `FROM orchestration_events WHERE sequence IN (
      SELECT sequence FROM (
        SELECT sequence, ROW_NUMBER() OVER (
          PARTITION BY event_type, stream_id, json_extract(payload_json, '$.id') ORDER BY sequence DESC) AS rn
        FROM orchestration_events
        WHERE application_event_version = 2 AND event_type IN ('message.updated', 'node.updated')
      ) WHERE rn > 1)`,
  legacyReceipts: `FROM orchestration_command_receipts WHERE command_type = 'legacy' AND aggregate_kind = 'thread' AND aggregate_id IN (${IMPORTED})`,
  v1Activities: `FROM projection_thread_activities WHERE thread_id IN (${IMPORTED})`,
};

const result = { ok: true, dryRun, deleted: {} };
try {
  const maxBefore = count("SELECT COALESCE(MAX(sequence), 0) AS n FROM orchestration_events");
  for (const [name, from] of Object.entries(targets)) {
    result.deleted[name] = dryRun
      ? count(`SELECT COUNT(*) AS n ${from}`)
      : Number(db.prepare(`DELETE ${from}`).run().changes);
  }
  // Startup verification compares the projection's last_sequence with MAX(sequence); the newest
  // event must survive, as it does under upstream's rules.
  const maxAfter = count("SELECT COALESCE(MAX(sequence), 0) AS n FROM orchestration_events");
  if (maxAfter !== maxBefore)
    throw new Error(`newest event sequence changed (${maxBefore} -> ${maxAfter})`);
  db.exec(dryRun ? "ROLLBACK" : "COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.log(JSON.stringify({ ok: false, reason: e.message }));
  process.exit(1);
}

if (!dryRun) {
  db.exec("VACUUM");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}
db.close();
result.mbBefore = Math.round(before / 1e6);
result.mbAfter = Math.round(sizeOf(dbPath) / 1e6);
result.seconds = Math.round((Date.now() - t0) / 1000);
console.log(JSON.stringify(result));
