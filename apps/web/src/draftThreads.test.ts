import { describe, expect, it } from "vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";

import { buildLocalDraftThread, deriveDraftThreadTitle } from "./draftThreads";

describe("deriveDraftThreadTitle", () => {
  it("uses the prompt when available", () => {
    expect(
      deriveDraftThreadTitle({
        prompt: "Draft with a useful title",
        images: [],
        persistedAttachments: [],
      }),
    ).toBe("Draft with a useful title");
  });

  it("falls back to the first attachment name when the prompt is empty", () => {
    expect(
      deriveDraftThreadTitle({
        prompt: "   ",
        images: [{ name: "diagram.png" }],
        persistedAttachments: [],
      }),
    ).toBe("Image: diagram.png");
  });

  it("falls back to the default title when no prompt or attachments exist", () => {
    expect(
      deriveDraftThreadTitle({
        prompt: "",
        images: [],
        persistedAttachments: [],
      }),
    ).toBe("New thread");
  });
});

describe("buildLocalDraftThread", () => {
  it("projects a draft thread into a local thread row", () => {
    const thread = buildLocalDraftThread({
      threadId: ThreadId.makeUnsafe("thread-draft"),
      draftThread: {
        projectId: ProjectId.makeUnsafe("project-a"),
        createdAt: "2026-03-07T12:00:00.000Z",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "feature/draft",
        worktreePath: "/tmp/worktree-draft",
        envMode: "worktree",
      },
      fallbackModel: "gpt-5.4",
      composerDraft: {
        prompt: "Implement the sidebar draft fix",
        images: [],
        persistedAttachments: [],
      },
      error: null,
    });

    expect(thread).toMatchObject({
      id: ThreadId.makeUnsafe("thread-draft"),
      projectId: ProjectId.makeUnsafe("project-a"),
      title: "Implement the sidebar draft fix",
      model: "gpt-5.4",
      branch: "feature/draft",
      worktreePath: "/tmp/worktree-draft",
    });
  });
});
