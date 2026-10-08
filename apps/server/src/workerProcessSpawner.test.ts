import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";

import * as ProcessRunner from "./processRunner.ts";
import * as WorkerProcessSpawner from "./workerProcessSpawner.ts";

// Forced on for every platform; the server only installs it on Windows.
const TestLayer = ProcessRunner.layer.pipe(
  Layer.provide(Layer.effect(WorkerProcessSpawner.WorkerProcessSpawner, WorkerProcessSpawner.make)),
  Layer.provideMerge(NodeServices.layer),
);

const node = (script: string) => ({ command: process.execPath, args: ["-e", script] });

const spawnErrorCause = (error: ProcessRunner.ProcessRunError) =>
  error._tag === "ProcessSpawnError" && PlatformError.isPlatformError(error.cause)
    ? error.cause
    : undefined;

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("WorkerProcessSpawner", () => {
  it.live("returns stdout, stderr and a non-zero exit code", () =>
    Effect.gen(function* () {
      const runner = yield* ProcessRunner.ProcessRunner;
      const result = yield* runner.run(
        node("process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"),
      );
      expect(result).toMatchObject({ stdout: "out", stderr: "err", code: 3, timedOut: false });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("pipes stdin to the child", () =>
    Effect.gen(function* () {
      const runner = yield* ProcessRunner.ProcessRunner;
      const result = yield* runner.run({
        ...node(
          "let s=''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => process.stdout.write(s.toUpperCase()))",
        ),
        stdin: "hello worker",
      });
      expect(result.stdout).toBe("HELLO WORKER");
      expect(result.code).toBe(0);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("reports a missing executable as a ChildProcess spawn NotFound", () =>
    Effect.gen(function* () {
      const runner = yield* ProcessRunner.ProcessRunner;
      const error = yield* runner
        .run({ command: "t3-definitely-missing-command", args: [] })
        .pipe(Effect.flip);
      const cause = spawnErrorCause(error);
      expect(cause?.reason).toMatchObject({
        _tag: "NotFound",
        module: "ChildProcess",
        method: "spawn",
      });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("reports a missing working directory without blaming the executable", () =>
    Effect.gen(function* () {
      const runner = yield* ProcessRunner.ProcessRunner;
      const error = yield* runner
        .run({ ...node("0"), cwd: `${process.cwd()}/t3-missing-directory` })
        .pipe(Effect.flip);
      const cause = spawnErrorCause(error);
      expect(cause).toBeDefined();
      expect(cause?.reason).not.toMatchObject({ module: "ChildProcess" });
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("keeps each child's input and output apart across the workers", () =>
    Effect.gen(function* () {
      const runner = yield* ProcessRunner.ProcessRunner;
      const results = yield* Effect.forEach(
        Array.from({ length: 12 }, (_, index) => index),
        (index) =>
          runner.run({
            ...node(
              `let s=''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => { process.stdout.write(s + ':out'); process.stderr.write(s + ':err'); process.exit(${index}) })`,
            ),
            stdin: `child-${index}`,
          }),
        { concurrency: "unbounded" },
      );
      expect(results).toEqual(
        results.map((_, index) =>
          expect.objectContaining({
            stdout: `child-${index}:out`,
            stderr: `child-${index}:err`,
            code: index,
          }),
        ),
      );
    }).pipe(Effect.provide(TestLayer)),
  );

  it.live("kills the child when the run is interrupted", () =>
    Effect.gen(function* () {
      const runner = yield* ProcessRunner.ProcessRunner;
      const started = Deferred.makeUnsafe<number>();
      const fiber = yield* runner
        .run({
          ...node("process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)"),
          onStdoutChunk: (chunk) => {
            Deferred.doneUnsafe(started, Effect.succeed(Number(new TextDecoder().decode(chunk))));
          },
        })
        .pipe(Effect.forkChild);
      const pid = yield* Deferred.await(started);
      expect(isAlive(pid)).toBe(true);
      yield* Fiber.interrupt(fiber);
      expect(isAlive(pid)).toBe(false);
    }).pipe(Effect.provide(TestLayer)),
  );
});
