import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  filterSharedServerPatch,
  pickSharedServerSettings,
  splitSharedServerPatch,
} from "./sharedSettings.ts";

const restartCapabilities = { threadRestartContinuation: true };

describe("filterSharedServerPatch", () => {
  it.each([true, false])(
    "resets a disabled default provider only on the originating environment (%s)",
    (targetIsSource) => {
      const settings = {
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: {
          codex: { driver: ProviderDriverKind.make("codex"), enabled: false, config: {} },
          claudeAgent: {
            driver: ProviderDriverKind.make("claudeAgent"),
            enabled: true,
            config: {},
          },
        },
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
      };
      const patch = {
        textGenerationModelSelection: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
        continueThreadsAfterServerUpdate: true,
        sidebarAutoSettleAfterDays: 7,
      };
      expect(filterSharedServerPatch(patch, undefined, settings, settings, targetIsSource)).toEqual(
        {
          ...(targetIsSource
            ? { textGenerationModelSelection: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection }
            : {}),
          sidebarAutoSettleAfterDays: 7,
        },
      );
    },
  );

  it.each(["missing", "disabled", "different-driver", "enabled"] as const)(
    "shares a custom model only when its target provider is enabled (%s)",
    (availability) => {
      const instanceId = ProviderInstanceId.make("codex_personal");
      const selection = {
        instanceId,
        model: "gpt-5.6-luna",
        options: [{ id: "reasoningEffort", value: "low" }],
      };
      const instance = {
        driver: ProviderDriverKind.make(
          availability === "different-driver" ? "claudeAgent" : "codex",
        ),
        enabled: availability !== "disabled",
        config: {},
      };
      const settings = {
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: availability === "missing" ? {} : { [instanceId]: instance },
      };
      const patch = { sidebarAutoSettleAfterDays: 7, textGenerationModelSelection: selection };
      const sourceSettings = {
        ...settings,
        providerInstances: {
          [instanceId]: { ...instance, driver: ProviderDriverKind.make("codex"), enabled: true },
        },
      };
      expect(filterSharedServerPatch(patch, restartCapabilities, settings, sourceSettings)).toEqual(
        availability === "enabled" ? patch : { sidebarAutoSettleAfterDays: 7 },
      );
    },
  );

  it.each([undefined, {}, { threadRestartContinuation: false }])(
    "omits only the unsupported restart preference with capabilities %j",
    (capabilities) => {
      expect(
        filterSharedServerPatch(
          { continueThreadsAfterServerUpdate: true, sidebarAutoSettleAfterDays: 7 },
          capabilities,
        ),
      ).toEqual({ sidebarAutoSettleAfterDays: 7 });
      expect(pickSharedServerSettings(DEFAULT_SERVER_SETTINGS, capabilities)).not.toHaveProperty(
        "continueThreadsAfterServerUpdate",
      );
    },
  );
});

describe("saved views", () => {
  const view = {
    id: "v1",
    name: "Board",
    layout: "board" as const,
    filter: { conjunction: "and" as const, conditions: [] },
    sorts: [],
    groupBy: "project",
    properties: [],
    cardSize: "medium" as const,
    preview: "last" as const,
    density: "comfortable" as const,
    showArchived: false,
    showSettled: true,
    showSubagents: false,
    hideEmptyGroups: true,
    openMode: "peek" as const,
    threads: {
      sort: { field: "manual" as const, reversed: false },
      projectSort: { field: "activity" as const, reversed: false },
      pinsStayGrouped: false,
    },
  };

  it("are a shared preference", () => {
    expect(splitSharedServerPatch({ savedViews: [view] }).sharedPatch).toEqual({
      savedViews: [view],
    });
  });

  it("only reach servers that store them", () => {
    const patch = { savedViews: [view], sidebarAutoSettleAfterDays: 7 };
    expect(filterSharedServerPatch(patch, { savedViews: true })).toEqual(patch);
    expect(filterSharedServerPatch(patch, {})).toEqual({ sidebarAutoSettleAfterDays: 7 });
  });

  it("send categories only to servers that store them", () => {
    const threadCategories = {
      categories: [{ id: "c", name: "Update 100" }],
      assignments: { "env:t": "c" },
    };
    expect(splitSharedServerPatch({ threadCategories }).sharedPatch).toEqual({ threadCategories });
    expect(filterSharedServerPatch({ threadCategories }, { savedViews: true })).toEqual({});
    expect(filterSharedServerPatch({ threadCategories }, { threadCategories: true })).toEqual({
      threadCategories,
    });
  });
});
