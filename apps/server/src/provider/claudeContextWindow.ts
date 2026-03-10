import type { OrchestrationContextWindow } from "@t3tools/contracts";

import { asNonNegativeInteger, asRecord, clampPercent } from "./contextWindowCommon.ts";

type UnknownRecord = Record<string, unknown>;

function pickValue(record: UnknownRecord | null, keys: ReadonlyArray<string>): unknown {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function pickNumber(record: UnknownRecord | null, keys: ReadonlyArray<string>): number | undefined {
  return asNonNegativeInteger(pickValue(record, keys));
}

function sumDefined(values: ReadonlyArray<number | undefined>): number | undefined {
  let total = 0;
  let hasValue = false;

  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    total += value;
    hasValue = true;
  }

  return hasValue ? total : undefined;
}

function modelUsageRecords(value: unknown): ReadonlyArray<UnknownRecord> {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  return Object.values(record).flatMap((entry) => {
    const nextRecord = asRecord(entry);
    return nextRecord ? [nextRecord] : [];
  });
}

function sumModelUsageNumbers(
  records: ReadonlyArray<UnknownRecord>,
  keys: ReadonlyArray<string>,
): number | undefined {
  return sumDefined(records.map((record) => pickNumber(record, keys)));
}

function pickLastNumber(
  records: ReadonlyArray<UnknownRecord>,
  keys: ReadonlyArray<string>,
): number | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const value = pickNumber(records[index] ?? null, keys);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function normalizeClaudeContextWindow(
  payload: {
    usage?: unknown;
    modelUsage?: unknown;
  },
  updatedAt: string,
): OrchestrationContextWindow | null {
  const usageRecord = asRecord(payload.usage);
  const perModelUsage = modelUsageRecords(payload.modelUsage);

  const directInputTokens =
    pickNumber(usageRecord, ["input_tokens", "inputTokens"]) ??
    sumModelUsageNumbers(perModelUsage, ["inputTokens", "input_tokens"]);
  const cacheCreationInputTokens =
    pickNumber(usageRecord, ["cache_creation_input_tokens", "cacheCreationInputTokens"]) ??
    sumModelUsageNumbers(perModelUsage, [
      "cacheCreationInputTokens",
      "cache_creation_input_tokens",
    ]);
  const cachedInputTokens =
    pickNumber(usageRecord, ["cache_read_input_tokens", "cacheReadInputTokens"]) ??
    sumModelUsageNumbers(perModelUsage, ["cacheReadInputTokens", "cache_read_input_tokens"]);
  const outputTokens =
    pickNumber(usageRecord, ["output_tokens", "outputTokens"]) ??
    sumModelUsageNumbers(perModelUsage, ["outputTokens", "output_tokens"]);

  // Claude reports cache creation tokens separately from plain input tokens.
  // Fold them into the visible input bucket so the breakdown still sums cleanly.
  const inputTokens = sumDefined([directInputTokens, cacheCreationInputTokens]);

  const usedTokens =
    pickNumber(usageRecord, ["total_tokens", "totalTokens"]) ??
    sumDefined([directInputTokens, cacheCreationInputTokens, cachedInputTokens, outputTokens]);

  const maxTokens =
    pickLastNumber(perModelUsage, ["contextWindow", "context_window"]) ??
    pickNumber(usageRecord, ["contextWindow", "context_window", "modelContextWindow", "model_context_window"]);

  if (usedTokens === undefined || maxTokens === undefined || maxTokens <= 0) {
    return null;
  }

  const remainingTokens = Math.max(0, maxTokens - usedTokens);
  const usedPercent = clampPercent((usedTokens / maxTokens) * 100);

  return {
    provider: "claudeCode",
    usedTokens,
    maxTokens,
    remainingTokens,
    usedPercent,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    updatedAt,
  };
}
