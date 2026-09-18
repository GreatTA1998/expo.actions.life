/**
 * Shared calendar day-header band sizing — mirrors web Calendar.svelte where a
 * sticky flex row stretches every DayHeader to the tallest sibling
 * (`trackHeight` → `headerHeight`).
 *
 * Heights are estimated from content so the band is correct on the first paint
 * (no measure-then-relayout jank when the virtual window remounts).
 */

export const HEADER_LABEL_H = 20;
export const HEADER_ICON_SIZE = 32;
export const HEADER_ICON_GAP = 4;
export const HEADER_CHIP_H = 22;
export const HEADER_CHIP_GAP = 4;
export const HEADER_PAD_TOP = 8;
/** Web DayHeader trailing spacer: `h-4.5` ≈ 18px. */
export const HEADER_PAD_BOTTOM = 18;
export const HEADER_COMPOSER_H = 34;
export const HEADER_SECTION_GAP = 4;
export const HEADER_MIN_H =
  HEADER_PAD_TOP + HEADER_LABEL_H + HEADER_PAD_BOTTOM;

export type DayHeaderContent = {
  iconCount: number;
  chipCount: number;
  composing?: boolean;
};

export function iconRowsForWidth(iconCount: number, columnWidth: number): number {
  if (iconCount <= 0) return 0;
  const inner = Math.max(HEADER_ICON_SIZE, columnWidth - 12);
  const perRow = Math.max(1, Math.floor((inner + HEADER_ICON_GAP) / (HEADER_ICON_SIZE + HEADER_ICON_GAP)));
  return Math.ceil(iconCount / perRow);
}

/** Intrinsic height of one day's header chrome (label + icons + chips). */
export function estimateDayHeaderHeight(
  content: DayHeaderContent,
  columnWidth: number,
): number {
  const iconRows = iconRowsForWidth(content.iconCount, columnWidth);
  let h = HEADER_PAD_TOP + HEADER_LABEL_H;

  if (iconRows > 0) {
    h += HEADER_SECTION_GAP;
    h += iconRows * HEADER_ICON_SIZE + (iconRows - 1) * HEADER_ICON_GAP;
  }

  if (content.chipCount > 0) {
    h += HEADER_SECTION_GAP;
    h += content.chipCount * HEADER_CHIP_H + (content.chipCount - 1) * HEADER_CHIP_GAP;
  }

  if (content.composing) {
    h += HEADER_SECTION_GAP + HEADER_COMPOSER_H;
  }

  h += HEADER_PAD_BOTTOM;
  return Math.max(HEADER_MIN_H, h);
}

/** One shared band height = max over the windowed (or visible) days. */
export function sharedHeaderBandHeight(
  contents: DayHeaderContent[],
  columnWidth: number,
): number {
  if (!contents.length) return HEADER_MIN_H;
  let max = HEADER_MIN_H;
  for (const item of contents) {
    const next = estimateDayHeaderHeight(item, columnWidth);
    if (next > max) max = next;
  }
  return max;
}

/**
 * While the finger is flinging, only grow the band (never shrink) so remounts
 * at the virtualization edge do not stutter the sticky chrome. Shrink after idle.
 */
export function settleHeaderBandHeight(
  current: number,
  target: number,
  scrolling: boolean,
): number {
  if (scrolling) return Math.max(current, target);
  return target;
}
