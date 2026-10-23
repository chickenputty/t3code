import {
  THREAD_RULE_PIN_TEXT_MAX_LENGTH,
  THREAD_RULE_PINS_MAX_COUNT,
  type ThreadRulePin,
} from "@t3tools/contracts";

export type MessagePinState =
  | { readonly kind: "available" }
  | { readonly kind: "pinned"; readonly pinId: string }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * Matches by source message id, not text: the server copies the text at pin
 * time, so a pin the user later edited still belongs to its message.
 */
export function messagePinState(input: {
  readonly messageId: string;
  readonly text: string;
  readonly pins: ReadonlyArray<Pick<ThreadRulePin, "id" | "sourceMessageId">>;
}): MessagePinState {
  const existing = input.pins.find((pin) => pin.sourceMessageId === input.messageId);
  if (existing !== undefined) return { kind: "pinned", pinId: existing.id };
  const text = input.text.trim();
  if (text === "") return { kind: "unavailable", reason: "This message has no text to pin." };
  if (text.length > THREAD_RULE_PIN_TEXT_MAX_LENGTH) {
    return { kind: "unavailable", reason: "This message is too long to pin." };
  }
  if (input.pins.length >= THREAD_RULE_PINS_MAX_COUNT) {
    return {
      kind: "unavailable",
      reason: `A thread holds at most ${THREAD_RULE_PINS_MAX_COUNT} pins.`,
    };
  }
  return { kind: "available" };
}

export type RulePinDraftIssue = "empty" | "too-long" | "unchanged";

/** `current` is the pin's saved text when editing, or null for a new pin. */
export function rulePinDraftIssue(input: {
  readonly draft: string;
  readonly current: string | null;
}): RulePinDraftIssue | null {
  const draft = input.draft.trim();
  if (draft === "") return "empty";
  if (draft.length > THREAD_RULE_PIN_TEXT_MAX_LENGTH) return "too-long";
  if (input.current !== null && draft === input.current.trim()) return "unchanged";
  return null;
}
