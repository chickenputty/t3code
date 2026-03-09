import { describe, expect, it } from "vitest";

import {
  getAppModelOptions,
  getCustomModelsForProvider,
  getSlashModelOptions,
  normalizeCustomModelSlugs,
  patchCustomModelsForProvider,
  resolveAppModelSelection,
} from "./appSettings";

describe("normalizeCustomModelSlugs", () => {
  it("normalizes aliases, removes built-ins, and deduplicates values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model"]);
  });

  it("supports provider-specific Gemini custom models", () => {
    const options = getAppModelOptions("gemini", ["gemini/internal-preview"]);

    expect(options.at(-1)).toEqual({
      slug: "gemini/internal-preview",
      name: "gemini/internal-preview",
      isCustom: true,
    });
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "custom/internal-model",
    ]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("codex", [], "custom/selected-model");

    expect(options.at(-1)).toEqual({
      slug: "custom/selected-model",
      name: "custom/selected-model",
      isCustom: true,
    });
  });

  it("supports provider-specific Claude custom models", () => {
    const options = getAppModelOptions("claudeCode", ["claude-sonnet-5-0"]);

    expect(options.map((option) => option.slug)).toContain("claude-sonnet-5-0");
  });

  it("includes built-in Gemini image models in the picker catalog", () => {
    const options = getAppModelOptions("gemini", []);

    expect(options.map((option) => option.slug)).toContain("gemini-2.5-flash-image");
    expect(options.map((option) => option.slug)).toContain("gemini-3-pro-preview");
    expect(options.map((option) => option.slug)).not.toContain("gemini-3-pro-image-preview");
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(resolveAppModelSelection("codex", ["galapagos-alpha"], "galapagos-alpha")).toBe(
      "galapagos-alpha",
    );
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(resolveAppModelSelection("codex", [], "")).toBe("gpt-5.4");
  });

  it("upgrades a stale Gemini image preview slug to the supported preview model", () => {
    expect(resolveAppModelSelection("gemini", [], "gemini-3-pro-image-preview")).toBe(
      "gemini-3-pro-preview",
    );
  });
});

describe("getSlashModelOptions", () => {
  it("includes saved custom model slugs for /model command suggestions", () => {
    const options = getSlashModelOptions(
      "codex",
      ["custom/internal-model"],
      "",
      "gpt-5.3-codex",
    );

    expect(options.some((option) => option.slug === "custom/internal-model")).toBe(true);
  });

  it("filters slash-model suggestions across built-in and custom model names", () => {
    const options = getSlashModelOptions(
      "codex",
      ["openai/gpt-oss-120b"],
      "oss",
      "gpt-5.3-codex",
    );

    expect(options.map((option) => option.slug)).toEqual(["openai/gpt-oss-120b"]);
  });
});

describe("provider-specific custom models", () => {
  it("reads custom models for the requested provider", () => {
    expect(
      getCustomModelsForProvider(
        {
          customCodexModels: ["gpt-custom"],
          customGeminiModels: ["gemini-custom"],
        },
        "gemini",
      ),
    ).toEqual(["gemini-custom"]);
  });

  it("patches the correct settings key for Gemini custom models", () => {
    expect(patchCustomModelsForProvider("gemini", ["gemini-custom"])).toEqual({
      customGeminiModels: ["gemini-custom"],
    });
  });
});
