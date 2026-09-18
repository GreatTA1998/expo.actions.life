/**
 * Coalesce expensive scroll side-effects (window remount, month label) so
 * native momentum is never blocked by React setState on every frame.
 */
export function createScrollSideEffectScheduler(run: (x: number) => void) {
  let raf = 0;
  let pendingX: number | null = null;

  return {
    schedule(x: number) {
      pendingX = x;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = pendingX;
        pendingX = null;
        if (next == null) return;
        run(next);
      });
    },
    flush() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      const next = pendingX;
      pendingX = null;
      if (next == null) return;
      run(next);
    },
    dispose() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      pendingX = null;
    },
  };
}
