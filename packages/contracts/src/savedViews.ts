import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/**
 * Saved thread views, stored as one array in server settings so every device sees them.
 * Property, operator and grouping ids are plain strings, not literal unions, so a client
 * ignores ids from a newer client instead of failing to decode the whole settings file.
 */
const KNOWN_SAVED_VIEW_LAYOUTS = ["list", "board", "gallery", "table", "threads"] as const;
export const SavedViewLayout = Schema.Literals(KNOWN_SAVED_VIEW_LAYOUTS);
export type SavedViewLayout = typeof SavedViewLayout.Type;

/** A layout from a newer build decodes as a list instead of failing the whole view. */
const ForwardCompatibleSavedViewLayout = Schema.String.pipe(
  Schema.decodeTo(
    SavedViewLayout,
    SchemaTransformation.transform({
      decode: (layout): SavedViewLayout =>
        (KNOWN_SAVED_VIEW_LAYOUTS as readonly string[]).includes(layout)
          ? (layout as SavedViewLayout)
          : "list",
      encode: (layout) => layout,
    }),
  ),
);

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

/**
 * Sort as the sidebar stores it. The field is a plain string (the web side
 * validates it against its sidebar sort fields) so a newer field never fails
 * the decode.
 */
export const SavedViewThreadsSort = Schema.Struct({
  field: Schema.String,
  reversed: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type SavedViewThreadsSort = typeof SavedViewThreadsSort.Type;

/** Options of the threads layout, the sidebar's arrangement as a saved view. */
export const SavedViewThreadsOptions = Schema.Struct({
  sort: SavedViewThreadsSort.pipe(
    Schema.withDecodingDefault(Effect.succeed({ field: "manual", reversed: false })),
  ),
  projectSort: SavedViewThreadsSort.pipe(
    Schema.withDecodingDefault(Effect.succeed({ field: "activity", reversed: false })),
  ),
  pinsStayGrouped: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type SavedViewThreadsOptions = typeof SavedViewThreadsOptions.Type;

export const SavedView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  layout: ForwardCompatibleSavedViewLayout,
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
  threads: SavedViewThreadsOptions.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({
        sort: { field: "manual", reversed: false },
        projectSort: { field: "activity", reversed: false },
        pinsStayGrouped: false,
      }),
    ),
  ),
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
