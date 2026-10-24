import { expect, it } from "@effect/vitest";

import { AuthOrchestrationOperateScope, AuthSettingsWriteScope } from "./auth.ts";
import { clientRpcRequiredScopes } from "./clientRpcPermissions.ts";
import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";

const resolve = (action: "apply" | "dismiss") =>
  clientRpcRequiredScopes(ORCHESTRATION_V2_WS_METHODS.resolveTaskRetro, {
    threadId: "thread:one",
    recommendationId: "rec-1",
    action,
  });

it("applying a retro recommendation also needs the right to write settings", () => {
  expect(resolve("apply")).toEqual([AuthOrchestrationOperateScope, AuthSettingsWriteScope]);
});

it("dismissing one, and running a retro, need only the right to operate threads", () => {
  expect(resolve("dismiss")).toEqual([AuthOrchestrationOperateScope]);
  expect(clientRpcRequiredScopes(ORCHESTRATION_V2_WS_METHODS.runTaskRetro, undefined)).toEqual([
    AuthOrchestrationOperateScope,
  ]);
});
