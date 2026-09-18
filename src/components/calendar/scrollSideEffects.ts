/**
 * Coalesce expensive scroll side-effects (window remount, month label) so
 * native momentum is never blocked by React setState on every frame.
 *
 * Pass the run callback on each schedule — avoids capturing React refs in a
 * long-lived closure (Hermes TDZ / "Property doesn't exist" on reload).
 */
export function createScrollSideEffectScheduler() {
  let raf = 0;
  let pendingX: number | null = null;
  let pendingRun: ((x: number) => void) | null = null;

  return {
    schedule(x: number, run: (x: number) => void) {
      pendingX = x;
      pendingRun = run;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = pendingX;
        const fn = pendingRun;
        pendingX = null;
        pendingRun = null;
        if (next == null || !fn) return;
        fn(next);
      });
    },
    flush() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      const next = pendingX;
      const fn = pendingRun;
      pendingX = null;
      pendingRun = null;
      if (next == null || !fn) return;
      fn(next);
    },
    dispose() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      pendingX = null;
      pendingRun = null;
    },
  };
}
