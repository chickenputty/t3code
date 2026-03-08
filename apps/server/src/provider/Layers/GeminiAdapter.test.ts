import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { materializeGeminiAssistantImageAttachment } from "./GeminiAdapter.ts";

const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

describe("materializeGeminiAssistantImageAttachment", () => {
  it.effect("persists inline Gemini image output into the attachment store", () =>
    Effect.gen(function* () {
      const stateDir = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "t3code-gemini-image-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      );
      const fileSystem = yield* FileSystem.FileSystem;

      const attachment = yield* materializeGeminiAssistantImageAttachment({
        rawEvent: {
          threadId: "thread-image-output",
          mimeType: "image/png",
          data: "ZmFrZQ==",
          name: "generated.png",
        },
        threadId: asThreadId("thread-image-output"),
        stateDir,
        fileSystem,
      });

      assert.equal(attachment.type, "image");
      assert.equal(attachment.mimeType, "image/png");
      assert.equal(attachment.name, "generated.png");
      assert.equal(attachment.sizeBytes, 4);

      const attachmentsDir = path.join(stateDir, "attachments");
      const files = fs.readdirSync(attachmentsDir);
      assert.equal(files.length, 1);
      const persistedBytes = fs.readFileSync(path.join(attachmentsDir, files[0]!));
      assert.equal(persistedBytes.toString("utf8"), "fake");
    }).pipe(
      Effect.provide(NodeServices.layer),
    ));
});
