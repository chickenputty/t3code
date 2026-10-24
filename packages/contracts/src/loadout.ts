import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const LoadoutId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type LoadoutId = typeof LoadoutId.Type;

export const LOADOUT_ROLE_NAMES = ["planner", "subPlanner", "explorer", "worker", "judge"] as const;
export const LoadoutRoleName = Schema.Literals(LOADOUT_ROLE_NAMES);
export type LoadoutRoleName = typeof LoadoutRoleName.Type;

/**
 * Where one role runs. `effort` is mapped onto whatever effort option the model advertises
 * when the role is resolved, so a loadout does not need to know each driver's option ids.
 */
export const LoadoutRole = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  effort: Schema.optionalKey(TrimmedNonEmptyString),
});
export type LoadoutRole = typeof LoadoutRole.Type;

/** A named agent structure. A role that is absent runs on the thread's own model. */
export const Loadout = Schema.Struct({
  id: LoadoutId,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  roles: Schema.Struct({
    planner: Schema.optionalKey(LoadoutRole),
    subPlanner: Schema.optionalKey(LoadoutRole),
    explorer: Schema.optionalKey(LoadoutRole),
    worker: Schema.optionalKey(LoadoutRole),
    judge: Schema.optionalKey(LoadoutRole),
  }),
});
export type Loadout = typeof Loadout.Type;

export const LoadoutSetBy = Schema.Literals(["user", "agent"]);
export type LoadoutSetBy = typeof LoadoutSetBy.Type;

/**
 * The loadout a thread runs under and why. `setBy` is what lets an explicit user choice outrank
 * an agent's later proposal.
 */
export const ThreadLoadout = Schema.Struct({
  id: LoadoutId,
  reason: Schema.NullOr(Schema.String),
  setBy: LoadoutSetBy,
});
export type ThreadLoadout = typeof ThreadLoadout.Type;

const claude = (model: string, effort?: string): LoadoutRole => ({
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model,
  ...(effort === undefined ? {} : { effort }),
});

export const SOLO_LOADOUT_ID: LoadoutId = "solo";

/**
 * Solo is the default for every thread: a solo strong model matched a full org on a four-module
 * task at a quarter of the cost, so escalating to roles has to be a deliberate choice.
 */
export const DEFAULT_LOADOUTS: ReadonlyArray<Loadout> = [
  {
    id: SOLO_LOADOUT_ID,
    name: "Solo",
    description: "One agent on the thread's own model. No delegated roles.",
    roles: {},
  },
  {
    id: "planner-workers-judge",
    name: "Planner + workers + judge",
    description:
      "A strong planner splits the task, cheaper workers implement, and a separate judge must pass each ledger item before it closes.",
    roles: {
      planner: claude("claude-opus-5-5", "xhigh"),
      worker: claude("claude-sonnet-5-5"),
      judge: claude("claude-opus-5-5", "high"),
    },
  },
  {
    id: "read-only-sweep",
    name: "Read-only sweep",
    description: "Cheap explorers read and report across the codebase. Nothing is implemented.",
    roles: { explorer: claude("claude-haiku-5-5") },
  },
];
