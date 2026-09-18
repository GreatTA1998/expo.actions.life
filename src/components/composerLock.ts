export const COMPOSER_BLUR_MS = 50;
export const COMPOSER_UNLOCK_MS = COMPOSER_BLUR_MS + 30;

/** Guards Enter vs deferred blur so keep-open composers can submit again without duplicates. */
export function createComposerLock() {
  let committed = false;
  let disposed = false;
  let unlockTimer: ReturnType<typeof setTimeout> | null = null;
  let blurTimer: ReturnType<typeof setTimeout> | null = null;

  function clearBlur() {
    if (!blurTimer) return;
    clearTimeout(blurTimer);
    blurTimer = null;
  }

  function clearUnlock() {
    if (!unlockTimer) return;
    clearTimeout(unlockTimer);
    unlockTimer = null;
  }

  return {
    get locked() {
      return committed;
    },
    /** True when this submit should run. Stays locked through the blur window, then unlocks for the next Enter. */
    commit(): boolean {
      if (disposed || committed) return false;
      committed = true;
      clearBlur();
      clearUnlock();
      unlockTimer = setTimeout(() => {
        committed = false;
        unlockTimer = null;
      }, COMPOSER_UNLOCK_MS);
      return true;
    },
    scheduleBlur(run: () => void) {
      if (disposed) return;
      clearBlur();
      blurTimer = setTimeout(() => {
        blurTimer = null;
        if (disposed) return;
        run();
      }, COMPOSER_BLUR_MS);
    },
    /** Fresh tap/open. Do not call while keep-open composing stays true. */
    beginCompose() {
      if (disposed) return;
      committed = false;
      clearBlur();
    },
    dispose() {
      disposed = true;
      clearBlur();
      clearUnlock();
    },
  };
}
