import type { ChatMessage } from "./types";

export function truncateThreadContextPreview(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function describeThreadContextMessage(message: ChatMessage): string {
  const textPreview = truncateThreadContextPreview(message.text);
  if (textPreview.length > 0) {
    return textPreview;
  }

  const attachmentCount = message.attachments?.length ?? 0;
  if (attachmentCount > 0) {
    return attachmentCount === 1 ? "1 attachment" : `${attachmentCount} attachments`;
  }

  return message.role === "assistant" ? "Assistant message" : "Message";
}

export function resolveThreadContextMessage(
  messages: ReadonlyArray<ChatMessage>,
): ChatMessage | null {
  return messages.find((message) => message.role === "user") ?? messages[0] ?? null;
}

export function resolveLatestThreadContextMessage(
  messages: ReadonlyArray<ChatMessage>,
): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message;
    }
  }

  return messages.at(-1) ?? null;
}
