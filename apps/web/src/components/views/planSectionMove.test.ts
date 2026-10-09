import { describe, expect, it } from "vite-plus/test";

import { planSectionMove } from "./viewEngine";

const plain = { archived: false, snoozed: false, settled: false, pinned: false };

describe("planSectionMove", () => {
  it("lets pin, snooze and settle replace the state they leave", () => {
    expect(planSectionMove({ ...plain, snoozed: true }, "settled")).toEqual(["settle"]);
    expect(planSectionMove({ ...plain, settled: true }, "pinned")).toEqual(["pin"]);
    expect(planSectionMove({ ...plain, settled: true }, "snoozed")).toEqual(["snooze"]);
  });

  it("clears every state a thread still carries when it goes back to active", () => {
    expect(
      planSectionMove({ archived: true, snoozed: true, settled: true, pinned: true }, "active"),
    ).toEqual(["unarchive", "unsnooze", "unsettle", "unpin"]);
    expect(planSectionMove({ ...plain, pinned: true }, "active")).toEqual(["unpin"]);
  });

  it("restores archived threads first and archives in one step", () => {
    expect(planSectionMove({ ...plain, archived: true }, "pinned")).toEqual(["unarchive", "pin"]);
    expect(planSectionMove({ ...plain, snoozed: true }, "archived")).toEqual(["archive"]);
  });

  it("does nothing to a thread already there", () => {
    expect(planSectionMove({ ...plain, settled: true }, "settled")).toEqual([]);
    expect(planSectionMove({ ...plain, pinned: true }, "pinned")).toEqual([]);
  });
});
