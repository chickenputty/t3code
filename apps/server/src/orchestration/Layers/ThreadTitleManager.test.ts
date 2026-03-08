import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TextGeneration, type TextGenerationShape } from "../../git/Services/TextGeneration.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ThreadTitleManager } from "../Services/ThreadTitleManager.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { ThreadTitleManagerLive } from "./ThreadTitleManager.ts";

const unsupported = () => Effect.die(new Error("unsupported in thread title manager test")) as never;

describe("ThreadTitleManager", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    ThreadTitleManager | OrchestrationEngineService,
    unknown
  > | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    vi.restoreAllMocks();
  });

  async function createHarness() {
    const generateThreadTitle = vi.fn(() =>
      Effect.succeed({
        title: "Use app set threads",
      }),
    );

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );

    const layer = ThreadTitleManagerLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(
        Layer.succeed(
          TextGeneration,
          {
            generateCommitMessage: unsupported,
            generatePrContent: unsupported,
            generateBranchName: unsupported,
            generateThreadTitle,
          } as unknown as TextGenerationShape,
        ),
      ),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);
    return {
      engine: await runtime.runPromise(Effect.service(OrchestrationEngineService)),
      manager: await runtime.runPromise(Effect.service(ThreadTitleManager)),
      generateThreadTitle,
    };
  }

  it("skips regeneration when no newer user message arrived after autorename", async () => {
    const { engine, manager, generateThreadTitle } = await createHarness();
    const createdAt = new Date().toISOString();
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("thread-1");

    await runtime!.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        projectId,
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModel: "gpt-5-codex",
        createdAt,
      }),
    );
    await runtime!.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        threadId,
        projectId,
        title: "New thread",
        model: "gpt-5-codex",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await runtime!.runPromise(
      engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start"),
        threadId,
        message: {
          messageId: MessageId.makeUnsafe("message-1"),
          role: "user",
          text: "use app settings for thread naming",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        createdAt,
      }),
    );

    const firstResult = await runtime!.runPromise(manager.autorenameProjectThreads(projectId));
    expect(firstResult.renamed).toEqual([
      {
        threadId,
        title: "Use app set threads",
      },
    ]);
    expect(generateThreadTitle).toHaveBeenCalledTimes(1);

    const secondResult = await runtime!.runPromise(manager.autorenameProjectThreads(projectId));
    expect(secondResult.renamed).toEqual([]);
    expect(secondResult.skipped).toContainEqual({
      threadId,
      reason: "up-to-date",
    });
    expect(generateThreadTitle).toHaveBeenCalledTimes(1);
  });
});
