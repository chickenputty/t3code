import type { OrchestrationContextWindow } from "@t3tools/contracts";

import { asNonNegativeInteger, asRecord, clampPercent } from "./contextWindowCommon.ts";

type UnknownRecord = Record<string, unknown>;

function compactRecords(
  values: ReadonlyArray<UnknownRecord | null | undefined>,
): ReadonlyArray<UnknownRecord> {
  return values.filter((value): value is UnknownRecord => value !== null && value !== undefined);
}

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

function pickFirstRecord(
  records: ReadonlyArray<UnknownRecord>,
  keys: ReadonlyArray<string>,
): UnknownRecord | null {
  for (const record of records) {
    const value = asRecord(pickValue(record, keys));
    if (value) {
      return value;
    }
  }
  return null;
}

function recordHasTotalTokenFields(record: UnknownRecord): boolean {
  return pickNumber(record, ["total_tokens", "totalTokens"]) !== undefined;
}

function resolveTotalUsageRecord(records: ReadonlyArray<UnknownRecord>): UnknownRecord | null {
  const nestedRecord = pickFirstRecord(records, [
    "total_token_usage",
    "totalTokenUsage",
    "usage",
    "total_usage",
    "total",
  ]);
  if (nestedRecord) {
    return nestedRecord;
  }

  return records.find(recordHasTotalTokenFields) ?? null;
}

function pickFirstNumber(
  records: ReadonlyArray<UnknownRecord>,
  keys: ReadonlyArray<string>,
): number | undefined {
  for (const record of records) {
    const value = pickNumber(record, keys);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function normalizeCodexContextWindow(
  usage: unknown,
  updatedAt: string,
): OrchestrationContextWindow | null {
  const payload = asRecord(usage);
  const info = asRecord(pickValue(payload, ["info"]));
  const tokenUsage = asRecord(pickValue(payload, ["tokenUsage", "token_usage"]));
  const infoTokenUsage = asRecord(pickValue(info, ["tokenUsage", "token_usage"]));
  const records = compactRecords([payload, info, tokenUsage, infoTokenUsage]);
  const totalUsage = resolveTotalUsageRecord(records);
  const usedTokens = pickNumber(totalUsage, ["total_tokens", "totalTokens"]);
  const maxTokens = pickFirstNumber(records, [
    "model_context_window",
    "modelContextWindow",
    "context_window",
  ]);

  if (usedTokens === undefined || maxTokens === undefined || maxTokens <= 0) {
    return null;
  }

  const inputTokens = pickNumber(totalUsage, ["input_tokens", "inputTokens"]);
  const cachedInputTokens = pickNumber(totalUsage, ["cached_input_tokens", "cachedInputTokens"]);
  const outputTokens = pickNumber(totalUsage, ["output_tokens", "outputTokens"]);
  const reasoningOutputTokens = pickNumber(totalUsage, [
    "reasoning_output_tokens",
    "reasoningOutputTokens",
  ]);
  const remainingTokens = Math.max(0, maxTokens - usedTokens);
  const usedPercent = clampPercent((usedTokens / maxTokens) * 100);

  return {
    provider: "codex",
    usedTokens,
    maxTokens,
    remainingTokens,
    usedPercent,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    updatedAt,
  };
}
