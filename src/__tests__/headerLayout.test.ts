import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HEADER_MIN_H,
  estimateDayHeaderHeight,
  iconRowsForWidth,
  settleHeaderBandHeight,
  sharedHeaderBandHeight,
} from '../components/calendar/headerLayout';

test('empty day headers share the web-like minimum band height', () => {
  assert.equal(estimateDayHeaderHeight({ iconCount: 0, chipCount: 0 }, 160), HEADER_MIN_H);
  assert.equal(sharedHeaderBandHeight([], 160), HEADER_MIN_H);
});

test('icon wrapping follows column width', () => {
  assert.equal(iconRowsForWidth(0, 160), 0);
  assert.equal(iconRowsForWidth(4, 160), 1);
  assert.ok(iconRowsForWidth(8, 80) >= 2);
});

test('shared band height is the max across windowed days', () => {
  const short = estimateDayHeaderHeight({ iconCount: 1, chipCount: 0 }, 160);
  const tall = estimateDayHeaderHeight({ iconCount: 2, chipCount: 2 }, 160);
  assert.ok(tall > short);
  assert.equal(
    sharedHeaderBandHeight(
      [
        { iconCount: 1, chipCount: 0 },
        { iconCount: 2, chipCount: 2 },
        { iconCount: 0, chipCount: 0 },
      ],
      160,
    ),
    tall,
  );
});

test('band height only grows while scrolling and settles when idle', () => {
  assert.equal(settleHeaderBandHeight(100, 140, true), 140);
  assert.equal(settleHeaderBandHeight(140, 100, true), 140);
  assert.equal(settleHeaderBandHeight(140, 100, false), 100);
});
