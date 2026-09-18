import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDrop, type DragSession } from '../components/drag/commitDrop';
import { createScrollSideEffectScheduler } from '../components/calendar/scrollSideEffects';
import { setScrollersEnabled, type Scroller } from '../components/drag/scrollGate';

test('resolveDrop commits only when active session hits a zone', () => {
  const session: DragSession = {
    id: 't1',
    name: 'A',
    origin: 'cal',
    active: true,
    pointerX: 10,
    pointerY: 20,
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    offsetX: 0,
    offsetY: 0,
  };
  const zones = new Map([
    ['cal-2026-09-18', { target: { kind: 'cal' as const, iso: '2026-09-18' }, rect: { x: 0, y: 0, width: 100, height: 100 } }],
  ]);
  const drop = resolveDrop(session, 'cal-2026-09-18', zones);
  assert.equal(drop?.taskId, 't1');
  assert.deepEqual(drop?.target, { kind: 'cal', iso: '2026-09-18' });
  assert.equal(resolveDrop({ ...session, active: false }, 'cal-2026-09-18', zones), null);
  assert.equal(resolveDrop(session, '', zones), null);
});

test('scroll side-effect scheduler coalesces to one run per frame', async () => {
  const queued: FrameRequestCallback[] = [];
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    queued.push(cb);
    return queued.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  try {
    const seen: number[] = [];
    const sched = createScrollSideEffectScheduler();
    sched.schedule(1, (x) => seen.push(x));
    sched.schedule(2, (x) => seen.push(x));
    sched.schedule(3, (x) => seen.push(x));
    assert.equal(queued.length, 1);
    queued[0](0);
    assert.deepEqual(seen, [3]);
    sched.dispose();
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});

test('setScrollersEnabled only toggles registered scrollers', () => {
  const flags: boolean[] = [];
  const scroller: Scroller = {
    id: 'cal',
    axis: 'y',
    getViewport: () => null,
    getOffset: () => ({ x: 0, y: 0 }),
    scrollTo: () => {},
    setEnabled: (enabled) => flags.push(enabled),
  };
  setScrollersEnabled([scroller], false);
  setScrollersEnabled([scroller], true);
  assert.deepEqual(flags, [false, true]);
});
