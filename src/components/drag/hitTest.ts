import type { Rect } from './geometry';
import { clipRectToWindow, pickBestZoneId, type ZoneHit } from './geometry';

export type HitZone = {
  id: string;
  ownerTaskId?: string;
  rect: Rect | null;
};

const PROBE_H = 2;

/**
 * Hit-test the ghost's top-edge probe against registered zones.
 * Pure: no React, no measuring — caller supplies current rects.
 */
export function hitTestZones(
  session: { id: string; x: number; y: number; width: number },
  zones: Iterable<HitZone>,
  win: { width: number; height: number },
): string {
  const probe = {
    left: session.x,
    top: session.y,
    right: session.x + Math.max(session.width, 8),
    bottom: session.y + PROBE_H,
  };
  const hits: ZoneHit[] = [];
  for (const zone of zones) {
    if (zone.ownerTaskId && zone.ownerTaskId === session.id) continue;
    const raw = zone.rect;
    if (!raw || raw.width <= 0 || raw.height <= 0) continue;
    const rect = clipRectToWindow(raw, win);
    if (!rect) continue;
    const left = Math.max(probe.left, rect.x);
    const top = Math.max(probe.top, rect.y);
    const right = Math.min(probe.right, rect.x + rect.width);
    const bottom = Math.min(probe.bottom, rect.y + rect.height);
    const area = Math.max(0, right - left) * Math.max(0, bottom - top);
    if (area <= 0) continue;
    hits.push({ id: zone.id, area, left: rect.x, rect });
  }
  return pickBestZoneId(hits);
}
