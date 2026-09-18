import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clipRectToWindow,
  durationFromPointerDelta,
  edgeScrollDelta,
  measureNode,
  pickBestZoneId,
  readWindowRect,
  snapDuration,
  zoneSelector,
} from '../components/drag/geometry';

test('clipRectToWindow drops off-screen day columns', () => {
  assert.equal(clipRectToWindow({ x: -258, y: 80, width: 200, height: 600 }, { width: 390, height: 844 }), null);
  const visible = clipRectToWindow({ x: 140, y: 80, width: 220, height: 600 }, { width: 390, height: 844 });
  assert.ok(visible);
  assert.equal(visible.x, 140);
  assert.equal(visible.width, 220);
});

test('edgeScrollDelta scrolls only when the pointer is on that scroller edge', () => {
  const viewport = { x: 0, y: 400, width: 390, height: 300 };
  assert.equal(edgeScrollDelta({ x: 20, y: 410 }, viewport, 'y', 44, 16), -16);
  assert.equal(edgeScrollDelta({ x: 20, y: 680 }, viewport, 'y', 44, 16), 16);
  assert.equal(edgeScrollDelta({ x: 20, y: 550 }, viewport, 'y', 44, 16), 0);
  assert.equal(edgeScrollDelta({ x: 20, y: 100 }, viewport, 'y', 44, 16), 0);
  assert.equal(edgeScrollDelta({ x: 10, y: 420 }, viewport, 'x', 44, 16), -16);
});

test('zoneSelector maps drop ids to rendered test ids', () => {
  assert.match(zoneSelector('cal-head-2026-09-19'), /day-head-2026-09-19/);
  assert.match(zoneSelector('cal-2026-09-18'), /day-column-2026-09-18/);
  assert.match(zoneSelector('nest-cal-photo-bird'), /cal-block-photo-bird/);
  assert.match(zoneSelector('nest-todo-drag'), /task-row-todo-drag/);
  assert.match(zoneSelector('list-root-0'), /dropzone-root-0/);
});

test('measureNode prefers a sync getBoundingClientRect', () => {
  const node = {
    getBoundingClientRect: () => ({ x: 22, y: 80, width: 200, height: 40 }),
  };
  assert.deepEqual(readWindowRect(node), { x: 22, y: 80, width: 200, height: 40 });
  let seen: { x: number; y: number } | null = null;
  measureNode(node, (rect) => {
    seen = rect;
  });
  assert.equal(seen?.x, 22);
});

test('pickBestZoneId prefers a nested calendar block over the day column', () => {
  const column = { x: 22, y: 80, width: 265, height: 400 };
  const block = { x: 26, y: 200, width: 256, height: 88 };
  const best = pickBestZoneId([
    { id: 'cal-2026-09-18', area: 400, left: column.x, rect: column },
    { id: 'nest-cal-photo-bird', area: 360, left: block.x, rect: block },
  ]);
  assert.equal(best, 'nest-cal-photo-bird');
});

test('durationFromPointerDelta matches web DurationAdjuster math', () => {
  assert.equal(durationFromPointerDelta(30, 50, 50), 90);
  assert.equal(durationFromPointerDelta(30, -50, 50), 15);
  assert.equal(snapDuration(37, 15), 30);
  assert.equal(snapDuration(38, 15), 45);
});
