export const COMPOSER_BLUR_MS = 50;
export const COMPOSER_UNLOCK_MS = COMPOSER_BLUR_MS + 30;

/** Guards Enter vs deferred blur so keep-open composers can submit again without duplicates. */
export function createComposerLock() {
  let committed = false;
  let disposed = false;
  let skipBlur = false;
  let unlockTimer: ReturnType<typeof setTimeout> | null = null;
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  let skipTimer: ReturnType<typeof setTimeout> | null = null;

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

  function clearSkip() {
    if (!skipTimer) return;
    clearTimeout(skipTimer);
    skipTimer = null;
  }

  return {
    get locked() {
      return committed;
    },
    /** True when this submit should run. Stays locked through the blur window, then unlocks for the next Enter. */
    commit(): boolean {
      if (disposed || committed) return false;
      committed = true;
      skipBlur = false;
      clearSkip();
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
      if (skipBlur) return;
      clearBlur();
      blurTimer = setTimeout(() => {
        blurTimer = null;
        if (disposed || skipBlur) return;
        run();
      }, COMPOSER_BLUR_MS);
    },
    /** Ignore the blur from relocating the field; expires after the blur window so a later tap-away can still commit. */
    skipNextBlur() {
      if (disposed) return;
      skipBlur = true;
      clearBlur();
      clearSkip();
      skipTimer = setTimeout(() => {
        skipBlur = false;
        skipTimer = null;
      }, COMPOSER_UNLOCK_MS);
    },
    /** Fresh tap/open. Do not call while keep-open composing stays true. */
    beginCompose() {
      if (disposed) return;
      committed = false;
      skipBlur = false;
      clearSkip();
      clearBlur();
    },
    dispose() {
      disposed = true;
      skipBlur = false;
      clearBlur();
      clearUnlock();
      clearSkip();
    },
  };
}
