import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clipRectToWindow,
  durationFromPointerDelta,
  edgeScrollDelta,
  snapDuration,
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

test('durationFromPointerDelta matches web DurationAdjuster math', () => {
  assert.equal(durationFromPointerDelta(30, 50, 50), 90);
  assert.equal(durationFromPointerDelta(30, -50, 50), 15);
  assert.equal(snapDuration(37, 15), 30);
  assert.equal(snapDuration(38, 15), 45);
});
