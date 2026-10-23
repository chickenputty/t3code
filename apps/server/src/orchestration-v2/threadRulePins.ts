import {
  THREAD_RULE_PIN_TEXT_MAX_LENGTH,
  THREAD_RULE_PINS_MAX_COUNT,
  THREAD_RULE_PINS_TOTAL_MAX_LENGTH,
  type MessageId,
  type ThreadRulePin,
} from "@t3tools/contracts";
import {
  hasUnresolvedComposerContext,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";

/**
 * The text delivered to providers for one turn: project rules, then the
 * thread's pins in the order they were made. With no thread pins the project
 * rules go through unchanged, so a project that never uses pins sees no new
 * headings. Pin text is never rewritten; `---` only separates pins.
 */
export function composePinnedRules(input: {
  readonly projectRules: string;
  readonly threadPins: ReadonlyArray<Pick<ThreadRulePin, "text">>;
}): string {
  if (input.threadPins.length === 0) return input.projectRules;
  return [
    ...(input.projectRules === "" ? [] : ["## Project pinned rules", "", input.projectRules, ""]),
    "## Thread pinned rules",
    "",
    input.threadPins.map((pin) => pin.text).join("\n\n---\n\n"),
  ].join("\n");
}

export type RulePinChange =
  | {
      readonly type: "thread.rule-pin.add";
      readonly pinId: string;
      readonly text?: string | undefined;
      readonly sourceMessageId?: MessageId | undefined;
    }
  | {
      readonly type: "thread.rule-pin.edit";
      readonly pinId: string;
      readonly text: string;
    }
  | { readonly type: "thread.rule-pin.remove"; readonly pinId: string };

export type RulePinPlan =
  | { readonly _tag: "changed"; readonly pins: ReadonlyArray<ThreadRulePin> }
  /** A retry of a change that already landed: nothing to write. */
  | { readonly _tag: "unchanged" }
  | { readonly _tag: "rejected"; readonly reason: string };

const rejected = (reason: string): RulePinPlan => ({ _tag: "rejected", reason });

/** The pin and combined caps; `replacing` is the pin an edit swaps out. */
function lengthIssue(
  text: string,
  pins: ReadonlyArray<Pick<ThreadRulePin, "id" | "text">>,
  replacing: string | undefined,
): string | null {
  if (text.length > THREAD_RULE_PIN_TEXT_MAX_LENGTH) {
    return `A rule pin holds at most ${THREAD_RULE_PIN_TEXT_MAX_LENGTH} characters; this text has ${text.length}.`;
  }
  const others = pins
    .filter((pin) => pin.id !== replacing)
    .reduce((total, pin) => total + pin.text.length, 0);
  if (others + text.length > THREAD_RULE_PINS_TOTAL_MAX_LENGTH) {
    return `A thread's pins hold at most ${THREAD_RULE_PINS_TOTAL_MAX_LENGTH} characters in total; this would make ${others + text.length}. Remove or shorten a pin first.`;
  }
  return null;
}

/**
 * Pure decision for a pin command, kept out of the orchestrator's dispatch so
 * its rejections are testable on their own. The caller loads `sourceMessage`
 * only for an add that names one, and passes `now` as an ISO string.
 */
export function planRulePinChange(input: {
  readonly pins: ReadonlyArray<ThreadRulePin>;
  readonly now: string;
  readonly command: RulePinChange;
  readonly sourceMessage?: { readonly id: MessageId; readonly text: string } | undefined;
}): RulePinPlan {
  const { pins, command } = input;
  switch (command.type) {
    case "thread.rule-pin.add": {
      if ((command.text === undefined) === (command.sourceMessageId === undefined)) {
        return rejected("A rule pin needs either text or a source message, not both.");
      }
      // Copied at pin time so the pin stays as pinned if the message is later
      // edited or reverted. Context references are resolved to their labels,
      // as the copy button does, so no raw link tokens reach the model.
      const text =
        command.sourceMessageId === undefined
          ? command.text!.trim()
          : input.sourceMessage?.id === command.sourceMessageId
            ? replaceComposerContextReferences(
                input.sourceMessage.text,
                (reference) => reference.label,
              ).trim()
            : undefined;
      if (text === undefined) return rejected(`Message ${command.sourceMessageId} was not found.`);
      const existing = pins.find((pin) => pin.id === command.pinId);
      if (existing !== undefined) {
        // A client retry after a lost reply repeats the same add.
        return existing.text === text &&
          existing.sourceMessageId === (command.sourceMessageId ?? null)
          ? { _tag: "unchanged" }
          : rejected(`Rule pin ${command.pinId} already exists.`);
      }
      if (pins.length >= THREAD_RULE_PINS_MAX_COUNT) {
        return rejected(`A thread holds at most ${THREAD_RULE_PINS_MAX_COUNT} rule pins.`);
      }
      if (text === "") return rejected("There is no text to pin.");
      // Legacy messages carry an envelope instead of records; there is no cheap
      // faithful text for them, so they are refused rather than pinned raw.
      if (command.sourceMessageId !== undefined && hasUnresolvedComposerContext(text)) {
        return rejected("This message has attached context that cannot be pinned as text.");
      }
      const tooLong = lengthIssue(text, pins, undefined);
      if (tooLong !== null) return rejected(tooLong);
      return {
        _tag: "changed",
        pins: [
          ...pins,
          {
            id: command.pinId,
            text,
            sourceMessageId: command.sourceMessageId ?? null,
            createdAt: input.now,
          },
        ],
      };
    }
    case "thread.rule-pin.edit": {
      const text = command.text.trim();
      if (!pins.some((pin) => pin.id === command.pinId)) {
        return rejected(`Rule pin ${command.pinId} was not found.`);
      }
      if (text === "") return rejected("There is no text to pin.");
      if (pins.find((pin) => pin.id === command.pinId)?.text === text) {
        return { _tag: "unchanged" };
      }
      const tooLong = lengthIssue(text, pins, command.pinId);
      if (tooLong !== null) return rejected(tooLong);
      return {
        _tag: "changed",
        pins: pins.map((pin) => (pin.id === command.pinId ? { ...pin, text } : pin)),
      };
    }
    case "thread.rule-pin.remove":
      // Already gone is the state the caller wanted, so a retry succeeds.
      return pins.some((pin) => pin.id === command.pinId)
        ? { _tag: "changed", pins: pins.filter((pin) => pin.id !== command.pinId) }
        : { _tag: "unchanged" };
  }
}
