import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { type ProjectId, TaskRetro, ThreadId } from "@t3tools/contracts";

import {
  PersistenceDecodeError,
  PersistenceSqlError,
  type TaskRetroRepositoryError,
} from "./Errors.ts";

const RetroRow = Schema.Struct({ retro: Schema.fromJsonString(TaskRetro) });

const ListRequest = Schema.Struct({
  projectId: Schema.NullOr(Schema.String),
  since: Schema.NullOr(Schema.String),
});

const mapError = (operation: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? PersistenceDecodeError.fromSchemaError("TaskRetro", cause)
    : new PersistenceSqlError({ operation, cause });

export class TaskRetroRepository extends Context.Service<
  TaskRetroRepository,
  {
    readonly get: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<TaskRetro>, TaskRetroRepositoryError>;
    /** Replaces the thread's retro: a new run supersedes the last, and resolving updates it. */
    readonly put: (retro: TaskRetro) => Effect.Effect<void, TaskRetroRepositoryError>;
    readonly list: (filter: {
      readonly projectId?: ProjectId | undefined;
      readonly since?: string | undefined;
    }) => Effect.Effect<ReadonlyArray<TaskRetro>, TaskRetroRepositoryError>;
  }
>()("t3/persistence/TaskRetros/TaskRetroRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const findRetro = SqlSchema.findOneOption({
    Request: Schema.Struct({ threadId: ThreadId }),
    Result: RetroRow,
    execute: ({ threadId }) =>
      sql`SELECT retro_json AS "retro" FROM thread_task_retros WHERE thread_id = ${threadId}`,
  });
  const listRetros = SqlSchema.findAll({
    Request: ListRequest,
    Result: RetroRow,
    execute: ({ projectId, since }) =>
      sql`
        SELECT retro_json AS "retro" FROM thread_task_retros
        WHERE (${projectId} IS NULL OR project_id = ${projectId})
          AND (${since} IS NULL OR created_at >= ${since})
        ORDER BY created_at DESC
      `,
  });
  const encodeRetro = Schema.encodeEffect(Schema.fromJsonString(TaskRetro));

  return TaskRetroRepository.of({
    get: Effect.fn("TaskRetroRepository.get")(function* (threadId) {
      const row = yield* findRetro({ threadId }).pipe(Effect.mapError(mapError("getTaskRetro")));
      return Option.map(row, ({ retro }) => retro);
    }),
    put: Effect.fn("TaskRetroRepository.put")(function* (retro) {
      const retroJson = yield* encodeRetro(retro).pipe(
        Effect.mapError((cause) => PersistenceDecodeError.fromSchemaError("TaskRetro", cause)),
      );
      yield* sql`
        INSERT INTO thread_task_retros (thread_id, project_id, created_at, retro_json)
        VALUES (${retro.threadId}, ${retro.projectId}, ${retro.createdAt}, ${retroJson})
        ON CONFLICT (thread_id) DO UPDATE SET
          project_id = excluded.project_id,
          created_at = excluded.created_at,
          retro_json = excluded.retro_json
      `.pipe(Effect.mapError(mapError("putTaskRetro")));
    }),
    list: Effect.fn("TaskRetroRepository.list")(function* (filter) {
      const rows = yield* listRetros({
        projectId: filter.projectId ?? null,
        since: filter.since ?? null,
      }).pipe(Effect.mapError(mapError("listTaskRetros")));
      return rows.map(({ retro }) => retro);
    }),
  });
});

export const layer = Layer.effect(TaskRetroRepository, make);
