export const HOLD_DELAY = 100;
export const TOUCH_SLOP = 5;

/**
 * One native hold. Timer and onLongPress share an armed flag so a second measure cannot reset the session.
 * 100ms is long enough that ordinary pans cancel via TOUCH_SLOP before arm, and short enough that a
 * deliberate press-still-then-move (and UI automation swipe dwell) can arm drag without fighting scroll.
 */
export function createNativeHold(start: (pageX: number, pageY: number) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let at = { x: 0, y: 0 };
  let armed = false;
  let cancelled = false;

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function arm(pageX: number, pageY: number) {
    if (armed || cancelled) return;
    armed = true;
    clearTimer();
    start(pageX, pageY);
  }

  return {
    get armed() {
      return armed;
    },
    dispose() {
      clearTimer();
    },
    pressIn(pageX: number, pageY: number) {
      clearTimer();
      armed = false;
      cancelled = false;
      at = { x: pageX, y: pageY };
      timer = setTimeout(() => {
        timer = null;
        arm(pageX, pageY);
      }, HOLD_DELAY);
    },
    longPress(pageX: number, pageY: number) {
      arm(pageX, pageY);
    },
    touchMove(pageX: number, pageY: number) {
      if (!timer || cancelled) return;
      if (Math.hypot(pageX - at.x, pageY - at.y) > TOUCH_SLOP) {
        clearTimer();
        cancelled = true;
      }
    },
    touchEnd() {
      clearTimer();
      if (!armed) cancelled = true;
    },
  };
}
