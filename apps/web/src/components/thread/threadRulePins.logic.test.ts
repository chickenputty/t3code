import {
  THREAD_RULE_PIN_TEXT_MAX_LENGTH,
  THREAD_RULE_PINS_MAX_COUNT,
  THREAD_RULE_PINS_TOTAL_MAX_LENGTH,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { messagePinState, rulePinDraftIssue } from "./threadRulePins.logic";

const pin = (id: string, sourceMessageId: string | null = null, text = `Pin ${id}`) => ({
  id,
  text,
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

  it("disables a message with unresolved context syntax, with the reason, but not mere prose", () => {
    const envelope = messagePinState({
      messageId: "m1",
      text: "<t3_context>\n<context id='a'/>\n</t3_context>\nHi",
      pins: [],
    });
    expect(envelope.kind).toBe("unavailable");
    expect(envelope.kind === "unavailable" ? envelope.reason : "").toContain("attached context");
    expect(
      messagePinState({ messageId: "m1", text: "See [x](t3-context://v1/file/a)", pins: [] }).kind,
    ).toBe("unavailable");
    expect(
      messagePinState({ messageId: "m1", text: "The t3-context: scheme is internal.", pins: [] }),
    ).toEqual({ kind: "available" });
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

  it("does not offer a message that would push the pins past the combined cap", () => {
    const pins = [pin("a", null, "x".repeat(THREAD_RULE_PINS_TOTAL_MAX_LENGTH - 5))];
    const state = messagePinState({ messageId: "m1", text: "123456", pins });
    expect(state.kind).toBe("unavailable");
    expect(state.kind === "unavailable" ? state.reason : "").toContain("full");
    expect(messagePinState({ messageId: "m1", text: "12345", pins }).kind).toBe("available");
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
    expect(
      rulePinDraftIssue({ draft: "Be brief.", current: { id: "p1", text: "Be terse." } }),
    ).toBeNull();
  });

  it("rejects blank, unchanged and over-long drafts", () => {
    expect(rulePinDraftIssue({ draft: "   ", current: null })).toBe("empty");
    expect(
      rulePinDraftIssue({ draft: "Be terse.\n", current: { id: "p1", text: "Be terse." } }),
    ).toBe("unchanged");
    expect(
      rulePinDraftIssue({ draft: "x".repeat(THREAD_RULE_PIN_TEXT_MAX_LENGTH + 1), current: null }),
    ).toBe("too-long");
  });

  it("enforces the combined cap, replacing the edited pin's own text", () => {
    const pins = [pin("a", null, "x".repeat(8_000)), pin("b", null, "y".repeat(8_000))];
    expect(rulePinDraftIssue({ draft: "z", current: null, pins })).toBe("total-too-long");
    expect(
      rulePinDraftIssue({
        draft: "z".repeat(8_000),
        current: { id: "b", text: pins[1]!.text },
        pins,
      }),
    ).toBeNull();
    expect(
      rulePinDraftIssue({
        draft: "z".repeat(8_001),
        current: { id: "b", text: pins[1]!.text },
        pins,
      }),
    ).toBe("too-long");
  });
});
