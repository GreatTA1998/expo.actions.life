export type Rect = { x: number; y: number; width: number; height: number };

/** Clip a measured dropzone to the window so off-screen day columns cannot steal drops. */
export function clipRectToWindow(raw: Rect, win: { width: number; height: number }): Rect | null {
  const x = Math.max(0, raw.x);
  const y = Math.max(0, raw.y);
  const width = Math.min(raw.x + raw.width, win.width) - x;
  const height = Math.min(raw.y + raw.height, win.height) - y;
  if (width <= 2 || height <= 2) return null;
  return { x, y, width, height };
}

/** Pixels to scroll when a drag pointer sits on a scroller edge. */
export function edgeScrollDelta(
  pointer: { x: number; y: number },
  viewport: Rect,
  axis: 'x' | 'y',
  edge: number,
  step: number,
): number {
  if (
    pointer.x < viewport.x ||
    pointer.x > viewport.x + viewport.width ||
    pointer.y < viewport.y ||
    pointer.y > viewport.y + viewport.height
  ) {
    return 0;
  }
  if (axis === 'y') {
    if (pointer.y < viewport.y + edge) return -step;
    if (pointer.y > viewport.y + viewport.height - edge) return step;
    return 0;
  }
  if (pointer.x < viewport.x + edge) return -step;
  if (pointer.x > viewport.x + viewport.width - edge) return step;
  return 0;
}

/** Web DurationAdjuster: duration += dy / (pxPerHour / 60). */
export function durationFromPointerDelta(
  startDuration: number,
  dy: number,
  pixelsPerHour: number,
  minDuration = 15,
): number {
  const minutesPerPixel = 60 / Math.max(1, pixelsPerHour);
  return Math.max(minDuration, startDuration + dy * minutesPerPixel);
}

export function snapDuration(minutes: number, interval = 15): number {
  const step = Math.max(1, interval);
  return Math.max(step, Math.round(minutes / step) * step);
}
