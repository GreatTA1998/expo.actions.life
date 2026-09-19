import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultProfile } from '../models/types';
import {
  mergeUserProfiles,
  preferNonEmptyString,
  toFirestoreProfile,
} from '../services/syncMerge';

test('preferNonEmptyString keeps the first real email', () => {
  assert.equal(preferNonEmptyString('', 'eltonlin1998@gmail.com'), 'eltonlin1998@gmail.com');
  assert.equal(preferNonEmptyString('eltonlin1998@gmail.com', ''), 'eltonlin1998@gmail.com');
  assert.equal(preferNonEmptyString(undefined, null, ''), '');
  assert.equal(preferNonEmptyString('a@b.c', 'other@x.y'), 'a@b.c');
});

test('mergeUserProfiles never lets empty email overwrite a real one', () => {
  const local = { ...defaultProfile('uid-a'), email: 'eltonlin1998@gmail.com', nickname: 'Elton' };
  const fetched = { ...defaultProfile('uid-a'), email: '', nickname: '', simpleMode: true };
  const merged = mergeUserProfiles(local, fetched);
  assert.equal(merged.email, 'eltonlin1998@gmail.com');
  assert.equal(merged.nickname, 'Elton');
  // Local is primary for defined settings.
  assert.equal(merged.simpleMode, false);
});

test('mergeUserProfiles fills blank local email from fetched', () => {
  const local = { ...defaultProfile('uid-a'), email: '' };
  const fetched = { ...defaultProfile('uid-a'), email: 'eltonlin1998@gmail.com' };
  const merged = mergeUserProfiles(local, fetched);
  assert.equal(merged.email, 'eltonlin1998@gmail.com');
});

test('toFirestoreProfile omits blank identity fields so merge:true cannot wipe remote', () => {
  const payload = toFirestoreProfile({
    ...defaultProfile('uid-a'),
    email: '',
    nickname: '',
    avatarFilter: '',
  });
  assert.equal('email' in payload, false);
  assert.equal('nickname' in payload, false);
  assert.equal('avatarFilter' in payload, false);
  assert.equal(payload.uid, 'uid-a');

  const withEmail = toFirestoreProfile({
    ...defaultProfile('uid-a'),
    email: 'eltonlin1998@gmail.com',
  });
  assert.equal(withEmail.email, 'eltonlin1998@gmail.com');
});
