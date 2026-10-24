import {
  CommandId,
  type LoadoutRole,
  type LoadoutRoleName,
  type ModelSelection,
  RETRO_THREAD_ID_PREFIX,
  MessageId,
  type ProjectId,
  type ServerSettings as ServerSettingsValue,
  type TaskRetro,
  type TaskRetroRollup,
  ThreadId,
} from "@t3tools/contracts";
import { loadoutDelegationTarget, resolveLoadout, withSolo } from "@t3tools/shared/loadouts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import * as TaskRetros from "../persistence/TaskRetros.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  type ResolvePorts,
  type RetroPorts,
  type RetroRun,
  type RetroSource,
  TaskRetroError,
  resolveRecommendation,
  retroCommandKey,
  retroRefusal,
  rollupRetros,
  runRetro,
  setLoadoutRole,
} from "./TaskRetro.ts";
import * as TaskTimingService from "./TaskTimingService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

/**
 * A retro is one answer to a prompt that holds everything, so a long wait means the model is
 * stuck, most likely on an approval nobody will give. Kept short so that costs minutes, not ten.
 */
const RETRO_TIMEOUT_MS = 5 * 60 * 1_000;
const RETRO_THREAD_PREFIX = RETRO_THREAD_ID_PREFIX;
const MAX_ATTEMPTS = 20;
/** A thread this young may be between its create and its send, so the sweep leaves it alone. */
const SWEEP_MIN_AGE_MS = 60_000;
const attemptDigest = (digestHex: string, attempt: number) =>
  attempt === 0 ? digestHex : `${digestHex}-${attempt}`;

/**
 * Reads a thread's timing, ledger and loadout, asks a strong model the three retro questions and
 * stores the answer. Both the MCP tools and the Activity tab go through here; neither needs the
 * thread to be running, so the retro runs in a thread of its own rather than as a delegated task.
 */
export class TaskRetroService extends Context.Service<
  TaskRetroService,
  {
    /**
     * `agent` is refused while the thread is working or was retro'd in the last ten minutes;
     * `user` is a person pressing Run retro, who is not rate-limited.
     */
    readonly run: (
      threadId: ThreadId,
      trigger: "agent" | "user",
    ) => Effect.Effect<TaskRetro, TaskRetroError>;
    /** Archives retro threads a restart or a crash left behind. Returns how many it found. */
    readonly sweep: () => Effect.Effect<number, TaskRetroError>;
    readonly get: (threadId: ThreadId) => Effect.Effect<TaskRetro | null, TaskRetroError>;
    /** Applying edits settings or the thread's loadout; dismissing changes only the retro. */
    readonly resolve: (input: {
      readonly threadId: ThreadId;
      readonly recommendationId: string;
      readonly action: "apply" | "dismiss";
    }) => Effect.Effect<TaskRetro, TaskRetroError>;
    readonly rollup: (filter: {
      readonly projectId?: ProjectId | undefined;
      readonly since?: string | undefined;
    }) => Effect.Effect<TaskRetroRollup, TaskRetroError>;
  }
>()("t3/orchestration-v2/TaskRetroService") {}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const timing = yield* TaskTimingService.TaskTimingService;
  const store = yield* TaskRetros.TaskRetroRepository;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const crypto = yield* Crypto.Crypto;

  const storeFailed = (cause: unknown) => new TaskRetroError({ reason: "store_failed", cause });
  const readFailed = (cause: unknown) => new TaskRetroError({ reason: "read_failed", cause });

  const readSettings = settingsService.getSettings.pipe(
    Effect.mapError((cause) => new TaskRetroError({ reason: "settings_failed", cause })),
  );

  const projectLoadouts = (settings: ServerSettingsValue, projectId: ProjectId) =>
    withSolo(resolveProjectSettings(settings, projectId).settings.loadouts);

  const requireThread = Effect.fn("TaskRetroService.requireThread")(function* (threadId: ThreadId) {
    const shell = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(readFailed));
    if (shell === null || shell.deletedAt !== null) {
      return yield* new TaskRetroError({ reason: "thread_not_found" });
    }
    return shell;
  });

  const delegate = Effect.fn("TaskRetroService.delegate")(function* (input: {
    readonly subjectThreadId: ThreadId;
    readonly projectId: ProjectId;
    readonly model: ModelSelection;
    readonly prompt: string;
    readonly title: string;
    readonly keySource: string;
  }) {
    const digest = yield* crypto
      .digest("SHA-256", new TextEncoder().encode(input.keySource))
      .pipe(Effect.orDie);
    const digestHex = hex(digest);
    const failed = (cause: unknown) => new TaskRetroError({ reason: "run_failed", cause });

    // Only a retro thread that is still running is rejoined. One that already ended (archived by
    // its own finish) holds a stopped run that every replayed command would hand back, so the
    // next attempt takes a new id. Attempt 0 keeps the plain digest.
    let attempt = 0;
    for (; attempt < MAX_ATTEMPTS; attempt += 1) {
      const existing = yield* threads
        .getThreadShell(ThreadId.make(`${RETRO_THREAD_PREFIX}${attemptDigest(digestHex, attempt)}`))
        .pipe(Effect.mapError(failed));
      if (existing === null || existing.activeRunId !== null) break;
    }
    if (attempt === MAX_ATTEMPTS) return yield* failed(undefined);
    const key = retroCommandKey(attemptDigest(digestHex, attempt));
    const threadId = ThreadId.make(`${RETRO_THREAD_PREFIX}${attemptDigest(digestHex, attempt)}`);

    // Every id below derives from the private key, so no client or agent can name one first.
    yield* threads
      .dispatch({
        type: "thread.create",
        createdBy: "system",
        creationSource: "server",
        commandId: CommandId.make(`${key}-create`),
        threadId,
        projectId: input.projectId,
        title: input.title,
        modelSelection: input.model,
        // The adapters give a server-created thread no way to run with tools off or to auto-deny
        // an approval, and the prompt tells the model not to use tools. Approval is required so
        // a model that ignores that cannot touch anything; the short timeout and the interrupt
        // below end the run if it then waits on an approval nobody will answer.
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        // A hidden subagent child of the thread it reviews, so it stays out of the thread lists.
        lineage: { parentThreadId: input.subjectThreadId, relationshipToParent: "subagent" },
      })
      .pipe(Effect.mapError(failed));

    // Whatever the run's outcome, the retro thread ends stopped and archived.
    const finish = Effect.fn("TaskRetroService.finish")(function* () {
      yield* threads
        .interruptThread({
          projectId: input.projectId,
          commandId: CommandId.make(`${key}-interrupt`),
          threadId,
          reason: "The retro ended.",
        })
        .pipe(Effect.ignore);
      yield* threads
        .dispatch({
          type: "thread.archive",
          commandId: CommandId.make(`${key}-archive`),
          threadId,
        })
        .pipe(Effect.ignore);
    });

    return yield* Effect.gen(function* () {
      const sent = yield* threads
        .sendToThread({
          projectId: input.projectId,
          commandId: CommandId.make(`${key}-send`),
          threadId,
          messageId: MessageId.make(`message:retro:${digestHex}`),
          text: input.prompt,
          attachments: [],
          modelSelection: input.model,
          mode: "auto",
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(Effect.mapError(failed));
      const waited = yield* threads
        .waitForThread({
          projectId: input.projectId,
          threadId,
          runId: sent.run.id,
          timeoutMs: RETRO_TIMEOUT_MS,
        })
        .pipe(Effect.mapError(failed));

      const finished = waited.run;
      const userMessages = yield* threads
        .getThreadRecords(threadId, ["messages"], { messageRoles: ["user"] })
        .pipe(
          Effect.map(({ messages }) => messages.map(({ text }) => text)),
          Effect.mapError(failed),
        );
      const answer =
        finished === null || finished.status !== "completed"
          ? null
          : yield* threads
              .getThreadRecords(threadId, ["messages"], {
                messageRoles: ["assistant"],
                messageRunIds: [finished.id],
              })
              .pipe(
                Effect.map(({ messages }) => messages.at(-1)?.text ?? null),
                Effect.mapError(failed),
              );
      const ran = finished?.modelSelection ?? input.model;
      return {
        status:
          finished?.status === "completed" ? "completed" : waited.timedOut ? "running" : "failed",
        summary: answer,
        waitTimedOut: waited.timedOut,
        ran: { instanceId: ran.instanceId, model: ran.model },
        expected: { instanceId: input.model.instanceId, model: input.model.model },
        userMessages,
      } satisfies RetroRun;
    }).pipe(Effect.onExit(() => finish()));
  });

  const run: TaskRetroService["Service"]["run"] = Effect.fn("TaskRetroService.run")(
    function* (threadId, trigger) {
      yield* Effect.annotateCurrentSpan({ threadId, trigger });
      const shell = yield* requireThread(threadId);
      const previous = Option.getOrUndefined(
        yield* store.get(threadId).pipe(Effect.mapError(storeFailed)),
      );
      if (trigger === "agent") {
        const refusal = retroRefusal({
          threadActive: shell.activeRunId !== null,
          previous,
          nowMs: DateTime.toEpochMillis(yield* DateTime.now),
        });
        if (refusal !== undefined) return yield* new TaskRetroError({ reason: refusal });
      }
      const { ledger } = yield* threads
        .getProjectThreadRecords({ projectId: shell.projectId, threadId }, ["ledger"])
        .pipe(Effect.mapError(readFailed));
      const summary = yield* timing.summary(threadId).pipe(Effect.mapError(readFailed));
      const settings = yield* readSettings;
      const available = projectLoadouts(settings, shell.projectId);
      const active = resolveLoadout(available, shell.loadout?.id);
      const providers = yield* providerRegistry.getProviders.pipe(Effect.mapError(readFailed));
      // The judge or planner is the loadout's strongest seat; with neither, the thread's own model.
      const target =
        loadoutDelegationTarget(active, "judge", providers) ??
        loadoutDelegationTarget(active, "planner", providers);
      const model: ModelSelection =
        target?.providerInstanceId === undefined || target.model === undefined
          ? shell.modelSelection
          : {
              instanceId: target.providerInstanceId,
              model: target.model,
              ...(target.options === undefined ? {} : { options: target.options }),
            };
      const source: RetroSource = {
        threadTitle: shell.title,
        timing: summary,
        ledger,
        loadout: {
          ...active,
          reason: shell.loadout?.reason ?? null,
          setBy: shell.loadout?.setBy ?? null,
        },
        available,
      };
      const ports: RetroPorts = {
        delegate: ({ prompt, title, keySource }) =>
          delegate({
            subjectThreadId: threadId,
            projectId: shell.projectId,
            model,
            prompt,
            title,
            keySource,
          }),
        save: (retro) => store.put(retro).pipe(Effect.mapError(storeFailed)),
      };
      return yield* runRetro({ threadId, projectId: shell.projectId, source, previous, ports });
    },
  );

  const sweep: TaskRetroService["Service"]["sweep"] = Effect.fn("TaskRetroService.sweep")(
    function* () {
      // A restart mid-retro leaves its thread behind with nothing left to finish it.
      const snapshot = yield* threads.getShellSnapshot().pipe(Effect.mapError(readFailed));
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      // A retro in flight is between its create and its send for a moment and has no run yet.
      const stale = snapshot.threads.filter(
        (thread) =>
          thread.id.startsWith(RETRO_THREAD_PREFIX) &&
          thread.activeRunId === null &&
          nowMs - DateTime.toEpochMillis(thread.createdAt) >= SWEEP_MIN_AGE_MS,
      );
      yield* Effect.forEach(
        stale,
        (thread) =>
          threads
            .dispatch({
              type: "thread.archive",
              commandId: CommandId.make(`command:mcp:retro:sweep-${encodeURIComponent(thread.id)}`),
              threadId: thread.id,
            })
            .pipe(Effect.ignore),
        { discard: true },
      );
      return stale.length;
    },
  );

  const get: TaskRetroService["Service"]["get"] = Effect.fn("TaskRetroService.get")(
    function* (threadId) {
      const found = yield* store.get(threadId).pipe(Effect.mapError(storeFailed));
      return Option.getOrNull(found);
    },
  );

  // Resolving reads the retro, changes a setting and writes the retro back, so two at once would
  // each write over the other's status. They are rare and quick, so one lock serves them all.
  const resolveLock = yield* Semaphore.make(1);

  const resolveOne: TaskRetroService["Service"]["resolve"] = Effect.fn(
    "TaskRetroService.resolveOne",
  )(function* (input) {
    const retro = Option.getOrUndefined(
      yield* store.get(input.threadId).pipe(Effect.mapError(storeFailed)),
    );
    if (retro === undefined) return yield* new TaskRetroError({ reason: "unknown_recommendation" });
    const settingsFailed = (cause: unknown) =>
      new TaskRetroError({ reason: "settings_failed", cause });
    const ports: ResolvePorts = {
      loadouts: readSettings.pipe(
        Effect.map((settings) => projectLoadouts(settings, retro.projectId)),
      ),
      providers: providerRegistry.getProviders.pipe(Effect.mapError(readFailed)),
      setProjectRole: Effect.fn("TaskRetroService.setProjectRole")(function* (
        loadoutId: string,
        role: LoadoutRoleName,
        value: LoadoutRole,
      ) {
        yield* settingsService
          .updateSettingsFrom((current) => {
            // The list as saved, without the synthetic solo, so the project copy never stores it.
            const { overrides, settings } = resolveProjectSettings(current, retro.projectId);
            const next = setLoadoutRole(settings.loadouts, loadoutId, role, value);
            return next === undefined
              ? Effect.fail(new TaskRetroError({ reason: "loadout_gone" }))
              : // A project entry replaces that project's whole override set, so the rest is
                // carried over; a project with none gets one holding just the edited list.
                Effect.succeed({
                  projectSettingsOverrides: {
                    [retro.projectId]: { ...overrides, loadouts: next },
                  },
                });
          })
          .pipe(
            Effect.mapError((error) =>
              error._tag === "TaskRetroError" ? error : settingsFailed(error),
            ),
          );
      }),
      setThreadLoadout: Effect.fn("TaskRetroService.setThreadLoadout")(function* (
        loadoutId: string,
        reason: string,
      ) {
        const commandId = CommandId.make(
          `retro:${yield* crypto.randomUUIDv4().pipe(Effect.orDie)}`,
        );
        yield* threads
          .dispatch({
            type: "thread.metadata.update",
            commandId,
            threadId: input.threadId,
            // The person pressed Apply, so this is their explicit choice and outranks an agent's.
            loadout: { id: loadoutId, reason, setBy: "user" },
          })
          .pipe(Effect.mapError(settingsFailed));
      }),
      save: (next) => store.put(next).pipe(Effect.mapError(storeFailed)),
    };
    return yield* resolveRecommendation({
      retro,
      recommendationId: input.recommendationId,
      action: input.action,
      ports,
    });
  });

  const resolve: TaskRetroService["Service"]["resolve"] = Effect.fn("TaskRetroService.resolve")(
    function* (input) {
      yield* Effect.annotateCurrentSpan({ threadId: input.threadId, action: input.action });
      return yield* resolveLock.withPermits(1)(resolveOne(input));
    },
  );

  const rollup: TaskRetroService["Service"]["rollup"] = Effect.fn("TaskRetroService.rollup")(
    function* (filter) {
      const retros = yield* store.list(filter).pipe(Effect.mapError(storeFailed));
      return rollupRetros(retros, { projectId: filter.projectId, since: filter.since });
    },
  );

  return TaskRetroService.of({ run, sweep, get, resolve, rollup });
});

export const layer = Layer.effect(TaskRetroService, make);
