import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { buildInspectorModel, formatDuration, formatTokens } from "./inspectorModel";

const at = (second: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 9, 12, 0, second));

function projection(overrides: Partial<Record<keyof OrchestrationV2ThreadProjection, unknown>>) {
  return {
    runs: [],
    attempts: [],
    providerTurns: [],
    providerThreads: [],
    messages: [],
    turnItems: [],
    checkpoints: [],
    ...overrides,
  } as unknown as OrchestrationV2ThreadProjection;
}

describe("buildInspectorModel", () => {
  it("orders user and assistant messages and drops system and empty ones", () => {
    const model = buildInspectorModel(
      projection({
        messages: [
          { id: "m2", role: "assistant", text: "Done.", createdAt: at(5), runId: "r1" },
          { id: "m0", role: "system", text: "setup", createdAt: at(0), runId: null },
          { id: "m1", role: "user", text: "Fix the bug", createdAt: at(1), runId: "r1" },
          { id: "m3", role: "assistant", text: "   ", createdAt: at(6), runId: "r1" },
        ],
      }),
    );
    expect(model.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(model.firstUserMessage).toBe("Fix the bug");
  });

  it("totals tokens per run through attempts and merges files across turns", () => {
    const model = buildInspectorModel(
      projection({
        runs: [
          {
            id: "r1",
            ordinal: 1,
            status: "completed",
            modelSelection: { model: "opus" },
            requestedAt: at(0),
            startedAt: at(1),
            completedAt: at(11),
          },
        ],
        attempts: [{ id: "a1", runId: "r1" }],
        providerTurns: [
          {
            runAttemptId: "a1",
            tokenUsage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 50 },
          },
          { runAttemptId: "a1", turnTokenUsage: { inputTokens: 10, outputTokens: 5 } },
        ],
        turnItems: [
          { runId: "r1", type: "command_execution", title: "vp test" },
          { runId: "r1", type: "assistant_message", title: null },
        ],
        checkpoints: [
          { runId: "r1", files: [{ path: "a.ts", kind: "modified", additions: 3, deletions: 1 }] },
          { runId: "r1", files: [{ path: "a.ts", kind: "modified", additions: 2, deletions: 0 }] },
        ],
        providerThreads: [{ contextUsage: { usedTokens: 4000, maxTokens: 200000 } }],
      }),
    );
    const [run] = model.runs;
    expect(run).toMatchObject({
      inputTokens: 110,
      outputTokens: 25,
      filesChanged: 2,
      durationMs: 10_000,
    });
    expect(run?.activity).toEqual([{ type: "command_execution", title: "vp test" }]);
    expect(model.files).toEqual([
      { path: "a.ts", kind: "modified", additions: 5, deletions: 1, turns: 2 },
    ]);
    expect(model.usage).toMatchObject({
      inputTokens: 110,
      cachedInputTokens: 50,
      contextUsed: 4000,
      contextMax: 200000,
      models: ["opus"],
    });
  });
});

describe("formatting", () => {
  it("abbreviates tokens and durations", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(3_200_000)).toBe("3.2M");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
});
