/**
 * Fork (chickenputty/t3code): what the view inspector shows of one thread,
 * derived from its full projection (loaded only while the inspector is open).
 */
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type Projection = OrchestrationV2ThreadProjection;

export interface InspectorMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdMs: number;
  readonly runId: string | null;
}

export interface InspectorRun {
  readonly id: string;
  readonly ordinal: number;
  readonly status: string;
  readonly model: string;
  readonly requestedMs: number;
  readonly completedMs: number | null;
  readonly durationMs: number | null;
  /** Tool calls, commands, file edits and the like: every item that is not a message. */
  readonly activity: readonly { readonly type: string; readonly title: string | null }[];
  readonly filesChanged: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface InspectorFile {
  readonly path: string;
  readonly kind: string;
  readonly additions: number;
  readonly deletions: number;
  /** How many turns touched it. */
  readonly turns: number;
}

export interface InspectorUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly contextUsed: number | null;
  readonly contextMax: number | null;
  readonly models: readonly string[];
}

export interface InspectorModel {
  readonly messages: readonly InspectorMessage[];
  readonly runs: readonly InspectorRun[];
  readonly files: readonly InspectorFile[];
  readonly usage: InspectorUsage;
  readonly firstUserMessage: string | null;
}

const ms = (value: DateTime.Utc) => DateTime.toEpochMillis(value);
const msOrNull = (value: DateTime.Utc | null) => (value === null ? null : ms(value));

const MESSAGE_ITEM_TYPES = new Set(["user_message", "assistant_message", "notification"]);

export function buildInspectorModel(projection: Projection): InspectorModel {
  const messages: InspectorMessage[] = projection.messages
    .filter(
      (message): message is typeof message & { role: "user" | "assistant" } =>
        message.role !== "system" && message.text.trim() !== "",
    )
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      createdMs: ms(message.createdAt),
      runId: message.runId,
    }))
    .sort((left, right) => left.createdMs - right.createdMs);

  // Provider turns hang off attempts; attempts off runs.
  const runByAttempt = new Map(projection.attempts.map((attempt) => [attempt.id, attempt.runId]));
  const tokensByRun = new Map<string, { input: number; output: number }>();
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  for (const turn of projection.providerTurns) {
    const usage = turn.turnTokenUsage;
    const input = usage?.inputTokens ?? turn.tokenUsage?.inputTokens ?? 0;
    const output = usage?.outputTokens ?? turn.tokenUsage?.outputTokens ?? 0;
    inputTokens += input;
    outputTokens += output;
    cachedInputTokens += turn.tokenUsage?.cachedInputTokens ?? 0;
    reasoningTokens += turn.tokenUsage?.reasoningOutputTokens ?? 0;
    const runId = turn.runAttemptId === null ? undefined : runByAttempt.get(turn.runAttemptId);
    if (runId !== undefined) {
      const entry = tokensByRun.get(runId) ?? { input: 0, output: 0 };
      entry.input += input;
      entry.output += output;
      tokensByRun.set(runId, entry);
    }
  }

  const activityByRun = new Map<string, { type: string; title: string | null }[]>();
  for (const item of projection.turnItems) {
    if (item.runId === null || MESSAGE_ITEM_TYPES.has(item.type)) continue;
    const list = activityByRun.get(item.runId) ?? [];
    list.push({ type: item.type, title: item.title });
    activityByRun.set(item.runId, list);
  }

  const filesByRun = new Map<string, number>();
  const files = new Map<
    string,
    { path: string; kind: string; additions: number; deletions: number; turns: number }
  >();
  for (const checkpoint of projection.checkpoints) {
    // Like the review panel: only turn checkpoints, never a scope's baseline.
    if (checkpoint.runId === null || checkpoint.appRunOrdinal === null) continue;
    filesByRun.set(
      checkpoint.runId,
      (filesByRun.get(checkpoint.runId) ?? 0) + checkpoint.files.length,
    );
    for (const file of checkpoint.files) {
      const entry = files.get(file.path);
      if (entry) {
        entry.additions += file.additions;
        entry.deletions += file.deletions;
        entry.turns += 1;
        entry.kind = file.kind;
      } else {
        files.set(file.path, { ...file, turns: 1 });
      }
    }
  }

  const models = new Set<string>();
  const runs: InspectorRun[] = projection.runs
    .map((run) => {
      models.add(run.modelSelection.model);
      const requestedMs = ms(run.requestedAt);
      const startedMs = msOrNull(run.startedAt);
      const completedMs = msOrNull(run.completedAt);
      const tokens = tokensByRun.get(run.id);
      return {
        id: run.id,
        ordinal: run.ordinal,
        status: run.status,
        model: run.modelSelection.model,
        requestedMs,
        completedMs,
        durationMs: completedMs === null ? null : completedMs - (startedMs ?? requestedMs),
        activity: activityByRun.get(run.id) ?? [],
        filesChanged: filesByRun.get(run.id) ?? 0,
        inputTokens: tokens?.input ?? 0,
        outputTokens: tokens?.output ?? 0,
      };
    })
    .sort((left, right) => left.ordinal - right.ordinal);

  // The most recent context snapshot any provider thread reported.
  let contextUsed: number | null = null;
  let contextMax: number | null = null;
  for (const providerThread of projection.providerThreads) {
    const usage = providerThread.contextUsage;
    if (!usage) continue;
    contextUsed = usage.usedTokens;
    contextMax = usage.maxTokens ?? null;
  }

  return {
    messages,
    runs,
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
    usage: {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      contextUsed,
      contextMax,
      models: [...models],
    },
    firstUserMessage: messages.find((message) => message.role === "user")?.text ?? null,
  };
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
