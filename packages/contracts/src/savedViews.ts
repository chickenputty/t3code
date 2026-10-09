import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Saved thread views: Notion-style list, board, gallery and table layouts
 * over the thread shells a client already holds. Stored as one array in the
 * server settings so every device on that server sees the same views.
 *
 * Property, operator and grouping ids are plain strings rather than literal
 * unions: a client meets ids from a newer client and ignores what it does
 * not know instead of failing to decode the whole settings file.
 */
export const SavedViewLayout = Schema.Literals(["list", "board", "gallery", "table"]);
export type SavedViewLayout = typeof SavedViewLayout.Type;

export const SavedViewOpenMode = Schema.Literals(["peek", "modal", "page"]);
export type SavedViewOpenMode = typeof SavedViewOpenMode.Type;

export const SavedViewCardSize = Schema.Literals(["small", "medium", "large"]);
export type SavedViewCardSize = typeof SavedViewCardSize.Type;

export const SavedViewPreview = Schema.Literals(["none", "first", "last"]);
export type SavedViewPreview = typeof SavedViewPreview.Type;

export const SavedViewDensity = Schema.Literals(["compact", "comfortable"]);
export type SavedViewDensity = typeof SavedViewDensity.Type;

export const SavedViewFilterCondition = Schema.Struct({
  property: Schema.String,
  operator: Schema.String,
  /** Text, a list of enum values, a boolean, or a day count, per operator. */
  value: Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)]),
});
export type SavedViewFilterCondition = typeof SavedViewFilterCondition.Type;

export const SavedViewFilter = Schema.Struct({
  conjunction: Schema.Literals(["and", "or"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("and" as const)),
  ),
  conditions: Schema.Array(SavedViewFilterCondition).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type SavedViewFilter = typeof SavedViewFilter.Type;

export const SavedViewSort = Schema.Struct({
  property: Schema.String,
  direction: Schema.Literals(["asc", "desc"]),
});
export type SavedViewSort = typeof SavedViewSort.Type;

export const SavedView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  layout: SavedViewLayout,
  filter: SavedViewFilter.pipe(
    Schema.withDecodingDefault(Effect.succeed({ conjunction: "and" as const, conditions: [] })),
  ),
  sorts: Schema.Array(SavedViewSort).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  groupBy: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** Shown on cards and as table columns, in this order. */
  properties: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  cardSize: SavedViewCardSize.pipe(Schema.withDecodingDefault(Effect.succeed("medium" as const))),
  preview: SavedViewPreview.pipe(Schema.withDecodingDefault(Effect.succeed("last" as const))),
  density: SavedViewDensity.pipe(
    Schema.withDecodingDefault(Effect.succeed("comfortable" as const)),
  ),
  showArchived: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  showSettled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Sub-agent threads stay hidden unless this is on, as in the sidebar. */
  showSubagents: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  hideEmptyGroups: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  openMode: SavedViewOpenMode.pipe(Schema.withDecodingDefault(Effect.succeed("peek" as const))),
});
export type SavedView = typeof SavedView.Type;

/** A header the user made to file threads under, across projects. */
export const ThreadCategory = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});
export type ThreadCategory = typeof ThreadCategory.Type;

/**
 * Custom categories, shared by every view. A thread is in at most one; views
 * grouped by project show each category beside the projects and take its
 * threads out of their project.
 */
export const ThreadCategories = Schema.Struct({
  categories: Schema.Array(ThreadCategory).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Scoped thread key (environment and thread id) to category id. */
  assignments: Schema.Record(Schema.String, Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type ThreadCategories = typeof ThreadCategories.Type;
