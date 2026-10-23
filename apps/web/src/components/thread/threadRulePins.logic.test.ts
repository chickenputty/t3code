import { THREAD_RULE_PIN_TEXT_MAX_LENGTH, THREAD_RULE_PINS_MAX_COUNT } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { messagePinState, rulePinDraftIssue } from "./threadRulePins.logic";

const pin = (id: string, sourceMessageId: string | null = null) => ({
  id,
  text: `Pin ${id}`,
  sourceMessageId: sourceMessageId as never,
  createdAt: "2026-10-23T00:00:00.000Z",
});

describe("messagePinState", () => {
  it("offers a message with text that is not pinned yet", () => {
    expect(messagePinState({ messageId: "m1", text: "Be terse.", pins: [] })).toEqual({
      kind: "available",
    });
  });

  it("marks a message already pinned by id, even after the pin text was edited", () => {
    expect(
      messagePinState({ messageId: "m1", text: "Be terse.", pins: [pin("p1", "m1")] }),
    ).toEqual({ kind: "pinned", pinId: "p1" });
  });

  it("does not offer an empty message, an over-long one, or a full list", () => {
    expect(messagePinState({ messageId: "m1", text: "  \n", pins: [] }).kind).toBe("unavailable");
    expect(
      messagePinState({
        messageId: "m1",
        text: "x".repeat(THREAD_RULE_PIN_TEXT_MAX_LENGTH + 1),
        pins: [],
      }).kind,
    ).toBe("unavailable");
    expect(
      messagePinState({
        messageId: "m1",
        text: "Be terse.",
        pins: Array.from({ length: THREAD_RULE_PINS_MAX_COUNT }, (_, i) => pin(`p${i}`)),
      }).kind,
    ).toBe("unavailable");
  });

  it("still reports a pinned message when the list is full", () => {
    const pins = Array.from({ length: THREAD_RULE_PINS_MAX_COUNT }, (_, i) =>
      pin(`p${i}`, i === 3 ? "m1" : null),
    );
    expect(messagePinState({ messageId: "m1", text: "Be terse.", pins })).toEqual({
      kind: "pinned",
      pinId: "p3",
    });
  });
});

describe("rulePinDraftIssue", () => {
  it("accepts new text and changed text", () => {
    expect(rulePinDraftIssue({ draft: "Be terse.", current: null })).toBeNull();
    expect(rulePinDraftIssue({ draft: "Be brief.", current: "Be terse." })).toBeNull();
  });

  it("rejects blank, unchanged and over-long drafts", () => {
    expect(rulePinDraftIssue({ draft: "   ", current: null })).toBe("empty");
    expect(rulePinDraftIssue({ draft: "Be terse.\n", current: "Be terse." })).toBe("unchanged");
    expect(
      rulePinDraftIssue({ draft: "x".repeat(THREAD_RULE_PIN_TEXT_MAX_LENGTH + 1), current: null }),
    ).toBe("too-long");
  });
});
