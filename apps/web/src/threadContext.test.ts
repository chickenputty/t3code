import { describe, expect, it } from "vitest";

import type { ChatMessage } from "./types";
import {
  describeThreadContextMessage,
  resolveLatestThreadContextMessage,
  resolveThreadContextMessage,
  truncateThreadContextPreview,
} from "./threadContext";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "message-1" as ChatMessage["id"],
    role: "user",
    text: "Hello world",
    createdAt: "2026-03-07T10:00:00.000Z",
    streaming: false,
    ...overrides,
  };
}

describe("truncateThreadContextPreview", () => {
  it("normalizes whitespace before truncating", () => {
    expect(truncateThreadContextPreview("  hello\n\nworld  ")).toBe("hello world");
  });
});

describe("describeThreadContextMessage", () => {
  it("falls back to attachment counts when the message text is empty", () => {
    expect(
      describeThreadContextMessage(
        makeMessage({
          text: "   ",
          attachments: [
            {
              type: "image",
              id: "attachment-1",
              name: "diagram.png",
              mimeType: "image/png",
              sizeBytes: 128,
            },
          ],
        }),
      ),
    ).toBe("1 attachment");
  });
});

describe("resolveThreadContextMessage", () => {
  it("prefers the first user message", () => {
    const messages = [
      makeMessage({
        id: "message-1" as ChatMessage["id"],
        role: "assistant",
        text: "intro",
      }),
      makeMessage({
        id: "message-2" as ChatMessage["id"],
        role: "user",
        text: "first user message",
      }),
      makeMessage({
        id: "message-3" as ChatMessage["id"],
        role: "user",
        text: "second user message",
      }),
    ];

    expect(resolveThreadContextMessage(messages)?.id).toBe(messages[1]?.id);
  });
});

describe("resolveLatestThreadContextMessage", () => {
  it("falls back to the last message when there is no user message", () => {
    const messages = [
      makeMessage({
        id: "message-1" as ChatMessage["id"],
        role: "assistant",
        text: "first assistant message",
      }),
      makeMessage({
        id: "message-2" as ChatMessage["id"],
        role: "assistant",
        text: "last assistant message",
      }),
    ];

    expect(resolveLatestThreadContextMessage(messages)?.id).toBe(messages[1]?.id);
  });
});
