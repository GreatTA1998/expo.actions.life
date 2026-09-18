import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDragGesture } from '../components/drag/gesture';

test('cancel invalidates an in-flight measure so activate is ignored', () => {
  const gesture = createDragGesture();
  const token = gesture.begin();
  assert.equal(gesture.live(token), true);
  gesture.cancel();
  assert.equal(gesture.live(token), false);
});

test('deferred arm after cancel does not attach to a new gesture', () => {
  const gesture = createDragGesture();
  const first = gesture.begin();
  gesture.cancel();
  const second = gesture.begin();
  assert.equal(gesture.live(first), false);
  assert.equal(gesture.live(second), true);
});

test('move-while-pending reuses the live token instead of minting a new one', () => {
  const gesture = createDragGesture();
  const token = gesture.begin();
  const reused = gesture.current();
  assert.equal(reused, token);
  assert.equal(gesture.live(token), true);
});
