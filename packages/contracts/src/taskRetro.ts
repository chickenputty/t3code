import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { LedgerVerdictJudge } from "./ledger.ts";
import { LoadoutId, LoadoutRoleName } from "./loadout.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * The helper thread a retro runs in. Clients leave its approval requests out of the subject
 * thread's "subagent needs approval" prompt: nobody should grant tool access to a retro.
 */
export const RETRO_THREAD_ID_PREFIX = "thread:retro:";

/** Whether the task wanted less agent structure than it had, the same, or more. */
export const RetroStructureVerdict = Schema.Literals(["less", "same", "more"]);
export type RetroStructureVerdict = typeof RetroStructureVerdict.Type;

export const RetroModelVerdictKind = Schema.Literals(["right", "too_weak", "too_strong"]);
export type RetroModelVerdictKind = typeof RetroModelVerdictKind.Type;

export const RetroModelVerdict = Schema.Struct({
  /** A loadout role name, or "thread" for the thread's own model. */
  role: TrimmedNonEmptyString,
  verdict: RetroModelVerdictKind,
  note: Schema.String,
});
export type RetroModelVerdict = typeof RetroModelVerdict.Type;

export const RetroRecommendationStatus = Schema.Literals(["pending", "applied", "dismissed"]);
export type RetroRecommendationStatus = typeof RetroRecommendationStatus.Type;

const recommendationBase = {
  /** Assigned by the server, so a model cannot choose an id that collides or is guessed. */
  id: TrimmedNonEmptyString,
  note: Schema.String,
  status: RetroRecommendationStatus,
};

/**
 * What a person can apply. Two shapes only: run this thread under another loadout, or change one
 * role of a loadout in the project's settings. Anything the retro asks for beyond these is prose.
 */
export const RetroRecommendation = Schema.Union([
  Schema.Struct({
    ...recommendationBase,
    kind: Schema.Literal("thread_loadout"),
    loadoutId: LoadoutId,
  }),
  Schema.Struct({
    ...recommendationBase,
    kind: Schema.Literal("role_model"),
    loadoutId: LoadoutId,
    role: LoadoutRoleName,
    instanceId: ProviderInstanceId,
    model: TrimmedNonEmptyString,
    effort: Schema.optionalKey(TrimmedNonEmptyString),
  }),
]);
export type RetroRecommendation = typeof RetroRecommendation.Type;

/** One retro per thread; running it again replaces the stored one. */
export const TaskRetro = Schema.Struct({
  threadId: ThreadId,
  /**
   * How many times this thread has been retro'd. It is part of the private operation key, so a
   * retry of a run that stored nothing rejoins the same retro thread and a new run starts a new one.
   */
  run: PositiveInt,
  projectId: ProjectId,
  createdAt: IsoDateTime,
  /** What actually ran the retro, read back from the delegated task. */
  judge: LedgerVerdictJudge,
  /** The model's prose answer, kept even when its JSON block could not be read. */
  summary: Schema.String,
  /** False when the answer had no readable JSON block; the fields below are then empty. */
  parsed: Schema.Boolean,
  slowCauses: Schema.Array(Schema.String),
  modelVerdicts: Schema.Array(RetroModelVerdict),
  structure: Schema.NullOr(RetroStructureVerdict),
  recommendations: Schema.Array(RetroRecommendation),
});
export type TaskRetro = typeof TaskRetro.Type;

const Count = NonNegativeInt;

/** Pure aggregation of stored retros: no model is asked anything to build it. */
export const TaskRetroRollup = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
  since: Schema.NullOr(IsoDateTime),
  retros: Count,
  /** Retros whose answer could not be read count here, under `unknown`. */
  structure: Schema.Struct({ less: Count, same: Count, more: Count, unknown: Count }),
  slowCauses: Schema.Array(Schema.Struct({ cause: Schema.String, count: Count })),
  modelVerdicts: Schema.Array(
    Schema.Struct({ role: Schema.String, verdict: RetroModelVerdictKind, count: Count }),
  ),
});
export type TaskRetroRollup = typeof TaskRetroRollup.Type;

export const OrchestrationGetTaskRetroInput = Schema.Struct({ threadId: ThreadId });
export type OrchestrationGetTaskRetroInput = typeof OrchestrationGetTaskRetroInput.Type;

export const OrchestrationResolveTaskRetroInput = Schema.Struct({
  threadId: ThreadId,
  recommendationId: TrimmedNonEmptyString,
  action: Schema.Literals(["apply", "dismiss"]),
});
export type OrchestrationResolveTaskRetroInput = typeof OrchestrationResolveTaskRetroInput.Type;

export class OrchestrationTaskRetroError extends Schema.TaggedError<OrchestrationTaskRetroError>()(
  "OrchestrationTaskRetroError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
