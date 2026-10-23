import {
  THREAD_RULE_PIN_TEXT_MAX_LENGTH,
  THREAD_RULE_PINS_MAX_COUNT,
  THREAD_RULE_PINS_TOTAL_MAX_LENGTH,
  type ThreadRulePin,
} from "@t3tools/contracts";
import { hasUnresolvedComposerContext } from "@t3tools/shared/composerContextReferences";

type PinLike = Pick<ThreadRulePin, "id" | "text" | "sourceMessageId">;

export type MessagePinState =
  | { readonly kind: "available" }
  | { readonly kind: "pinned"; readonly pinId: string }
  | { readonly kind: "unavailable"; readonly reason: string };

const totalLength = (pins: ReadonlyArray<Pick<ThreadRulePin, "text">>) =>
  pins.reduce((total, pin) => total + pin.text.length, 0);

/**
 * Matches by source message id, not text: the server copies the text at pin
 * time, so a pin the user later edited still belongs to its message.
 */
export function messagePinState(input: {
  readonly messageId: string;
  readonly text: string;
  readonly pins: ReadonlyArray<PinLike>;
}): MessagePinState {
  const existing = input.pins.find((pin) => pin.sourceMessageId === input.messageId);
  if (existing !== undefined) return { kind: "pinned", pinId: existing.id };
  const text = input.text.trim();
  if (text === "") return { kind: "unavailable", reason: "This message has no text to pin." };
  if (hasUnresolvedComposerContext(text)) {
    return {
      kind: "unavailable",
      reason: "This message has attached context that cannot be pinned as text.",
    };
  }
  if (text.length > THREAD_RULE_PIN_TEXT_MAX_LENGTH) {
    return { kind: "unavailable", reason: "This message is too long to pin." };
  }
  if (input.pins.length >= THREAD_RULE_PINS_MAX_COUNT) {
    return {
      kind: "unavailable",
      reason: `A thread holds at most ${THREAD_RULE_PINS_MAX_COUNT} pins.`,
    };
  }
  if (totalLength(input.pins) + text.length > THREAD_RULE_PINS_TOTAL_MAX_LENGTH) {
    return {
      kind: "unavailable",
      reason: "This thread's pins are full. Unpin or shorten one to pin this message.",
    };
  }
  return { kind: "available" };
}

export type RulePinDraftIssue = "empty" | "too-long" | "total-too-long" | "unchanged";

/**
 * `current` is the pin being edited, or null for a new pin; the combined cap
 * counts every other pin plus the draft.
 */
export function rulePinDraftIssue(input: {
  readonly draft: string;
  readonly current: Pick<ThreadRulePin, "id" | "text"> | null;
  readonly pins?: ReadonlyArray<Pick<ThreadRulePin, "id" | "text">>;
}): RulePinDraftIssue | null {
  const draft = input.draft.trim();
  if (draft === "") return "empty";
  if (draft.length > THREAD_RULE_PIN_TEXT_MAX_LENGTH) return "too-long";
  if (input.current !== null && draft === input.current.text.trim()) return "unchanged";
  const others = (input.pins ?? []).filter((pin) => pin.id !== input.current?.id);
  if (totalLength(others) + draft.length > THREAD_RULE_PINS_TOTAL_MAX_LENGTH) {
    return "total-too-long";
  }
  return null;
}
