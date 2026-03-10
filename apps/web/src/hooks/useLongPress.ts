import { useCallback, useRef } from "react";

export interface LongPressHandlers {
  onTouchStart: (event: React.TouchEvent) => void;
  onTouchEnd: (event: React.TouchEvent) => void;
  onTouchMove: (event: React.TouchEvent) => void;
  onTouchCancel: (event: React.TouchEvent) => void;
}

/**
 * Hook that detects long press (touch-and-hold) gestures on mobile.
 * Returns touch event handlers to spread onto the target element.
 *
 * The callback receives the touch position { x, y } so the caller
 * can position a context menu at the press location.
 */
export function useLongPress(
  callback: (position: { x: number; y: number }) => void,
  { delay = 500, moveThreshold = 10 }: { delay?: number; moveThreshold?: number } = {},
): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      startPosRef.current = { x: touch.clientX, y: touch.clientY };
      firedRef.current = false;

      clear();
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        callback({ x: touch.clientX, y: touch.clientY });
      }, delay);
    },
    [callback, delay, clear],
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (!startPosRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startPosRef.current.x;
      const dy = touch.clientY - startPosRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > moveThreshold) {
        clear();
      }
    },
    [clear, moveThreshold],
  );

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      clear();
      // If long press fired, prevent the subsequent click/navigation
      if (firedRef.current) {
        event.preventDefault();
        firedRef.current = false;
      }
    },
    [clear],
  );

  const onTouchCancel = useCallback(() => {
    clear();
    firedRef.current = false;
  }, [clear]);

  return { onTouchStart, onTouchEnd, onTouchMove, onTouchCancel };
}
