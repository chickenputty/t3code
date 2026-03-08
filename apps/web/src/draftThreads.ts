import type {
  DraftThreadState,
  PersistedComposerImageAttachment,
} from "./composerDraftStore";
import type { ThreadId } from "@t3tools/contracts";
import type { Thread } from "./types";
import { truncateTitle } from "./truncateTitle";

export interface DraftThreadTitleState {
  prompt: string;
  images: readonly { name: string }[];
  persistedAttachments: readonly PersistedComposerImageAttachment[];
}

function firstDraftAttachmentName(draft: DraftThreadTitleState | null | undefined): string | null {
  const firstImageName = draft?.images[0]?.name?.trim();
  if (firstImageName && firstImageName.length > 0) {
    return firstImageName;
  }

  const firstPersistedAttachmentName = draft?.persistedAttachments[0]?.name?.trim();
  if (firstPersistedAttachmentName && firstPersistedAttachmentName.length > 0) {
    return firstPersistedAttachmentName;
  }

  return null;
}

export function deriveDraftThreadTitle(draft: DraftThreadTitleState | null | undefined): string {
  const trimmedPrompt = draft?.prompt.trim() ?? "";
  if (trimmedPrompt.length > 0) {
    return truncateTitle(trimmedPrompt);
  }

  const attachmentName = firstDraftAttachmentName(draft);
  if (attachmentName) {
    return truncateTitle(`Image: ${attachmentName}`);
  }

  return "New thread";
}

export function buildLocalDraftThread(input: {
  threadId: ThreadId;
  draftThread: DraftThreadState;
  fallbackModel: string;
  composerDraft?: DraftThreadTitleState | null | undefined;
  error: string | null;
}): Thread {
  const { threadId, draftThread, fallbackModel, composerDraft, error } = input;
  return {
    id: threadId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: deriveDraftThreadTitle(composerDraft),
    model: fallbackModel,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    error,
    createdAt: draftThread.createdAt,
    latestTurn: null,
    lastVisitedAt: draftThread.createdAt,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}
