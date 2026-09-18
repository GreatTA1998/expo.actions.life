import type { Rect } from './geometry';

/** Shared drag/drop value types — kept out of DragDropContext to avoid cycles. */

export type DropTarget =
  | { kind: 'list'; parentID: string; index: number }
  | { kind: 'nest'; parentID: string; at: 'first' | 'last' }
  | { kind: 'cal'; iso: string; allDay?: boolean };

export type DragOrigin = 'list' | 'cal' | 'nested-cal';

export type DragSession = {
  id: string;
  name: string;
  origin: DragOrigin;
  active: boolean;
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

export type DropZoneLookup = {
  target: DropTarget;
  rect: Rect | null;
};

export type ResolvedDrop = {
  taskId: string;
  origin: DragOrigin;
  target: DropTarget;
  pointer: { x: number; y: number };
  zoneRect: Rect | null;
};

/**
 * Resolve a drop once (on pointer up). Pure — no React, no measuring.
 * Ownership: call only from endDrag after the last motion flush.
 */
export function resolveDrop(
  session: DragSession | null,
  bestZoneId: string,
  zones: { get: (id: string) => DropZoneLookup | undefined },
): ResolvedDrop | null {
  if (!session?.active || !bestZoneId) return null;
  const zone = zones.get(bestZoneId);
  if (!zone) return null;
  return {
    taskId: session.id,
    origin: session.origin,
    target: zone.target,
    pointer: { x: session.pointerX, y: session.y },
    zoneRect: zone.rect,
  };
}
