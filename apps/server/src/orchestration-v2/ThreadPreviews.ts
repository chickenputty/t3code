import {
  ORCHESTRATION_THREAD_PREVIEW_MAX_LENGTH,
  type OrchestrationGetThreadPreviewsInput,
  type OrchestrationGetThreadPreviewsResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

/** Carries no message text: previews are user content. */
export class ThreadPreviewsError extends Schema.TaggedError<ThreadPreviewsError>()(
  "ThreadPreviewsError",
  {
    operation: Schema.Literals(["query", "decode"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread previews ${this.operation} failed.`;
  }
}

const PreviewRequest = Schema.Struct({ threadIds: Schema.Array(ThreadId) });
const PreviewRow = Schema.Struct({
  threadId: ThreadId,
  firstText: Schema.NullOr(Schema.String),
  lastText: Schema.NullOr(Schema.String),
});

/** Whitespace-collapsed, at most 240 characters, ending in "…" when cut. */
export function buildPreviewSnippet(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= ORCHESTRATION_THREAD_PREVIEW_MAX_LENGTH) {
    return normalized;
  }
  let end = ORCHESTRATION_THREAD_PREVIEW_MAX_LENGTH - 1;
  // Never split a surrogate pair.
  const code = normalized.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${normalized.slice(0, end).trimEnd()}…`;
}

/**
 * Short first/last message previews for a bounded batch of V2 threads, for
 * cards that only hold the (message-free) thread shell.
 */
export class ThreadPreviews extends Context.Service<
  ThreadPreviews,
  {
    readonly getPreviews: (
      input: OrchestrationGetThreadPreviewsInput,
    ) => Effect.Effect<OrchestrationGetThreadPreviewsResult, ThreadPreviewsError>;
  }
>()("t3/orchestration-v2/ThreadPreviews") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // first: earliest user message (user rows rank ahead of assistant rows, so
  // first_rank = 1 lands on an assistant row only when the thread has no user
  // message, and that row is ignored). last: newest user or assistant message.
  const previewRows = SqlSchema.findAll({
    Request: PreviewRequest,
    Result: PreviewRow,
    execute: ({ threadIds }) => sql`
      WITH candidate AS (
        SELECT
          messages.thread_id,
          messages.role,
          messages.message_id,
          messages.created_at,
          json_extract(messages.payload_json, '$.text') AS text
        FROM orchestration_v2_projection_messages AS messages
        INNER JOIN orchestration_v2_projection_threads AS threads
          ON threads.thread_id = messages.thread_id
        WHERE messages.thread_id IN ${sql.in(threadIds)}
          AND threads.deleted_at IS NULL
          AND messages.streaming = 0
          AND messages.role IN ('user', 'assistant')
          AND trim(json_extract(messages.payload_json, '$.text'), ' ' || char(9) || char(10) || char(13)) <> ''
      ),
      ranked AS (
        SELECT
          thread_id,
          role,
          text,
          ROW_NUMBER() OVER (
            PARTITION BY thread_id
            ORDER BY CASE role WHEN 'user' THEN 0 ELSE 1 END ASC, created_at ASC, message_id ASC
          ) AS first_rank,
          ROW_NUMBER() OVER (
            PARTITION BY thread_id
            ORDER BY created_at DESC, message_id DESC
          ) AS last_rank
        FROM candidate
      )
      SELECT
        thread_id AS "threadId",
        MAX(CASE WHEN first_rank = 1 AND role = 'user' THEN text END) AS "firstText",
        MAX(CASE WHEN last_rank = 1 THEN text END) AS "lastText"
      FROM ranked
      WHERE first_rank = 1 OR last_rank = 1
      GROUP BY thread_id
      ORDER BY thread_id ASC
    `,
  });

  const getPreviews: ThreadPreviews["Service"]["getPreviews"] = Effect.fn(
    "ThreadPreviews.getPreviews",
  )(function* (input) {
    const rows = yield* previewRows({ threadIds: [...new Set(input.threadIds)] }).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadPreviewsError({
            operation: Schema.isSchemaError(cause) ? "decode" : "query",
            cause,
          }),
      ),
    );
    return {
      previews: rows.map((row) => ({
        threadId: row.threadId,
        first: row.firstText === null ? null : buildPreviewSnippet(row.firstText),
        last: row.lastText === null ? null : buildPreviewSnippet(row.lastText),
      })),
    };
  });

  return ThreadPreviews.of({ getPreviews });
});

export const layer = Layer.effect(ThreadPreviews, make);
