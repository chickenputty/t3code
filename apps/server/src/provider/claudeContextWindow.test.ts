import { describe, expect, it } from "vitest";

import { normalizeClaudeContextWindow } from "./claudeContextWindow.ts";

describe("normalizeClaudeContextWindow", () => {
  it("parses Claude SDK usage and model usage payloads", () => {
    expect(
      normalizeClaudeContextWindow(
        {
          usage: {
            input_tokens: 80_000,
            cache_creation_input_tokens: 5_000,
            cache_read_input_tokens: 20_000,
            output_tokens: 4_000,
          },
          modelUsage: {
            "claude-sonnet-5-0": {
              inputTokens: 85_000,
              outputTokens: 4_000,
              cacheReadInputTokens: 20_000,
              cacheCreationInputTokens: 5_000,
              webSearchRequests: 0,
              costUSD: 1.23,
              contextWindow: 200_000,
              maxOutputTokens: 8_192,
            },
          },
        },
        "2026-03-10T00:00:00.000Z",
      ),
    ).toEqual({
      provider: "claudeCode",
      usedTokens: 109_000,
      maxTokens: 200_000,
      remainingTokens: 91_000,
      usedPercent: 55,
      inputTokens: 85_000,
      cachedInputTokens: 20_000,
      outputTokens: 4_000,
      updatedAt: "2026-03-10T00:00:00.000Z",
    });
  });

  it("falls back to per-model usage totals when top-level usage is missing", () => {
    expect(
      normalizeClaudeContextWindow(
        {
          modelUsage: {
            "claude-opus-4-6": {
              inputTokens: 50_000,
              outputTokens: 2_000,
              cacheReadInputTokens: 10_000,
              cacheCreationInputTokens: 3_000,
              webSearchRequests: 0,
              costUSD: 0.9,
              contextWindow: 180_000,
              maxOutputTokens: 8_192,
            },
          },
        },
        "2026-03-10T00:00:00.000Z",
      ),
    ).toEqual({
      provider: "claudeCode",
      usedTokens: 65_000,
      maxTokens: 180_000,
      remainingTokens: 115_000,
      usedPercent: 36,
      inputTokens: 53_000,
      cachedInputTokens: 10_000,
      outputTokens: 2_000,
      updatedAt: "2026-03-10T00:00:00.000Z",
    });
  });

  it("uses the latest per-model context window when multiple models are reported", () => {
    expect(
      normalizeClaudeContextWindow(
        {
          usage: {
            input_tokens: 10_000,
            output_tokens: 500,
          },
          modelUsage: {
            "claude-sonnet-5-0": {
              inputTokens: 10_000,
              outputTokens: 500,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              webSearchRequests: 0,
              costUSD: 0.1,
              contextWindow: 200_000,
              maxOutputTokens: 8_192,
            },
            "claude-opus-4-6": {
              inputTokens: 10_000,
              outputTokens: 500,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              webSearchRequests: 0,
              costUSD: 0.2,
              contextWindow: 400_000,
              maxOutputTokens: 8_192,
            },
          },
        },
        "2026-03-10T00:00:00.000Z",
      ),
    ).toMatchObject({
      usedTokens: 10_500,
      maxTokens: 400_000,
      remainingTokens: 389_500,
      usedPercent: 3,
    });
  });

  it("ignores malformed or incomplete payloads", () => {
    expect(normalizeClaudeContextWindow({}, "2026-03-10T00:00:00.000Z")).toBeNull();
    expect(
      normalizeClaudeContextWindow(
        {
          usage: {
            input_tokens: 100,
          },
        },
        "2026-03-10T00:00:00.000Z",
      ),
    ).toBeNull();
  });
});
