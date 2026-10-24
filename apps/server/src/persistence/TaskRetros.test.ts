import { expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, type TaskRetro, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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
