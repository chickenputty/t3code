export const MOBILE_SIDEBAR_EDGE_SWIPE_START_THRESHOLD_PX = 24;
export const MOBILE_SIDEBAR_EDGE_SWIPE_ACTIVATION_DISTANCE_PX = 32;
export const MOBILE_SIDEBAR_EDGE_SWIPE_DIRECTION_LOCK_DISTANCE_PX = 10;
export const MOBILE_SIDEBAR_EDGE_SWIPE_MAX_VERTICAL_DRIFT_PX = 72;

type MobileSidebarSwipeEdge = "left" | "right";

export interface MobileSidebarSwipeState {
  edge: MobileSidebarSwipeEdge;
  handled: boolean;
  startX: number;
  startY: number;
  viewportWidth: number;
}

export type MobileSidebarSwipeResult =
  | "pending"
  | "cancel"
  | "open-left-menu"
  | "block-history-swipe";

export function beginMobileSidebarSwipe(input: {
  clientX: number;
  clientY: number;
  sidebarOpen: boolean;
  viewportWidth: number;
}): MobileSidebarSwipeState | null {
  if (input.sidebarOpen || input.viewportWidth <= 0) {
    return null;
  }

  if (input.clientX <= MOBILE_SIDEBAR_EDGE_SWIPE_START_THRESHOLD_PX) {
    return {
      edge: "left",
      handled: false,
      startX: input.clientX,
      startY: input.clientY,
      viewportWidth: input.viewportWidth,
    };
  }

  if (
    input.viewportWidth - input.clientX <= MOBILE_SIDEBAR_EDGE_SWIPE_START_THRESHOLD_PX
  ) {
    return {
      edge: "right",
      handled: false,
      startX: input.clientX,
      startY: input.clientY,
      viewportWidth: input.viewportWidth,
    };
  }

  return null;
}

export function updateMobileSidebarSwipe(
  state: MobileSidebarSwipeState,
  input: {
    clientX: number;
    clientY: number;
  },
): MobileSidebarSwipeResult {
  if (state.handled) {
    return state.edge === "left" ? "open-left-menu" : "block-history-swipe";
  }

  const deltaX = input.clientX - state.startX;
  const deltaY = input.clientY - state.startY;
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);

  if (absDeltaY > MOBILE_SIDEBAR_EDGE_SWIPE_MAX_VERTICAL_DRIFT_PX) {
    return "cancel";
  }

  if (absDeltaX < MOBILE_SIDEBAR_EDGE_SWIPE_DIRECTION_LOCK_DISTANCE_PX) {
    return "pending";
  }

  if (absDeltaY > absDeltaX) {
    return "cancel";
  }

  if (state.edge === "left") {
    if (deltaX <= 0) {
      return "cancel";
    }

    return deltaX >= MOBILE_SIDEBAR_EDGE_SWIPE_ACTIVATION_DISTANCE_PX
      ? "open-left-menu"
      : "pending";
  }

  if (deltaX >= 0) {
    return "cancel";
  }

  return Math.abs(deltaX) >= MOBILE_SIDEBAR_EDGE_SWIPE_ACTIVATION_DISTANCE_PX
    ? "block-history-swipe"
    : "pending";
}

export function markMobileSidebarSwipeHandled(
  state: MobileSidebarSwipeState,
): MobileSidebarSwipeState {
  if (state.handled) {
    return state;
  }

  return { ...state, handled: true };
}
