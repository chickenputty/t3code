import type { MessageId, ScopedThreadRef } from "@t3tools/contracts";

import { useThreadRulePinList, useServerConfigs } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { randomUUID } from "~/lib/utils";

/**
 * The thread's rule pins and the commands that change them. `supported` is off
 * on servers from before rule pins, which would reject the commands, so
 * callers hide pinning there but still show pins already present.
 */
export type ThreadRulePinsApi = ReturnType<typeof useThreadRulePins>;

export function useThreadRulePins(threadRef: ScopedThreadRef | null) {
  const pins = useThreadRulePinList(threadRef);
  const configs = useServerConfigs();
  const supported =
    threadRef !== null &&
    configs.get(threadRef.environmentId)?.environment.capabilities.threadRulePins === true;
  const addPin = useOrchestrationCommand(threadEnvironment.addRulePin, { reportFailure: true });
  const editPin = useOrchestrationCommand(threadEnvironment.editRulePin, { reportFailure: true });
  const removePin = useOrchestrationCommand(threadEnvironment.removeRulePin, {
    reportFailure: true,
  });

  return {
    pins,
    supported,
    pinMessage: (messageId: MessageId) =>
      threadRef === null
        ? undefined
        : addPin({
            environmentId: threadRef.environmentId,
            input: {
              threadId: threadRef.threadId,
              pinId: randomUUID(),
              sourceMessageId: messageId,
            },
          }),
    addText: (text: string) =>
      threadRef === null
        ? undefined
        : addPin({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, pinId: randomUUID(), text },
          }),
    edit: (pinId: string, text: string) =>
      threadRef === null
        ? undefined
        : editPin({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, pinId, text },
          }),
    remove: (pinId: string) =>
      threadRef === null
        ? undefined
        : removePin({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, pinId },
          }),
  };
}
