import {
  THREAD_RULE_PIN_TEXT_MAX_LENGTH,
  THREAD_RULE_PINS_MAX_COUNT,
  type MessageId,
  type ThreadRulePin,
} from "@t3tools/contracts";

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
  | { readonly _tag: "rejected"; readonly reason: string };

const rejected = (reason: string): RulePinPlan => ({ _tag: "rejected", reason });

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
      if (pins.some((pin) => pin.id === command.pinId)) {
        return rejected(`Rule pin ${command.pinId} already exists.`);
      }
      if (pins.length >= THREAD_RULE_PINS_MAX_COUNT) {
        return rejected(`A thread holds at most ${THREAD_RULE_PINS_MAX_COUNT} rule pins.`);
      }
      // Copied at pin time so the pin stays as pinned if the message is later
      // edited or reverted.
      const text =
        command.sourceMessageId === undefined
          ? command.text!.trim()
          : input.sourceMessage?.id === command.sourceMessageId
            ? input.sourceMessage.text.trim()
            : undefined;
      if (text === undefined) return rejected(`Message ${command.sourceMessageId} was not found.`);
      if (text === "") return rejected("There is no text to pin.");
      if (text.length > THREAD_RULE_PIN_TEXT_MAX_LENGTH) {
        return rejected(
          `A rule pin holds at most ${THREAD_RULE_PIN_TEXT_MAX_LENGTH} characters; this text has ${text.length}.`,
        );
      }
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
      if (text.length > THREAD_RULE_PIN_TEXT_MAX_LENGTH) {
        return rejected(
          `A rule pin holds at most ${THREAD_RULE_PIN_TEXT_MAX_LENGTH} characters; this text has ${text.length}.`,
        );
      }
      return {
        _tag: "changed",
        pins: pins.map((pin) => (pin.id === command.pinId ? { ...pin, text } : pin)),
      };
    }
    case "thread.rule-pin.remove":
      return pins.some((pin) => pin.id === command.pinId)
        ? { _tag: "changed", pins: pins.filter((pin) => pin.id !== command.pinId) }
        : rejected(`Rule pin ${command.pinId} was not found.`);
  }
}
