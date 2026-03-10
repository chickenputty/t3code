import type { ChatAttachment, ProviderKind } from "@t3tools/contracts";
import { Effect, FileSystem } from "effect";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { ProviderAdapterRequestError, type ProviderAdapterError } from "./Errors.ts";

export interface PromptImageAttachmentData {
  readonly attachment: ChatAttachment;
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly base64: string;
}

export function readPromptImageAttachment(input: {
  readonly attachment: ChatAttachment;
  readonly stateDir: string;
  readonly provider: ProviderKind;
  readonly method: string;
  readonly fileSystem: FileSystem.FileSystem;
}): Effect.Effect<PromptImageAttachmentData, ProviderAdapterError> {
  return Effect.gen(function* () {
    const attachmentPath = resolveAttachmentPath({
      stateDir: input.stateDir,
      attachment: input.attachment,
    });
    if (!attachmentPath) {
      return yield* new ProviderAdapterRequestError({
        provider: input.provider,
        method: input.method,
        detail: `Invalid attachment id '${input.attachment.id}'.`,
      });
    }

    const bytes = yield* input.fileSystem.readFile(attachmentPath).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: input.provider,
            method: input.method,
            detail: `Failed to read attachment '${input.attachment.name}'.`,
            cause: cause instanceof Error ? cause : undefined,
          }),
      ),
    );

    return {
      attachment: input.attachment,
      path: attachmentPath,
      bytes,
      base64: Buffer.from(bytes).toString("base64"),
    };
  });
}
