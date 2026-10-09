import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

export const OrchestrationThreadSearchSource = Schema.Literals(["user", "assistant"]);
export type OrchestrationThreadSearchSource = typeof OrchestrationThreadSearchSource.Type;

// The server's SQLite client is synchronous and single-connection. Bound both
// scan input and response size so a search cannot monopolize that connection.
export const OrchestrationSearchThreadsInput = Schema.Struct({
  query: TrimmedString.check(Schema.isMinLength(2), Schema.isMaxLength(200)),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});
export type OrchestrationSearchThreadsInput = typeof OrchestrationSearchThreadsInput.Type;

export const OrchestrationThreadSearchMatch = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  source: OrchestrationThreadSearchSource,
  snippet: Schema.String.check(Schema.isMaxLength(240)),
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationThreadSearchMatch = typeof OrchestrationThreadSearchMatch.Type;

export const OrchestrationSearchThreadsResult = Schema.Struct({
  matches: Schema.Array(OrchestrationThreadSearchMatch),
});
export type OrchestrationSearchThreadsResult = typeof OrchestrationSearchThreadsResult.Type;

export class OrchestrationSearchThreadsError extends Schema.TaggedError<OrchestrationSearchThreadsError>()(
  "OrchestrationSearchThreadsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

// Fork: short message previews for thread cards (saved views). Shells carry no
// message text, so cards ask for a bounded batch of previews on demand.
export const ORCHESTRATION_THREAD_PREVIEW_MAX_LENGTH = 240;

export const OrchestrationGetThreadPreviewsInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});
export type OrchestrationGetThreadPreviewsInput = typeof OrchestrationGetThreadPreviewsInput.Type;

const ThreadPreviewSnippet = Schema.NullOr(
  Schema.String.check(Schema.isMaxLength(ORCHESTRATION_THREAD_PREVIEW_MAX_LENGTH)),
);

/**
 * `first` is the earliest finished non-empty user message, `last` the latest
 * finished non-empty user or assistant message. Both are whitespace-collapsed
 * and cut to 240 characters, ending in "…" when cut. `first` is null when the
 * thread has only assistant messages.
 */
export const OrchestrationThreadPreview = Schema.Struct({
  threadId: ThreadId,
  first: ThreadPreviewSnippet,
  last: ThreadPreviewSnippet,
});
export type OrchestrationThreadPreview = typeof OrchestrationThreadPreview.Type;

/**
 * One entry per requested thread that exists, is not deleted (archived is
 * fine) and has at least one finished user or assistant message. Unknown,
 * deleted and message-less threads are omitted. Order is unspecified.
 */
export const OrchestrationGetThreadPreviewsResult = Schema.Struct({
  previews: Schema.Array(OrchestrationThreadPreview),
});
export type OrchestrationGetThreadPreviewsResult = typeof OrchestrationGetThreadPreviewsResult.Type;

export class OrchestrationGetThreadPreviewsError extends Schema.TaggedError<OrchestrationGetThreadPreviewsError>()(
  "OrchestrationGetThreadPreviewsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
