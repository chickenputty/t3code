// Shrinks a closed T3's statev2.sqlite: deletes what ProjectionMaintenance.compactEventStore
// calls obsolete plus projection_thread_activities of V2-imported threads, then VACUUMs.
// Usage: node fork/compact-db.mjs <statev2.sqlite> [--dry-run]. Prints one JSON line; exits 2
// if the database is in use.
import * as NodeSqlite from "node:sqlite";
import * as NodeFS from "node:fs";

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
      n += NodeFS.statSync(p + s).size;
    } catch {}
  }
  return n;
};

const db = new NodeSqlite.DatabaseSync(dbPath);
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
