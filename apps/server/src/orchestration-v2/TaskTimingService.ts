import { type TaskTiming, type TaskTimingSummary, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { deriveTaskTiming, summarizeTaskTiming } from "./TaskTiming.ts";

export class TaskTimingReadError extends Schema.TaggedError<TaskTimingReadError>()(
  "TaskTimingReadError",
  {
    threadId: ThreadId,
    source: Schema.Literals(["projection", "events"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read ${this.source} for the task timing of thread ${this.threadId}.`;
  }
}

/**
 * Per-step timing of one thread, computed on read from the projection and the thread's ledger
 * events. Nothing here is stored: the event log already timestamps every step.
 */
export class TaskTimingService extends Context.Service<
  TaskTimingService,
  {
    readonly forThread: (threadId: ThreadId) => Effect.Effect<TaskTiming, TaskTimingReadError>;
    /** The record cut to its slowest steps, for agents and the Timing view. */
    readonly summary: (threadId: ThreadId) => Effect.Effect<TaskTimingSummary, TaskTimingReadError>;
  }
>()("t3/orchestration-v2/TaskTimingService") {}

const CHILD_READ_CONCURRENCY = 4;
const SUMMARY_TOP = 5;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const events = yield* EventStore.EventStoreV2;

  const forThread: TaskTimingService["Service"]["forThread"] = Effect.fn(
    "TaskTimingService.forThread",
  )(function* (threadId) {
    const now = yield* DateTime.now;
    const readError = Effect.mapError(
      (cause: ProjectionStore.ProjectionStoreV2Error) =>
        new TaskTimingReadError({ threadId, source: "projection", cause }),
    );
    const records = yield* projections
      .getThreadRecords(threadId, ["runs", "subagents", "runtimeRequests", "ledger"])
      .pipe(readError);
    // Only the source of each user message is needed, so the messages themselves stay unread.
    const userMessages = yield* projections.getUserMessageCreationSources(threadId).pipe(readError);

    const delegated = yield* Effect.forEach(
      records.subagents.filter((task) => task.origin === "app_owned"),
      (task) =>
        task.childThreadId === null
          ? Effect.succeed({ task, childRun: undefined })
          : projections.getThreadRecords(task.childThreadId, ["runs"]).pipe(
              Effect.map(({ runs }) => ({
                task,
                // A follow-up in the same child thread is a later run, not this task's.
                childRun:
                  runs.find((run) => run.delegatedTaskId === task.id) ??
                  runs.toSorted((left, right) => left.ordinal - right.ordinal)[0],
              })),
              // A deleted child thread only costs the wait time, not the whole record.
              Effect.orElseSucceed(() => ({ task, childRun: undefined })),
            ),
      { concurrency: CHILD_READ_CONCURRENCY },
    );

    // Item changes are the one thing the projection does not keep, so the event log is read for
    // them, and only for a thread that has a ledger.
    const itemUpdates =
      records.ledger === undefined
        ? []
        : (yield* events.read({ threadId, eventType: "ledger.item.updated" }).pipe(
            Stream.runCollect,
            Effect.mapError(
              (cause) => new TaskTimingReadError({ threadId, source: "events", cause }),
            ),
          )).flatMap(({ event }) =>
            event.type === "ledger.item.updated"
              ? [
                  {
                    at: event.occurredAt,
                    ledgerId: event.payload.ledgerId,
                    item: event.payload.item,
                  },
                ]
              : [],
          );

    return deriveTaskTiming({
      threadId,
      now,
      runs: records.runs,
      userMessages,
      delegated,
      runtimeRequests: records.runtimeRequests,
      ledger: records.ledger,
      itemUpdates,
    });
  });

  const summary: TaskTimingService["Service"]["summary"] = Effect.fn("TaskTimingService.summary")(
    function* (threadId) {
      return summarizeTaskTiming(yield* forThread(threadId), SUMMARY_TOP);
    },
  );

  return TaskTimingService.of({ forThread, summary });
});

export const layer = Layer.effect(TaskTimingService, make);
