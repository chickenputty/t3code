import { type ProviderKind } from "@t3tools/contracts";
import {
  resolveModelSlugForProvider,
  resolveProviderForModel,
} from "@t3tools/shared/model";

import type { Thread } from "./types";

export interface ThreadSelectionDefaults {
  provider: ProviderKind;
  model: string;
}

export function inferProviderForThreadModel(input: {
  readonly model: string | null | undefined;
  readonly sessionProviderName: string | null | undefined;
}): ProviderKind {
  if (
    input.sessionProviderName === "codex" ||
    input.sessionProviderName === "claudeCode" ||
    input.sessionProviderName === "gemini"
  ) {
    return input.sessionProviderName;
  }

  const trimmedModel = input.model?.trim().toLowerCase() ?? "";
  const fallbackProvider =
    trimmedModel.startsWith("claude-")
      ? "claudeCode"
      : trimmedModel.startsWith("gemini")
        ? "gemini"
        : "codex";

  return resolveProviderForModel(input.model, fallbackProvider);
}

function compareThreadsByCreatedAtDesc(left: Pick<Thread, "createdAt" | "id">, right: Pick<Thread, "createdAt" | "id">): number {
  const leftCreatedAtMs = Date.parse(left.createdAt);
  const rightCreatedAtMs = Date.parse(right.createdAt);

  if (Number.isFinite(leftCreatedAtMs) && Number.isFinite(rightCreatedAtMs)) {
    const byCreatedAt = rightCreatedAtMs - leftCreatedAtMs;
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
  }

  const byCreatedAtText = right.createdAt.localeCompare(left.createdAt);
  if (byCreatedAtText !== 0) {
    return byCreatedAtText;
  }

  return right.id.localeCompare(left.id);
}

export function getLatestStartedThreadSelection(
  threads: ReadonlyArray<Pick<Thread, "id" | "createdAt" | "model" | "session">>,
): ThreadSelectionDefaults | null {
  const latestThread = [...threads].toSorted(compareThreadsByCreatedAtDesc)[0];
  if (!latestThread) {
    return null;
  }

  const provider = inferProviderForThreadModel({
    model: latestThread.model,
    sessionProviderName: latestThread.session?.provider ?? null,
  });

  return {
    provider,
    model: resolveModelSlugForProvider(provider, latestThread.model),
  };
}
