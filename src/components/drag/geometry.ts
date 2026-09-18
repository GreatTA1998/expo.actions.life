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

/** Sync window rect on web; `measureInWindow` is async and misses fast pointer passes. */
export function readWindowRect(node: unknown, zoneId?: string): Rect | null {
  const el = node as {
    getBoundingClientRect?: () => { x: number; y: number; width: number; height: number };
  } | null;
  const rect = el?.getBoundingClientRect?.();
  if (rect && (rect.width > 0 || rect.height > 0)) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  if (zoneId && typeof document !== 'undefined') {
    const host = document.querySelector(zoneSelector(zoneId));
    const hostRect = host?.getBoundingClientRect();
    if (hostRect && (hostRect.width > 0 || hostRect.height > 0)) {
      return { x: hostRect.x, y: hostRect.y, width: hostRect.width, height: hostRect.height };
    }
  }
  return null;
}

function escapeId(id: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export function zoneSelector(zoneId: string): string {
  if (zoneId.startsWith('cal-head-')) {
    return `[data-testid="day-head-${zoneId.slice(9)}"], [data-nativeid="${zoneId}"]`;
  }
  if (zoneId.startsWith('cal-') && !zoneId.startsWith('cal-block') && !zoneId.startsWith('cal-resize')) {
    return `[data-testid="day-column-${zoneId.slice(4)}"], [data-nativeid="${zoneId}"], #${escapeId(zoneId)}`;
  }
  if (zoneId.startsWith('nest-cal-')) {
    return `[data-testid="cal-block-${zoneId.slice(9)}"], [data-nativeid="${zoneId}"]`;
  }
  if (zoneId.startsWith('nest-')) {
    return `[data-testid="task-row-${zoneId.slice(5)}"], [data-nativeid="${zoneId}"]`;
  }
  if (zoneId.startsWith('list-')) {
    return `[data-nativeid="${zoneId}"], [data-testid="${zoneId.replace(/^list-/, 'dropzone-')}"]`;
  }
  return `[data-testid="${zoneId}"], [data-nativeid="${zoneId}"], #${escapeId(zoneId)}`;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x + 0.5 &&
    outer.y <= inner.y + 0.5 &&
    outer.x + outer.width >= inner.x + inner.width - 0.5 &&
    outer.y + outer.height >= inner.y + inner.height - 0.5
  );
}

export type ZoneHit = { id: string; area: number; left: number; rect: Rect };

/** Web pickZone: skip ancestors that contain another hit, then largest overlap, then right-most. */
export function pickBestZoneId(hits: ZoneHit[]): string {
  let best = '';
  let max = 0;
  let bestLeft = -Infinity;
  for (const hit of hits) {
    if (hits.some((other) => other.id !== hit.id && rectContains(hit.rect, other.rect))) continue;
    if (hit.area > max || (hit.area === max && hit.left > bestLeft)) {
      max = hit.area;
      best = hit.id;
      bestLeft = hit.left;
    }
  }
  return best;
}

export function measureNode(node: unknown, cb: (rect: Rect) => void, zoneId?: string): void {
  const sync = readWindowRect(node, zoneId);
  if (sync) {
    cb(sync);
    return;
  }
  const view = node as {
    measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void;
  } | null;
  view?.measureInWindow?.((x, y, width, height) => cb({ x, y, width, height }));
}
