import { describe, expect, it } from "vite-plus/test";

import { isReservedCommandId } from "./reservedCommandIds.ts";

describe("isReservedCommandId", () => {
  it("reserves the prefix MCP idempotency keys are built on", () => {
    expect(isReservedCommandId("command:mcp:session:ledger-judge:thread:key")).toBe(true);
    expect(isReservedCommandId("command:mcp:")).toBe(true);
  });

  it("leaves client ids alone, including ones with suffixes or similar prefixes", () => {
    expect(isReservedCommandId("0b8e6d1c-2f4a-4a53-9a55-5a3d7d0f2c11")).toBe(false);
    expect(isReservedCommandId("0b8e6d1c-2f4a-4a53-9a55-5a3d7d0f2c11:model-selection")).toBe(false);
    expect(isReservedCommandId("command:mcp-replay-parent:create")).toBe(false);
    expect(isReservedCommandId("mcp:0b8e6d1c")).toBe(false);
    expect(isReservedCommandId("x command:mcp:y")).toBe(false);
  });
});
