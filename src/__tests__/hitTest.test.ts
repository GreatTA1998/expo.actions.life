import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hitTestZones } from '../components/drag/hitTest';

test('hitTestZones prefers a nested block over the day column', () => {
  const column = { id: 'cal-2026-09-18', rect: { x: 22, y: 80, width: 265, height: 400 } };
  const block = { id: 'nest-cal-photo', ownerTaskId: 'other', rect: { x: 26, y: 200, width: 256, height: 88 } };
  const best = hitTestZones(
    { id: 'dragged', x: 40, y: 210, width: 120 },
    [column, block],
    { width: 390, height: 844 },
  );
  assert.equal(best, 'nest-cal-photo');
});

test('hitTestZones ignores the dragged owner zone', () => {
  const self = { id: 'nest-cal-self', ownerTaskId: 'self', rect: { x: 26, y: 200, width: 256, height: 88 } };
  const column = { id: 'cal-2026-09-18', rect: { x: 22, y: 80, width: 265, height: 400 } };
  const best = hitTestZones(
    { id: 'self', x: 40, y: 210, width: 120 },
    [self, column],
    { width: 390, height: 844 },
  );
  assert.equal(best, 'cal-2026-09-18');
});
