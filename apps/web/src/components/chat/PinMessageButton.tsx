import type { MessageId } from "@t3tools/contracts";
import { PinIcon, PinOffIcon } from "lucide-react";
import { memo, use } from "react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { messagePinState } from "../thread/threadRulePins.logic";
import { TimelineRowCtx } from "./timelineRowContext";

/**
 * Pins one message's text as a rule for this thread, or unpins it when it
 * already is. Hidden on environments that predate rule pins.
 */
export const PinMessageButton = memo(function PinMessageButton({
  messageId,
  text,
}: {
  readonly messageId: MessageId;
  readonly text: string;
}) {
  const ctx = use(TimelineRowCtx);
  const { rulePins } = ctx;
  if (!rulePins.supported) return null;
  const state = messagePinState({ messageId, text, pins: rulePins.pins });
  const label =
    state.kind === "pinned"
      ? "Unpin message"
      : state.kind === "unavailable"
        ? state.reason
        : "Pin message as a thread rule";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={label}
            aria-pressed={state.kind === "pinned"}
            disabled={state.kind === "unavailable"}
            onClick={() =>
              void (state.kind === "pinned"
                ? rulePins.remove(state.pinId)
                : rulePins.pinMessage(messageId))
            }
          />
        }
      >
        {state.kind === "pinned" ? (
          <PinOffIcon className="size-3 text-primary" />
        ) : (
          <PinIcon className="size-3" />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
});
