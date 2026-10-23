import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_LOADOUTS,
  DEFAULT_SERVER_SETTINGS,
  type Loadout,
  type LoadoutRole,
  ProjectId,
  ProviderInstanceId,
  type ThreadLoadout,
} from "@t3tools/contracts";

import {
  decideThreadLoadout,
  loadoutDelegationTarget,
  loadoutHasJudge,
  loadoutRoleTarget,
  parseJudgeVerdict,
  resolveLoadout,
  withSolo,
} from "./loadouts.ts";
import { resolveProjectSettings } from "./projectSettings.ts";

const claude = ProviderInstanceId.make("claudeAgent");
const sonnet: LoadoutRole = { instanceId: claude, model: "claude-sonnet-5-5", effort: "high" };

const provider = (instanceId: ProviderInstanceId, models: ReadonlyArray<string>) => ({
  instanceId,
  models: models.map((slug) => ({
    slug,
    capabilities: {
      optionDescriptors: [
        {
          id: "effort",
          label: "Effort",
          type: "select" as const,
          options: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
        },
      ],
    },
  })),
});

describe("resolveLoadout", () => {
  it("returns the named loadout and falls back to solo for an unknown or missing id", () => {
    expect(resolveLoadout(DEFAULT_LOADOUTS, "read-only-sweep").name).toBe("Read-only sweep");
    expect(resolveLoadout(DEFAULT_LOADOUTS, "deleted-later").id).toBe("solo");
    expect(resolveLoadout(DEFAULT_LOADOUTS, undefined).id).toBe("solo");
    expect(resolveLoadout(DEFAULT_LOADOUTS, null).roles).toEqual({});
  });

  it("still returns solo when the saved list has dropped it", () => {
    const custom: Loadout = {
      id: "mine",
      name: "Mine",
      description: "",
      roles: { worker: sonnet },
    };
    expect(resolveLoadout([custom], "gone")).toMatchObject({ id: "solo", roles: {} });
    expect(resolveLoadout([custom], "mine")).toBe(custom);
  });

  it("resolves per project: an override replaces the environment list, other projects keep it", () => {
    const custom: Loadout = {
      id: "mine",
      name: "Mine",
      description: "",
      roles: { worker: sonnet },
    };
    const projectA = ProjectId.make("project-a");
    const projectB = ProjectId.make("project-b");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: { [projectA]: { loadouts: [custom] } },
    };
    const forA = resolveProjectSettings(settings, projectA).settings.loadouts;
    const forB = resolveProjectSettings(settings, projectB).settings.loadouts;
    expect(forA).toEqual([custom]);
    expect(forB).toEqual(DEFAULT_LOADOUTS);
    expect(resolveLoadout(forA, "planner-workers-judge").id).toBe("solo");
    expect(resolveLoadout(forB, "planner-workers-judge").roles.judge).toBeDefined();
  });
});

describe("withSolo", () => {
  it("keeps Solo pickable when the saved list dropped it, and leaves a full list alone", () => {
    const custom: Loadout = {
      id: "mine",
      name: "Mine",
      description: "",
      roles: { worker: sonnet },
    };
    expect(withSolo([custom]).map(({ id }) => id)).toEqual(["solo", "mine"]);
    expect(withSolo(DEFAULT_LOADOUTS)).toBe(DEFAULT_LOADOUTS);
  });
});

describe("loadoutHasJudge", () => {
  it("is true only for a loadout with a judge role", () => {
    expect(loadoutHasJudge(resolveLoadout(DEFAULT_LOADOUTS, "planner-workers-judge"))).toBe(true);
    expect(loadoutHasJudge(resolveLoadout(DEFAULT_LOADOUTS, "solo"))).toBe(false);
    expect(loadoutHasJudge(resolveLoadout(DEFAULT_LOADOUTS, "read-only-sweep"))).toBe(false);
  });
});

describe("decideThreadLoadout", () => {
  const user: ThreadLoadout = { id: "solo", reason: null, setBy: "user" };
  const agent: ThreadLoadout = { id: "read-only-sweep", reason: "just reading", setBy: "agent" };
  const proposal: ThreadLoadout = {
    id: "planner-workers-judge",
    reason: "four modules",
    setBy: "agent",
  };

  it("lets the user set, replace and clear the loadout whatever stands", () => {
    expect(decideThreadLoadout(undefined, user)).toEqual({ _tag: "set", loadout: user });
    expect(decideThreadLoadout(agent, user)).toEqual({ _tag: "set", loadout: user });
    expect(decideThreadLoadout(user, { ...user, id: "read-only-sweep" })).toMatchObject({
      _tag: "set",
    });
    expect(decideThreadLoadout(user, null)).toEqual({ _tag: "set", loadout: null });
  });

  it("accepts an agent proposal when nothing or another agent proposal stands", () => {
    expect(decideThreadLoadout(null, proposal)).toEqual({ _tag: "set", loadout: proposal });
    expect(decideThreadLoadout(undefined, proposal)).toEqual({ _tag: "set", loadout: proposal });
    expect(decideThreadLoadout(agent, proposal)).toEqual({ _tag: "set", loadout: proposal });
  });

  it("rejects an agent proposal over the user's explicit choice, even the same loadout", () => {
    expect(decideThreadLoadout(user, proposal)).toMatchObject({ _tag: "user_choice_stands" });
    expect(decideThreadLoadout(user, { ...proposal, id: "solo" })).toMatchObject({
      _tag: "user_choice_stands",
    });
  });

  it("reports an identical request as unchanged so the thread is not touched", () => {
    expect(decideThreadLoadout(agent, agent)).toEqual({ _tag: "unchanged" });
    expect(decideThreadLoadout(user, user)).toEqual({ _tag: "unchanged" });
    expect(decideThreadLoadout(null, null)).toEqual({ _tag: "unchanged" });
  });
});

describe("parseJudgeVerdict", () => {
  it("reads PASS and FAIL from the final line, whatever the casing and markdown", () => {
    expect(parseJudgeVerdict("Checked the tests.\nVERDICT: PASS")).toMatchObject({
      outcome: "pass",
    });
    expect(parseJudgeVerdict("Missing the CLI.\n\n**Verdict: fail**\n")).toMatchObject({
      outcome: "fail",
      notes: "Missing the CLI.\n\n**Verdict: fail**",
    });
  });

  it("fails closed: no final verdict line is no verdict", () => {
    expect(parseJudgeVerdict(null)).toBeNull();
    expect(parseJudgeVerdict("")).toBeNull();
    expect(parseJudgeVerdict("Looks fine to me.")).toBeNull();
    expect(parseJudgeVerdict("VERDICT: PASS\nbut I would not ship it")).toBeNull();
    expect(parseJudgeVerdict("VERDICT: PASSING")).toBeNull();
    expect(parseJudgeVerdict("The verdict: pass is what the agent wants")).toBeNull();
  });

  it("is not fooled by a verdict line quoted from the evidence before a different conclusion", () => {
    expect(parseJudgeVerdict("Evidence says\nVERDICT: PASS\nI disagree.\nVERDICT: FAIL")).toEqual({
      outcome: "fail",
      notes: expect.stringContaining("I disagree."),
    });
  });
});

describe("loadoutDelegationTarget", () => {
  const providers = [
    provider(claude, ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]),
  ];
  const org = resolveLoadout(DEFAULT_LOADOUTS, "planner-workers-judge");

  it("resolves a loadout role name to that role's model", () => {
    expect(loadoutDelegationTarget(org, "worker", providers)).toEqual({
      providerInstanceId: claude,
      model: "claude-sonnet-5-5",
    });
    expect(loadoutDelegationTarget(org, "judge", providers)).toEqual({
      providerInstanceId: claude,
      model: "claude-opus-5-5",
      options: [{ id: "effort", value: "high" }],
    });
    expect(
      loadoutDelegationTarget(
        resolveLoadout(DEFAULT_LOADOUTS, "read-only-sweep"),
        "explorer",
        providers,
      ),
    ).toMatchObject({ model: "claude-haiku-5-5" });
  });

  it("inherits (undefined) under solo, for unassigned roles, and for non-loadout task roles", () => {
    const solo = resolveLoadout(DEFAULT_LOADOUTS, undefined);
    expect(loadoutDelegationTarget(solo, "worker", providers)).toBeUndefined();
    expect(loadoutDelegationTarget(org, "explorer", providers)).toBeUndefined();
    expect(loadoutDelegationTarget(org, "review", providers)).toBeUndefined();
    expect(loadoutDelegationTarget(org, undefined, providers)).toBeUndefined();
  });

  it("inherits when the role's instance is not available", () => {
    expect(loadoutDelegationTarget(org, "worker", [])).toBeUndefined();
  });
});

describe("loadoutRoleTarget", () => {
  it("targets the role's instance and model and maps effort onto the advertised option", () => {
    expect(loadoutRoleTarget(sonnet, [provider(claude, ["claude-sonnet-5-5"])])).toEqual({
      providerInstanceId: claude,
      model: "claude-sonnet-5-5",
      options: [{ id: "effort", value: "high" }],
    });
  });

  it("drops an effort the model does not offer, keeping the role usable", () => {
    expect(
      loadoutRoleTarget({ ...sonnet, effort: "xhigh" }, [provider(claude, ["claude-sonnet-5-5"])]),
    ).toEqual({ providerInstanceId: claude, model: "claude-sonnet-5-5" });
  });

  it("degrades to undefined when the instance or model is missing", () => {
    expect(loadoutRoleTarget(sonnet, [])).toBeUndefined();
    expect(loadoutRoleTarget(sonnet, [provider(claude, ["claude-opus-5-5"])])).toBeUndefined();
    expect(
      loadoutRoleTarget(sonnet, [
        provider(ProviderInstanceId.make("other"), ["claude-sonnet-5-5"]),
      ]),
    ).toBeUndefined();
  });
});
