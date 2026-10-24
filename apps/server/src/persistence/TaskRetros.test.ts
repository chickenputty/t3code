import { expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, type TaskRetro, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "./Sqlite.ts";
import * as TaskRetros from "./TaskRetros.ts";

const retro = (threadId: string, overrides: Partial<TaskRetro> = {}): TaskRetro => ({
  threadId: ThreadId.make(threadId),
  projectId: ProjectId.make("project:one"),
  run: 1,
  createdAt: "2026-01-02T00:00:00.000Z",
  judge: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-5-5" },
  summary: "Prose.",
  parsed: true,
  slowCauses: ["Workers waited"],
  modelVerdicts: [{ role: "worker", verdict: "too_strong", note: "" }],
  structure: "less",
  recommendations: [
    { id: "rec-1", kind: "thread_loadout", loadoutId: "solo", note: "small", status: "pending" },
  ],
  ...overrides,
});

// The rollup joins the thread projection, so a retro only counts while its thread is live.
const seedThread = (threadId: string, deleted = false) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
        created_at, updated_at, deleted_at, payload_json
      ) VALUES (
        ${threadId}, 'project:one', 't', 'codex', 'full-access', 'default',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
        ${deleted ? "2026-01-03T00:00:00.000Z" : null}, '{}'
      )
    `;
  });

const layer = TaskRetros.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

it.effect("a stored retro reads back whole", () =>
  Effect.gen(function* () {
    const repository = yield* TaskRetros.TaskRetroRepository;
    expect(Option.isNone(yield* repository.get(ThreadId.make("thread:a")))).toBe(true);
    yield* repository.put(retro("thread:a"));
    expect(yield* repository.get(ThreadId.make("thread:a"))).toEqual(
      Option.some(retro("thread:a")),
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("saving again replaces the thread's retro, so resolving a recommendation sticks", () =>
  Effect.gen(function* () {
    const repository = yield* TaskRetros.TaskRetroRepository;
    yield* seedThread("thread:a");
    yield* repository.put(retro("thread:a"));
    const resolved = retro("thread:a", {
      run: 2,
      recommendations: [
        {
          id: "rec-1",
          kind: "thread_loadout",
          loadoutId: "solo",
          note: "small",
          status: "applied",
        },
      ],
    });
    yield* repository.put(resolved);
    expect(yield* repository.get(ThreadId.make("thread:a"))).toEqual(Option.some(resolved));
    expect(yield* repository.list({})).toHaveLength(1);
  }).pipe(Effect.provide(layer)),
);

it.effect("listing filters by project and by when the retro was made", () =>
  Effect.gen(function* () {
    const repository = yield* TaskRetros.TaskRetroRepository;
    for (const id of ["thread:old", "thread:new", "thread:other"]) yield* seedThread(id);
    yield* repository.put(retro("thread:old", { createdAt: "2026-01-01T00:00:00.000Z" }));
    yield* repository.put(retro("thread:new", { createdAt: "2026-02-01T00:00:00.000Z" }));
    yield* repository.put(
      retro("thread:other", {
        projectId: ProjectId.make("project:two"),
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    );
    const ids = (retros: ReadonlyArray<TaskRetro>) =>
      retros.map(({ threadId }) => threadId).toSorted();
    expect(ids(yield* repository.list({}))).toEqual(["thread:new", "thread:old", "thread:other"]);
    expect(ids(yield* repository.list({ projectId: ProjectId.make("project:one") }))).toEqual([
      "thread:new",
      "thread:old",
    ]);
    expect(ids(yield* repository.list({ since: "2026-01-15T00:00:00.000Z" }))).toEqual([
      "thread:new",
      "thread:other",
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("listing leaves out the retro of a deleted thread but get still finds it", () =>
  Effect.gen(function* () {
    const repository = yield* TaskRetros.TaskRetroRepository;
    yield* seedThread("thread:live");
    yield* seedThread("thread:gone", true);
    yield* repository.put(retro("thread:live"));
    yield* repository.put(retro("thread:gone"));
    expect((yield* repository.list({})).map(({ threadId }) => threadId)).toEqual(["thread:live"]);
    expect(Option.isSome(yield* repository.get(ThreadId.make("thread:gone")))).toBe(true);
  }).pipe(Effect.provide(layer)),
);
