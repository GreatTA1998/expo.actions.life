import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createNativeHold, HOLD_DELAY } from '../components/drag/nativeHold';

function withTimers(run: () => void) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    run();
  } finally {
    mock.timers.reset();
  }
}

test('timer then longPress starts drag once', () => {
  withTimers(() => {
    const calls: Array<[number, number]> = [];
    const hold = createNativeHold((x, y) => calls.push([x, y]));
    hold.pressIn(10, 20);
    mock.timers.tick(HOLD_DELAY);
    hold.longPress(40, 80);
    assert.deepEqual(calls, [[10, 20]]);
    assert.equal(hold.armed, true);
  });
});

test('longPress first clears the timer so start happens once', () => {
  withTimers(() => {
    const calls: Array<[number, number]> = [];
    const hold = createNativeHold((x, y) => calls.push([x, y]));
    hold.pressIn(10, 20);
    hold.longPress(11, 21);
    mock.timers.tick(HOLD_DELAY);
    assert.deepEqual(calls, [[11, 21]]);
  });
});

test('move beyond slop cancels the pending hold', () => {
  withTimers(() => {
    const calls: Array<[number, number]> = [];
    const hold = createNativeHold((x, y) => calls.push([x, y]));
    hold.pressIn(10, 20);
    hold.touchMove(20, 20);
    mock.timers.tick(HOLD_DELAY);
    hold.longPress(20, 20);
    assert.deepEqual(calls, []);
    assert.equal(hold.armed, false);
  });
});

test('lift before the delay does not start a drag', () => {
  withTimers(() => {
    const calls: Array<[number, number]> = [];
    const hold = createNativeHold((x, y) => calls.push([x, y]));
    hold.pressIn(10, 20);
    hold.touchEnd();
    mock.timers.tick(HOLD_DELAY);
    hold.longPress(10, 20);
    assert.deepEqual(calls, []);
  });
});
