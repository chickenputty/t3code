import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  clampThreadSplitRatio,
  resolveSidebarSplitViewAction,
  resolveThreadSplitSecondary,
  THREAD_SPLIT_MAX_RATIO,
  THREAD_SPLIT_MIN_RATIO,
  useThreadSplitStore,
} from "./threadSplitStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));
const keyA = scopedThreadKey(refA);
const keyB = scopedThreadKey(refB);

describe("resolveThreadSplitSecondary", () => {
  it("shows the split thread beside a different routed thread", () => {
    expect(resolveThreadSplitSecondary({ routeThreadKey: keyA, secondaryThreadKey: keyB })).toEqual(
      refB,
    );
  });

  it("is a single pane when the routed thread is the split thread", () => {
    expect(
      resolveThreadSplitSecondary({ routeThreadKey: keyB, secondaryThreadKey: keyB }),
    ).toBeNull();
  });

  it("is a single pane without a split thread", () => {
    expect(
      resolveThreadSplitSecondary({ routeThreadKey: keyA, secondaryThreadKey: null }),
    ).toBeNull();
  });
});

describe("resolveSidebarSplitViewAction", () => {
  const base = { routeThreadKey: keyA, secondaryThreadKey: null, isMobile: false };

  it("offers to open any thread other than the routed one", () => {
    expect(resolveSidebarSplitViewAction({ ...base, threadKey: keyB })).toBe("open");
    expect(resolveSidebarSplitViewAction({ ...base, threadKey: keyA })).toBeNull();
  });

  it("offers to close the split on the thread that is in it", () => {
    expect(
      resolveSidebarSplitViewAction({ ...base, secondaryThreadKey: keyB, threadKey: keyB }),
    ).toBe("close");
  });

  it("does not offer a split on phones but still lets one close", () => {
    expect(resolveSidebarSplitViewAction({ ...base, isMobile: true, threadKey: keyB })).toBeNull();
    expect(
      resolveSidebarSplitViewAction({
        ...base,
        isMobile: true,
        secondaryThreadKey: keyB,
        threadKey: keyB,
      }),
    ).toBe("close");
  });
});

describe("useThreadSplitStore", () => {
  beforeEach(() => {
    useThreadSplitStore.setState({ secondaryThreadKey: null, focusedPane: "primary", ratio: 0.5 });
  });

  it("focuses the new pane on open and returns focus to the primary on close", () => {
    useThreadSplitStore.getState().openSplit(refB);
    expect(useThreadSplitStore.getState()).toMatchObject({
      secondaryThreadKey: keyB,
      focusedPane: "secondary",
    });
    useThreadSplitStore.getState().closeSplit();
    expect(useThreadSplitStore.getState()).toMatchObject({
      secondaryThreadKey: null,
      focusedPane: "primary",
    });
  });

  it("keeps the divider inside its bounds", () => {
    useThreadSplitStore.getState().setRatio(0.01);
    expect(useThreadSplitStore.getState().ratio).toBe(THREAD_SPLIT_MIN_RATIO);
    useThreadSplitStore.getState().setRatio(2);
    expect(useThreadSplitStore.getState().ratio).toBe(THREAD_SPLIT_MAX_RATIO);
    expect(clampThreadSplitRatio(Number.NaN)).toBe(0.5);
  });
});
