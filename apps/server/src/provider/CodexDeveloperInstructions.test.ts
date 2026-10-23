import * as NodeAssert from "node:assert/strict";

import {
  T3_CODE_ORCHESTRATION_INSTRUCTIONS,
  T3_CODE_ORCHESTRATION_SECTIONS,
} from "@t3tools/provider-core/server/orchestrationInstructions";
import { describe, it } from "vite-plus/test";

import {
  buildCodexAdditionalContext,
  buildCodexPinnedRulesContext,
  CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
} from "./CodexDeveloperInstructions.ts";

describe("buildCodexAdditionalContext", () => {
  describe.each([
    { model: "gpt-5.3-codex", reasoningEffort: "high" },
    { model: "custom-model", modelName: "Custom 🦊 Model", reasoningEffort: "xhigh" },
  ])("with runtime $model", (runtime) => {
    it.each([
      undefined,
      false,
      true,
      { browser: false, device: false },
      { browser: true, device: false },
      { browser: false, device: true },
      { browser: true, device: true },
    ])("keeps every entry within Codex's per-entry cap with tools %j", (availability) => {
      const context = buildCodexAdditionalContext(runtime, availability);

      for (const [key, entry] of Object.entries(context)) {
        // Codex counts ceil(UTF-8 bytes / 4) tokens, excluding keys and wrappers.
        const bytes = Buffer.byteLength(entry.value, "utf8");
        const limit = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES;
        NodeAssert.ok(
          bytes <= limit,
          `${key}: ${bytes} UTF-8 bytes exceeds Codex's ${limit}-byte per-entry cap by ${bytes - limit} bytes; split the instructions into separate entries to avoid silent truncation`,
        );
      }
    });
  });

  it("delivers all orchestration sections in authored order when keys are sorted", () => {
    const context = buildCodexAdditionalContext({
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    });
    const sections = Object.keys(context)
      .filter((key) => key.startsWith("t3_code_orchestration_"))
      .sort()
      .map((key) => context[key]!);

    NodeAssert.deepEqual(
      sections,
      T3_CODE_ORCHESTRATION_SECTIONS.map((value) => ({ kind: "application", value })),
    );
    NodeAssert.equal(
      sections.map((entry) => entry.value).join("\n\n"),
      T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim(),
    );
  });
});

describe("buildCodexPinnedRulesContext", () => {
  it("keeps short rules under one trusted key", () => {
    NodeAssert.deepEqual(buildCodexPinnedRulesContext("Rule one\nRule two"), {
      pinned_rules: { kind: "application", value: "Rule one\nRule two" },
    });
    NodeAssert.deepEqual(buildCodexPinnedRulesContext(""), {});
  });

  it("splits rules over the per-entry cap into ordered keys that rejoin verbatim", () => {
    // Multi-byte characters make a split mid-codepoint or mid-cap easy to get wrong.
    const rules = "Rule 🦊 ".repeat(1_500);
    const context = buildCodexPinnedRulesContext(rules);
    const entries = Object.entries(context).sort(([a], [b]) => a.localeCompare(b));

    NodeAssert.ok(entries.length > 1);
    for (const [, entry] of entries) {
      NodeAssert.equal(entry.kind, "application");
      NodeAssert.ok(
        Buffer.byteLength(entry.value, "utf8") <= CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
      );
    }
    NodeAssert.equal(entries.map(([, entry]) => entry.value).join(""), rules);
  });

  it("cuts at the last newline under the cap and falls back to a character boundary", () => {
    const line = `${"x".repeat(99)}\n`;
    const byLines = line.repeat(100);
    const lineChunks = Object.values(buildCodexPinnedRulesContext(byLines)).map((e) => e.value);
    NodeAssert.ok(lineChunks.length > 1);
    for (const chunk of lineChunks.slice(0, -1)) NodeAssert.ok(chunk.endsWith("\n"));
    NodeAssert.equal(lineChunks.join(""), byLines);

    const unbroken = "y".repeat(CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES + 10);
    const unbrokenChunks = Object.values(buildCodexPinnedRulesContext(unbroken)).map(
      (e) => e.value,
    );
    NodeAssert.deepEqual(
      unbrokenChunks.map((chunk) => chunk.length),
      [CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES, 10],
    );
  });
});

describe("buildCodexDeveloperInstructions", () => {
  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = runtimeInstructions({
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

function runtimeInstructions(runtime: Parameters<typeof buildCodexAdditionalContext>[0]) {
  return buildCodexAdditionalContext(runtime).t3_code_runtime!.value;
}
