import { describe, expect, it } from "vitest";

import {
  beginMobileSidebarSwipe,
  markMobileSidebarSwipeHandled,
  updateMobileSidebarSwipe,
} from "./mobileSidebarSwipe";

describe("mobileSidebarSwipe", () => {
  it("starts a left-edge gesture when touch begins near the left edge", () => {
    expect(
      beginMobileSidebarSwipe({
        clientX: 12,
        clientY: 40,
        sidebarOpen: false,
        viewportWidth: 390,
      }),
    ).toMatchObject({
      edge: "left",
      handled: false,
      startX: 12,
      startY: 40,
      viewportWidth: 390,
    });
  });

  it("starts a right-edge gesture when touch begins near the right edge", () => {
    expect(
      beginMobileSidebarSwipe({
        clientX: 382,
        clientY: 40,
        sidebarOpen: false,
        viewportWidth: 390,
      }),
    ).toMatchObject({
      edge: "right",
    });
  });

  it("ignores touches that do not begin on an edge or when the sidebar is already open", () => {
    expect(
      beginMobileSidebarSwipe({
        clientX: 120,
        clientY: 40,
        sidebarOpen: false,
        viewportWidth: 390,
      }),
    ).toBeNull();

    expect(
      beginMobileSidebarSwipe({
        clientX: 12,
        clientY: 40,
        sidebarOpen: true,
        viewportWidth: 390,
      }),
    ).toBeNull();
  });

  it("opens the left menu after a sufficiently horizontal left-edge swipe", () => {
    const state = beginMobileSidebarSwipe({
      clientX: 8,
      clientY: 30,
      sidebarOpen: false,
      viewportWidth: 390,
    });

    expect(state).not.toBeNull();
    expect(updateMobileSidebarSwipe(state!, { clientX: 44, clientY: 34 })).toBe("open-left-menu");
  });

  it("blocks right-edge forward navigation after a sufficiently horizontal right-edge swipe", () => {
    const state = beginMobileSidebarSwipe({
      clientX: 386,
      clientY: 30,
      sidebarOpen: false,
      viewportWidth: 390,
    });

    expect(state).not.toBeNull();
    expect(updateMobileSidebarSwipe(state!, { clientX: 346, clientY: 35 })).toBe(
      "block-history-swipe",
    );
  });

  it("cancels when the gesture becomes vertical", () => {
    const state = beginMobileSidebarSwipe({
      clientX: 10,
      clientY: 30,
      sidebarOpen: false,
      viewportWidth: 390,
    });

    expect(state).not.toBeNull();
    expect(updateMobileSidebarSwipe(state!, { clientX: 16, clientY: 58 })).toBe("cancel");
  });

  it("keeps suppressing the gesture once it has been handled", () => {
    const state = beginMobileSidebarSwipe({
      clientX: 10,
      clientY: 30,
      sidebarOpen: false,
      viewportWidth: 390,
    });

    expect(state).not.toBeNull();
    const handledState = markMobileSidebarSwipeHandled(state!);
    expect(updateMobileSidebarSwipe(handledState, { clientX: 20, clientY: 30 })).toBe(
      "open-left-menu",
    );
  });
});
