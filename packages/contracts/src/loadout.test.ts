import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { LedgerJson } from "./ledger.ts";
import { DEFAULT_LOADOUTS, Loadout, SOLO_LOADOUT_ID } from "./loadout.ts";
import { ProjectSettingsOverrides, ServerSettings, ServerSettingsPatch } from "./settings.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeLoadout = Schema.decodeUnknownSync(Loadout);
const encodeLoadout = Schema.encodeSync(Loadout);
const decodeSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const decodeProjectOverrides = Schema.decodeUnknownSync(ProjectSettingsOverrides);
const decodeLedgerJson = Schema.decodeUnknownSync(LedgerJson);

describe("loadout settings", () => {
  it("defaults to the built-in loadouts, solo first", () => {
    const settings = decodeServerSettings({});
    expect(settings.loadouts).toEqual(DEFAULT_LOADOUTS);
    expect(settings.loadouts[0]?.id).toBe(SOLO_LOADOUT_ID);
    expect(settings.loadouts[0]?.roles).toEqual({});
  });

  it("keeps a customised list as stored instead of merging the built-ins back in", () => {
    const custom = {
      id: "mine",
      name: "Mine",
      description: "",
      roles: { worker: { instanceId: "claudeAgent", model: "claude-sonnet-5-5" } },
    };
    expect(decodeServerSettings({ loadouts: [custom] }).loadouts).toEqual([custom]);
  });

  it("ships built-ins that decode as loadouts and never name a role twice", () => {
    for (const loadout of DEFAULT_LOADOUTS) {
      expect(decodeLoadout(encodeLoadout(loadout))).toEqual(loadout);
    }
    expect(DEFAULT_LOADOUTS.map(({ id }) => id)).toEqual([
      "solo",
      "planner-workers-judge",
      "read-only-sweep",
    ]);
    expect(DEFAULT_LOADOUTS[1]?.roles.judge?.model).toBe("claude-opus-5-5");
  });

  it("accepts loadouts in a settings patch and a project override", () => {
    expect(decodeSettingsPatch({ loadouts: [] }).loadouts).toEqual([]);
    expect(decodeProjectOverrides({ loadouts: DEFAULT_LOADOUTS }).loadouts).toEqual(
      DEFAULT_LOADOUTS,
    );
  });
});

describe("ledger requiresJudge", () => {
  const stored = {
    id: "ledger:old",
    threadId: "thread:old",
    title: "Old",
    startState: "",
    checkpoints: [],
    winConditions: [],
    items: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    closedAt: null,
  };

  it("decodes a record written before the field existed, leaving it unset", () => {
    expect(decodeLedgerJson(stored).requiresJudge).toBeUndefined();
    expect(decodeLedgerJson({ ...stored, requiresJudge: true })).toMatchObject({
      requiresJudge: true,
    });
  });
});
