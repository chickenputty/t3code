import {
  CommandId,
  EventId,
  type MessageId,
  type OrchestrationAutorenameProjectThreadsResult,
  type ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ThreadTitleManager,
  type ThreadTitleManagerShape,
} from "../Services/ThreadTitleManager.ts";

type SkippedReason = "no-user-messages" | "unchanged" | "up-to-date";
type UserMessageContext = {
  readonly id: MessageId;
  readonly text: string;
};
type AutorenameCache = {
  readonly lastUserMessageId: string;
};

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

function normalizeUserMessages(
  messages: ReadonlyArray<{
    readonly id: MessageId;
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
  }>,
): UserMessageContext[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => ({
      id: message.id,
      text: message.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((message) => message.text.length > 0);
}

function readAutorenameCache(
  activities: ReadonlyArray<{
    readonly kind: string;
    readonly payload: unknown;
  }>,
): AutorenameCache | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== "thread.autorename.completed") {
      continue;
    }
    if (
      typeof activity.payload !== "object" ||
      activity.payload === null ||
      !("lastUserMessageId" in activity.payload) ||
      typeof activity.payload.lastUserMessageId !== "string"
    ) {
      continue;
    }
    return {
      lastUserMessageId: activity.payload.lastUserMessageId,
    };
  }

  return null;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const textGeneration = yield* TextGeneration;

  const autorenameProjectThreads: ThreadTitleManagerShape["autorenameProjectThreads"] = (
    projectId,
  ) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const project = readModel.projects.find(
        (entry) => entry.id === projectId && entry.deletedAt === null,
      );

      if (!project) {
        return {
          renamed: [],
          skipped: [],
          failed: [],
        };
      }

      const renamed: Array<{ threadId: ThreadId; title: string }> = [];
      const skipped: Array<{ threadId: ThreadId; reason: SkippedReason }> = [];
      const failed: Array<{ threadId: ThreadId; message: string }> = [];

      const threads = readModel.threads.filter(
        (thread) => thread.projectId === projectId && thread.deletedAt === null,
      );

      for (const thread of threads) {
        const userMessages = normalizeUserMessages(thread.messages);
        if (userMessages.length === 0) {
          skipped.push({ threadId: thread.id, reason: "no-user-messages" });
          continue;
        }
        const latestUserMessage = userMessages.at(-1);
        if (!latestUserMessage) {
          skipped.push({ threadId: thread.id, reason: "no-user-messages" });
          continue;
        }

        const autorenameCache = readAutorenameCache(thread.activities);
        if (autorenameCache?.lastUserMessageId === latestUserMessage.id) {
          skipped.push({ threadId: thread.id, reason: "up-to-date" });
          continue;
        }

        const cwd =
          resolveThreadWorkspaceCwd({
            thread,
            projects: readModel.projects,
          }) ?? project.workspaceRoot;

        const titleResult = yield* textGeneration
          .generateThreadTitle({
            cwd,
            currentTitle: thread.title,
            originalMessage: userMessages[0]?.text ?? thread.title,
            recentMessages: userMessages.map((message) => message.text),
          })
          .pipe(
            Effect.map(
              (result) =>
                ({
                  ok: true,
                  title: result.title.trim(),
                }) as const,
            ),
            Effect.catch((error) =>
              Effect.succeed({
                ok: false,
                error: error.message,
              } as const),
            ),
          );

        if (!titleResult.ok) {
          failed.push({
            threadId: thread.id,
            message: titleResult.error,
          });
          continue;
        }
        const generatedTitle = titleResult.title;

        if (generatedTitle === thread.title) {
          skipped.push({ threadId: thread.id, reason: "unchanged" });
          continue;
        }

        const dispatchResult = yield* orchestrationEngine
          .dispatch({
            type: "thread.meta.update",
            commandId: serverCommandId("thread-autorename"),
            threadId: thread.id,
            title: generatedTitle,
          })
          .pipe(
            Effect.as({ ok: true } as const),
            Effect.catch((error) =>
              Effect.succeed({
                ok: false,
                error: error.message,
              } as const),
            ),
          );

        if (!dispatchResult.ok) {
          failed.push({
            threadId: thread.id,
            message: dispatchResult.error,
          });
          continue;
        }

        renamed.push({
          threadId: thread.id,
          title: generatedTitle,
        });

        const createdAt = new Date().toISOString();
        yield* orchestrationEngine
          .dispatch({
            type: "thread.activity.append",
            commandId: serverCommandId("thread-autorename-cache"),
            threadId: thread.id,
            activity: {
              id: EventId.makeUnsafe(crypto.randomUUID()),
              tone: "info",
              kind: "thread.autorename.completed",
              summary: "Auto-renamed thread title",
              payload: {
                title: generatedTitle,
                lastUserMessageId: latestUserMessage.id,
              },
              turnId: null,
              createdAt,
            },
            createdAt,
          })
          .pipe(Effect.catch(() => Effect.void));
      }

      return {
        renamed,
        skipped,
        failed,
      } satisfies OrchestrationAutorenameProjectThreadsResult;
    });

  return {
    autorenameProjectThreads,
  } satisfies ThreadTitleManagerShape;
});

export const ThreadTitleManagerLive = Layer.effect(ThreadTitleManager, make);
