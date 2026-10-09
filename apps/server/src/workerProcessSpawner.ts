import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import type * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeWorkerThreads from "node:worker_threads";
import {
  HostProcessEnvironment,
  HostProcessPlatform,
  WorkerProcessSpawner,
} from "@t3tools/shared/hostProcess";

/**
 * A ChildProcessSpawner that starts processes from a worker thread.
 *
 * `child_process.spawn` is synchronous. On Windows, CreateProcess can stall for
 * seconds when the machine is busy, and every stall freezes the server's event
 * loop: health checks time out and clients show "reconnecting". Spawning from
 * a worker confines the stall to that worker.
 *
 * A worker also relays its children's output and exits, so a stalled spawn holds
 * those back too. Spawns spread over a few workers, each going to the one with the
 * fewest children, so one slow start does not queue every other git and gh call.
 *
 * Only what ProcessRunner reads is supported: piped stdin, stdout, stderr and
 * the exit code of a standard command. The server provides it on Windows;
 * everywhere else ProcessRunner keeps the in-process spawner.
 */
export { WorkerProcessSpawner };

// Plain CommonJS so it runs as an eval worker from any bundle, asar or
// single executable without a separate entry file.
const WORKER_SOURCE = String.raw`
const { parentPort } = require("node:worker_threads");
const { spawn, execFile } = require("node:child_process");
const children = new Map();
const post = (message, transfer) => parentPort.postMessage(message, transfer);
const copy = (chunk) => { const bytes = new Uint8Array(chunk.byteLength); bytes.set(chunk); return bytes; };
const forward = (id, stream, name) => {
  stream.on("data", (chunk) => { const bytes = copy(chunk); post({ type: name, id, chunk: bytes }, [bytes.buffer]); });
  stream.on("end", () => post({ type: name + "-end", id }));
  stream.on("error", () => post({ type: name + "-end", id }));
};
const describeError = (error) => ({ code: error.code, syscall: error.syscall, message: String(error.message) });
parentPort.on("message", (message) => {
  const { id } = message;
  if (message.type === "spawn") {
    let child;
    try {
      child = spawn(message.command, message.args, message.options);
    } catch (error) {
      post({ type: "spawn-error", id, error: describeError(error) });
      return;
    }
    children.set(id, child);
    let spawned = false;
    child.on("spawn", () => { spawned = true; post({ type: "spawned", id, pid: child.pid }); });
    child.on("error", (error) => { if (!spawned) post({ type: "spawn-error", id, error: describeError(error) }); });
    child.on("exit", (code, signal) => post({ type: "exit", id, code, signal }));
    child.on("close", () => children.delete(id));
    child.stdin.on("error", () => {});
    forward(id, child.stdout, "stdout");
    forward(id, child.stderr, "stderr");
    return;
  }
  const child = children.get(id);
  if (!child) {
    if (message.type === "stdin-end") post({ type: "stdin-done", id });
    if (message.type === "kill") post({ type: "killed", id });
    return;
  }
  if (message.type === "stdin") {
    child.stdin.write(message.chunk);
  } else if (message.type === "stdin-end") {
    child.stdin.end((error) => post({ type: "stdin-done", id, error: error ? describeError(error) : undefined }));
  } else if (message.type === "kill") {
    const done = () => post({ type: "killed", id });
    if (child.exitCode !== null || child.signalCode !== null) return done();
    if (process.platform === "win32" && child.pid !== undefined) {
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, (error) => {
        if (error) child.kill();
        done();
      });
    } else {
      child.kill(message.signal);
      done();
    }
  }
});
`;

interface WorkerError {
  readonly code?: string | undefined;
  readonly syscall?: string | undefined;
  readonly message: string;
}

type WorkerMessage =
  | { readonly type: "spawned"; readonly id: number; readonly pid: number }
  | { readonly type: "spawn-error"; readonly id: number; readonly error: WorkerError }
  | {
      readonly type: "exit";
      readonly id: number;
      readonly code: number | null;
      readonly signal: string | null;
    }
  | { readonly type: "stdout" | "stderr"; readonly id: number; readonly chunk: Uint8Array }
  | { readonly type: "stdout-end" | "stderr-end" | "killed"; readonly id: number }
  | { readonly type: "stdin-done"; readonly id: number; readonly error?: WorkerError | undefined };

interface ChildEntry {
  /** The worker that spawned the child, which every later message for it goes to. */
  readonly slot: Slot;
  readonly spawned: Deferred.Deferred<number, WorkerError>;
  readonly exited: Deferred.Deferred<readonly [code: number | null, signal: string | null]>;
  readonly stdinDone: Deferred.Deferred<void, WorkerError>;
  readonly killed: Deferred.Deferred<void>;
  readonly stdout: Queue.Queue<Uint8Array, Cause.Done>;
  readonly stderr: Queue.Queue<Uint8Array, Cause.Done>;
}

// Same errno mapping as @effect/platform-node's spawner, so callers that match
// on reason tags (for example a missing `gh` as NotFound) behave the same.
interface Slot {
  worker: NodeWorkerThreads.Worker | undefined;
  /** Children spawned here that have not been released. */
  children: number;
}

const errnoTag = (code: string | undefined): PlatformError.SystemErrorTag => {
  switch (code) {
    case "ENOENT":
      return "NotFound";
    case "EACCES":
      return "PermissionDenied";
    case "EEXIST":
      return "AlreadyExists";
    case "EISDIR":
    case "ENOTDIR":
    case "ELOOP":
      return "BadResource";
    case "EBUSY":
      return "Busy";
    default:
      return "Unknown";
  }
};

const toPlatformError = (
  method: string,
  error: WorkerError,
  command: ChildProcess.StandardCommand,
): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: errnoTag(error.code),
    module: "ChildProcess",
    method,
    pathOrDescriptor: `${command.command} ${command.args.join(" ")}`,
    syscall: error.syscall,
    cause: Object.assign(new Error(error.message), { code: error.code, syscall: error.syscall }),
  });

/** Workers to spread spawns over; each is started on first use. */
const WORKER_COUNT = 4;

const unsupported = (feature: string) =>
  new Error(`WorkerProcessSpawner does not support ${feature}`);

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const hostEnv = yield* HostProcessEnvironment;
  const entries = new Map<number, ChildEntry>();
  let nextId = 0;
  const slots: ReadonlyArray<Slot> = Array.from({ length: WORKER_COUNT }, () => ({
    worker: undefined,
    children: 0,
  }));

  const release = (id: number) => {
    const entry = entries.get(id);
    if (entry === undefined) return;
    entries.delete(id);
    entry.slot.children -= 1;
  };

  const failAll = (slot: Slot, reason: string) => {
    const error: WorkerError = { message: reason };
    for (const [id, entry] of entries) {
      if (entry.slot !== slot) continue;
      Deferred.doneUnsafe(entry.spawned, Effect.fail(error));
      Deferred.doneUnsafe(entry.exited, Effect.succeed([null, "SIGKILL"] as const));
      Deferred.doneUnsafe(entry.stdinDone, Effect.void);
      Deferred.doneUnsafe(entry.killed, Effect.void);
      Queue.endUnsafe(entry.stdout);
      Queue.endUnsafe(entry.stderr);
      release(id);
    }
  };

  const onMessage = (message: WorkerMessage) => {
    const entry = entries.get(message.id);
    if (!entry) return;
    switch (message.type) {
      case "spawned":
        Deferred.doneUnsafe(entry.spawned, Effect.succeed(message.pid));
        return;
      case "spawn-error":
        Deferred.doneUnsafe(entry.spawned, Effect.fail(message.error));
        return;
      case "exit":
        Deferred.doneUnsafe(entry.exited, Effect.succeed([message.code, message.signal] as const));
        return;
      case "stdout":
      case "stderr":
        Queue.offerUnsafe(entry[message.type], message.chunk);
        return;
      case "stdout-end":
        Queue.endUnsafe(entry.stdout);
        return;
      case "stderr-end":
        Queue.endUnsafe(entry.stderr);
        return;
      case "killed":
        Deferred.doneUnsafe(entry.killed, Effect.void);
        return;
      case "stdin-done":
        Deferred.doneUnsafe(
          entry.stdinDone,
          message.error ? Effect.fail(message.error) : Effect.void,
        );
        return;
    }
  };

  const workerOf = (slot: Slot) => {
    if (slot.worker) return slot.worker;
    const created = new NodeWorkerThreads.Worker(WORKER_SOURCE, { eval: true });
    // Never keep the server alive just for an idle spawner.
    created.unref();
    created.on("message", onMessage);
    const lost = (reason: string) => {
      if (slot.worker === created) slot.worker = undefined;
      failAll(slot, reason);
    };
    created.on("error", (error) => lost(`Process spawner worker failed: ${error.message}`));
    created.on("exit", (code) => lost(`Process spawner worker exited with code ${code}`));
    slot.worker = created;
    return created;
  };

  // The worker with the fewest children, so a slot stuck in a slow spawn stops taking more.
  const leastBusy = () =>
    slots.reduce((best, slot) => (slot.children < best.children ? slot : best));

  yield* Effect.addFinalizer(() =>
    Effect.promise(() =>
      Promise.all(
        slots.map(async (slot) => {
          const current = slot.worker;
          slot.worker = undefined;
          if (current) await current.terminate();
        }),
      ),
    ),
  );

  const post = (slot: Slot, message: unknown, transfer?: ReadonlyArray<ArrayBuffer>) =>
    workerOf(slot).postMessage(message, transfer as ArrayBuffer[] | undefined);

  // Kill the tree if still running, then wait up to a second for the exit, as
  // the in-process spawner does on Windows. The wait starts once taskkill has
  // finished, since taskkill is itself a process start that can stall.
  const terminate = (id: number, entry: ChildEntry, signal: NodeJS.Signals) =>
    Effect.gen(function* () {
      if (yield* Deferred.isDone(entry.exited)) return;
      post(entry.slot, { type: "kill", id, signal });
      yield* Deferred.await(entry.killed).pipe(Effect.timeoutOption(Duration.seconds(10)));
      yield* Deferred.await(entry.exited).pipe(Effect.timeoutOption(Duration.seconds(1)));
    });

  const spawn = Effect.fnUntraced(function* (command: ChildProcess.Command) {
    if (command._tag !== "StandardCommand") {
      return yield* Effect.die(unsupported("piped commands"));
    }
    const options = command.options;
    if (options.stdin !== undefined && options.stdin !== "pipe") {
      return yield* Effect.die(unsupported("stdin other than a pipe"));
    }
    if (options.stdout !== undefined || options.stderr !== undefined || options.additionalFds) {
      return yield* Effect.die(unsupported("custom stdio"));
    }

    let cwd: string | undefined;
    if (options.cwd !== undefined) {
      yield* fs.access(options.cwd);
      cwd = path.resolve(options.cwd);
    }
    // The worker's process.env is a snapshot from its creation; always send the parent's.
    const env = options.extendEnv ? { ...hostEnv, ...options.env } : (options.env ?? hostEnv);
    const detached = options.detached ?? platform !== "win32";
    const killSignal = options.killSignal ?? "SIGTERM";

    const id = nextId++;
    const entry: ChildEntry = {
      slot: leastBusy(),
      spawned: yield* Deferred.make<number, WorkerError>(),
      exited: yield* Deferred.make<readonly [number | null, string | null]>(),
      stdinDone: yield* Deferred.make<void, WorkerError>(),
      killed: yield* Deferred.make<void>(),
      stdout: yield* Queue.unbounded<Uint8Array, Cause.Done>(),
      stderr: yield* Queue.unbounded<Uint8Array, Cause.Done>(),
    };

    const pid = yield* Effect.acquireRelease(
      Effect.suspend(() => {
        entries.set(id, entry);
        entry.slot.children += 1;
        post(entry.slot, {
          type: "spawn",
          id,
          command: command.command,
          args: command.args,
          options: {
            cwd,
            env,
            stdio: "pipe",
            detached,
            shell: options.shell,
            windowsHide: options.windowsHide ?? !detached,
          },
        });
        return Deferred.await(entry.spawned).pipe(
          Effect.mapError((error) => toPlatformError("spawn", error, command)),
          Effect.tapError(() => Effect.sync(() => release(id))),
        );
      }),
      () => terminate(id, entry, killSignal).pipe(Effect.ensuring(Effect.sync(() => release(id)))),
    );

    const exitCode = Effect.flatMap(Deferred.await(entry.exited), ([code, signal]) =>
      code !== null
        ? Effect.succeed(ChildProcessSpawner.ExitCode(code))
        : Effect.fail(
            toPlatformError(
              "exitCode",
              { message: `Process interrupted due to receipt of signal: '${signal}'` },
              command,
            ),
          ),
    );

    const stdin = Sink.forEach((chunk: Uint8Array) =>
      Effect.sync(() => {
        const bytes = chunk.slice();
        post(entry.slot, { type: "stdin", id, chunk: bytes }, [bytes.buffer]);
      }),
    ).pipe(
      Sink.mapEffect(() =>
        Effect.suspend(() => {
          post(entry.slot, { type: "stdin-end", id });
          return Deferred.await(entry.stdinDone).pipe(
            Effect.mapError((error) => toPlatformError("stdin", error, command)),
          );
        }),
      ),
    );

    return ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(pid),
      exitCode,
      isRunning: Effect.map(Deferred.isDone(entry.exited), (done) => !done),
      kill: (killOptions) => terminate(id, entry, killOptions?.killSignal ?? killSignal),
      stdin,
      stdout: Stream.fromQueue(entry.stdout),
      stderr: Stream.fromQueue(entry.stderr),
      all: Stream.die(unsupported("the combined output stream")),
      getInputFd: () => Sink.die(unsupported("additional file descriptors")),
      getOutputFd: () => Stream.die(unsupported("additional file descriptors")),
      unref: Effect.die(unsupported("unref")),
    });
  });

  return ChildProcessSpawner.make(spawn);
});

/** Provides WorkerProcessSpawner on Windows, where a blocking spawn freezes the server. */
export const layer = Layer.effect(
  WorkerProcessSpawner,
  Effect.gen(function* () {
    const platform = yield* HostProcessPlatform;
    if (platform !== "win32") return undefined;
    return yield* make;
  }),
);
