import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createComposerLock, COMPOSER_BLUR_MS, COMPOSER_UNLOCK_MS } from '../components/composerLock';

function flush(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('Enter then deferred blur creates once', async () => {
  const lock = createComposerLock();
  const created: string[] = [];
  const submit = (name: string) => {
    if (!lock.commit()) return;
    created.push(name);
  };

  submit('First');
  lock.scheduleBlur(() => submit('First'));
  await flush(COMPOSER_UNLOCK_MS + 5);
  assert.deepEqual(created, ['First']);
  lock.dispose();
});

test('keep-open Enter can create again after the blur window', async () => {
  const lock = createComposerLock();
  const created: string[] = [];
  const submit = (name: string) => {
    if (!lock.commit()) return;
    created.push(name);
  };

  submit('Alpha');
  lock.scheduleBlur(() => submit('Alpha'));
  await flush(COMPOSER_BLUR_MS);
  assert.deepEqual(created, ['Alpha']);
  submit('Beta');
  assert.deepEqual(created, ['Alpha']);
  await flush(COMPOSER_UNLOCK_MS - COMPOSER_BLUR_MS + 5);
  submit('Beta');
  assert.deepEqual(created, ['Alpha', 'Beta']);
  lock.dispose();
});

test('moving composer does not let a deferred blur double-create', async () => {
  const lock = createComposerLock();
  const created: string[] = [];
  const submit = (name: string) => {
    if (!lock.commit()) return;
    created.push(name);
  };

  submit('Root');
  lock.scheduleBlur(() => submit('Root'));
  await flush(COMPOSER_BLUR_MS + 5);
  assert.deepEqual(created, ['Root']);
  lock.dispose();
});

test('beginCompose only after composing was false unlocks a later session', async () => {
  const lock = createComposerLock();
  const created: string[] = [];
  const submit = (name: string) => {
    if (!lock.commit()) return;
    created.push(name);
  };

  submit('Once');
  await flush(10);
  lock.beginCompose();
  submit('Twice');
  assert.deepEqual(created, ['Once', 'Twice']);
  lock.dispose();
});

test('dispose cancels a pending blur commit', async () => {
  const lock = createComposerLock();
  let ran = false;
  lock.scheduleBlur(() => {
    ran = true;
  });
  lock.dispose();
  await flush(COMPOSER_BLUR_MS + 10);
  assert.equal(ran, false);
});

test('empty blur after composer moved does not cancel the next slot', async () => {
  const lock = createComposerLock();
  const created: string[] = [];
  let cancelled = false;
  const composing = { current: true };
  const submit = (name: string) => {
    if (!lock.commit()) return;
    if (name) created.push(name);
    else if (composing.current) cancelled = true;
  };

  composing.current = false;
  lock.scheduleBlur(() => submit(''));
  await flush(COMPOSER_BLUR_MS + 5);
  assert.equal(cancelled, false);
  assert.deepEqual(created, []);

  lock.beginCompose();
  composing.current = true;
  submit('Keep me');
  assert.deepEqual(created, ['Keep me']);
  lock.dispose();
});

test('blur uses the name captured before draft is cleared', async () => {
  const lock = createComposerLock();
  const created: string[] = [];
  const composing = { current: true };
  const submit = (name: string) => {
    if (!lock.commit()) return;
    if (name) created.push(name);
    else if (composing.current) created.push('CANCEL');
  };

  const snapped = 'Typed';
  composing.current = false;
  lock.scheduleBlur(() => submit(snapped));
  await flush(COMPOSER_BLUR_MS + 5);
  assert.deepEqual(created, ['Typed']);
  lock.dispose();
});
