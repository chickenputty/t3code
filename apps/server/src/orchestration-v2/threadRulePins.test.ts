import { THREAD_RULE_PINS_MAX_COUNT, MessageId, type ThreadRulePin } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import { composePinnedRules, planRulePinChange } from "./threadRulePins.ts";

const pin = (id: string, text: string): ThreadRulePin => ({
  id,
  text,
  sourceMessageId: null,
  createdAt: "2026-10-23T00:00:00.000Z",
});

describe("composePinnedRules", () => {
  it("is empty with no project rules and no thread pins", () => {
    assert.equal(composePinnedRules({ projectRules: "", threadPins: [] }), "");
  });

  it("leaves project rules untouched when the thread has no pins", () => {
    assert.equal(
      composePinnedRules({ projectRules: "Never touch generated/ files.", threadPins: [] }),
      "Never touch generated/ files.",
    );
  });

  it("puts project rules before thread pins, each under its own heading, in pin order", () => {
    const composed = composePinnedRules({
      projectRules: "Rule A\nRule B",
      threadPins: [pin("p1", "First pin\nwith `code`"), pin("p2", "Second pin")],
    });
    assert.equal(
      composed,
      [
        "## Project pinned rules",
        "",
        "Rule A\nRule B",
        "",
        "## Thread pinned rules",
        "",
        "First pin\nwith `code`",
        "",
        "---",
        "",
        "Second pin",
      ].join("\n"),
    );
  });

  it("omits the project heading when only the thread has pins", () => {
    const composed = composePinnedRules({ projectRules: "", threadPins: [pin("p1", "Only pin")] });
    assert.equal(composed, "## Thread pinned rules\n\nOnly pin");
  });
});

describe("planRulePinChange", () => {
  const now = "2026-10-23T12:00:00.000Z";

  it("adds a free-text pin at the end", () => {
    const plan = planRulePinChange({
      pins: [pin("p1", "One")],
      now,
      command: { type: "thread.rule-pin.add", pinId: "p2", text: "Two" },
    });
    assert.deepEqual(plan, {
      _tag: "changed",
      pins: [pin("p1", "One"), { id: "p2", text: "Two", sourceMessageId: null, createdAt: now }],
    });
  });

  it("copies the message text at pin time and remembers the message", () => {
    const sourceMessageId = MessageId.make("message-1");
    const plan = planRulePinChange({
      pins: [],
      now,
      command: { type: "thread.rule-pin.add", pinId: "p1", sourceMessageId },
      sourceMessage: { id: sourceMessageId, text: "  Original wording\n" },
    });
    assert.deepEqual(plan, {
      _tag: "changed",
      pins: [{ id: "p1", text: "Original wording", sourceMessageId, createdAt: now }],
    });
  });

  it("pins a message's context references as their labels, as the copy button does", () => {
    const sourceMessageId = MessageId.make("message-1");
    const href = "t3-context://v1/file/ctx-1";
    const plan = planRulePinChange({
      pins: [],
      now,
      command: { type: "thread.rule-pin.add", pinId: "p1", sourceMessageId },
      sourceMessage: { id: sourceMessageId, text: `Follow [src/app.ts](${href}) closely.` },
    });
    assert.deepEqual(plan, {
      _tag: "changed",
      pins: [{ id: "p1", text: "Follow src/app.ts closely.", sourceMessageId, createdAt: now }],
    });
  });

  it("rejects a legacy context envelope it cannot resolve, rather than pinning it raw", () => {
    const sourceMessageId = MessageId.make("message-1");
    const plan = planRulePinChange({
      pins: [],
      now,
      command: { type: "thread.rule-pin.add", pinId: "p1", sourceMessageId },
      sourceMessage: {
        id: sourceMessageId,
        text: "<t3_context>\n<context id='a'/>\n</t3_context>\nHi",
      },
    });
    assert.equal(plan._tag, "rejected");
    assert.include(plan._tag === "rejected" ? plan.reason : "", "context");
  });

  it("caps the pins' combined length, counting an edit as a replacement", () => {
    const big = (id: string, length: number) => pin(id, "x".repeat(length));
    const full = [big("a", 8_000), big("b", 8_000)];
    const added = planRulePinChange({
      pins: full,
      now,
      command: { type: "thread.rule-pin.add", pinId: "c", text: "y" },
    });
    assert.equal(added._tag, "rejected");
    assert.include(added._tag === "rejected" ? added.reason : "", "in total");

    const grown = planRulePinChange({
      pins: [big("a", 8_000), big("b", 7_000)],
      now,
      command: { type: "thread.rule-pin.edit", pinId: "b", text: "z".repeat(8_001) },
    });
    assert.equal(grown._tag, "rejected");

    const shrunk = planRulePinChange({
      pins: full,
      now,
      command: { type: "thread.rule-pin.edit", pinId: "b", text: "short" },
    });
    assert.equal(shrunk._tag, "changed");
    const afterRemove = planRulePinChange({
      pins: full,
      now,
      command: { type: "thread.rule-pin.remove", pinId: "a" },
    });
    assert.equal(afterRemove._tag, "changed");
  });

  it("treats a retried add with the same id and text as a no-op, but a different text as a clash", () => {
    const pins = [pin("p1", "One")];
    const retry = planRulePinChange({
      pins,
      now,
      command: { type: "thread.rule-pin.add", pinId: "p1", text: "One" },
    });
    assert.deepEqual(retry, { _tag: "unchanged" });
    const sourceMessageId = MessageId.make("message-1");
    const withSource = [{ ...pin("p2", "Copied"), sourceMessageId }];
    assert.deepEqual(
      planRulePinChange({
        pins: withSource,
        now,
        command: { type: "thread.rule-pin.add", pinId: "p2", sourceMessageId },
        sourceMessage: { id: sourceMessageId, text: "Copied" },
      }),
      { _tag: "unchanged" },
    );
    assert.equal(
      planRulePinChange({
        pins,
        now,
        command: { type: "thread.rule-pin.add", pinId: "p1", text: "Different" },
      })._tag,
      "rejected",
    );
  });

  it("treats an edit to the same text as a no-op", () => {
    assert.deepEqual(
      planRulePinChange({
        pins: [pin("p1", "One")],
        now,
        command: { type: "thread.rule-pin.edit", pinId: "p1", text: " One " },
      }),
      { _tag: "unchanged" },
    );
  });

  it("rejects a message pin whose message is missing or has no text", () => {
    const sourceMessageId = MessageId.make("message-1");
    const command = { type: "thread.rule-pin.add", pinId: "p1", sourceMessageId } as const;
    assert.equal(planRulePinChange({ pins: [], now, command })._tag, "rejected");
    assert.equal(
      planRulePinChange({
        pins: [],
        now,
        command,
        sourceMessage: { id: sourceMessageId, text: "  " },
      })._tag,
      "rejected",
    );
  });

  it("rejects text beyond the cap rather than truncating a copied message", () => {
    const sourceMessageId = MessageId.make("message-1");
    const plan = planRulePinChange({
      pins: [],
      now,
      command: { type: "thread.rule-pin.add", pinId: "p1", sourceMessageId },
      sourceMessage: { id: sourceMessageId, text: "x".repeat(9_000) },
    });
    assert.equal(plan._tag, "rejected");
  });

  it("rejects a duplicate pin id and a full list", () => {
    assert.equal(
      planRulePinChange({
        pins: [pin("p1", "One")],
        now,
        command: { type: "thread.rule-pin.add", pinId: "p1", text: "Again" },
      })._tag,
      "rejected",
    );
    assert.equal(
      planRulePinChange({
        pins: Array.from({ length: THREAD_RULE_PINS_MAX_COUNT }, (_, i) => pin(`p${i}`, "x")),
        now,
        command: { type: "thread.rule-pin.add", pinId: "extra", text: "One too many" },
      })._tag,
      "rejected",
    );
  });

  it("rejects an add that names neither or both of text and a message", () => {
    const sourceMessageId = MessageId.make("message-1");
    assert.equal(
      planRulePinChange({
        pins: [],
        now,
        command: { type: "thread.rule-pin.add", pinId: "p1" },
      })._tag,
      "rejected",
    );
    assert.equal(
      planRulePinChange({
        pins: [],
        now,
        command: { type: "thread.rule-pin.add", pinId: "p1", text: "x", sourceMessageId },
        sourceMessage: { id: sourceMessageId, text: "y" },
      })._tag,
      "rejected",
    );
  });

  it("edits one pin in place and keeps its position, source and creation time", () => {
    const sourceMessageId = MessageId.make("message-1");
    const original = { ...pin("p2", "Two"), sourceMessageId };
    const plan = planRulePinChange({
      pins: [pin("p1", "One"), original, pin("p3", "Three")],
      now,
      command: { type: "thread.rule-pin.edit", pinId: "p2", text: "Two, reworded" },
    });
    assert.deepEqual(plan, {
      _tag: "changed",
      pins: [pin("p1", "One"), { ...original, text: "Two, reworded" }, pin("p3", "Three")],
    });
  });

  it("removes one pin and keeps the order of the rest", () => {
    const plan = planRulePinChange({
      pins: [pin("p1", "One"), pin("p2", "Two"), pin("p3", "Three")],
      now,
      command: { type: "thread.rule-pin.remove", pinId: "p2" },
    });
    assert.deepEqual(plan, { _tag: "changed", pins: [pin("p1", "One"), pin("p3", "Three")] });
  });

  it("rejects an edit of an unknown pin", () => {
    const plan = planRulePinChange({
      pins: [pin("p1", "One")],
      now,
      command: { type: "thread.rule-pin.edit", pinId: "missing", text: "x" },
    });
    assert.equal(plan._tag, "rejected");
  });

  it("treats a retried remove of a pin that is already gone as a no-op", () => {
    assert.deepEqual(
      planRulePinChange({
        pins: [pin("p1", "One")],
        now,
        command: { type: "thread.rule-pin.remove", pinId: "missing" },
      }),
      { _tag: "unchanged" },
    );
  });

  it("pins a message that mentions the context protocol as prose", () => {
    const sourceMessageId = MessageId.make("message-1");
    const text = "Links like t3-context: are internal; never print a <t3_context-style tag.";
    const plan = planRulePinChange({
      pins: [],
      now,
      command: { type: "thread.rule-pin.add", pinId: "p1", sourceMessageId },
      sourceMessage: { id: sourceMessageId, text },
    });
    assert.deepEqual(plan, {
      _tag: "changed",
      pins: [{ id: "p1", text, sourceMessageId, createdAt: now }],
    });
  });

  it("rejects a message with leftover link syntax that did not parse as a reference", () => {
    const sourceMessageId = MessageId.make("message-1");
    const plan = planRulePinChange({
      pins: [],
      now,
      command: { type: "thread.rule-pin.add", pinId: "p1", sourceMessageId },
      sourceMessage: { id: sourceMessageId, text: "See [x](t3-context://v1/bad kind/id) now" },
    });
    assert.equal(plan._tag, "rejected");
  });
});
