import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryRepository } from '../persistence/memoryRepository';
import { migrateUid } from '../persistence/migrate';
import { restoreAnonymousGuestSession } from '../persistence/guestSession';
import { TaskTreeStore } from '../services/taskStore';
import { mergeRemoteTasks, toFirestoreTask } from '../services/syncMerge';
import { defaultTask } from '../models/types';
import { todayISO } from '../dates';

async function boot(uid = 'guest-test') {
  const repo = new MemoryRepository();
  const store = new TaskTreeStore(repo, uid);
  await store.init();
  return { repo, store };
}

test('guest seed creates inbox forest and calendar blocks', async () => {
  const { store } = await boot();
  const names = store.inbox.map((node) => node.task.name);
  assert.ok(names.includes('TO-DO'));
  assert.ok(names.includes('Visa timeline'));
  const todo = store.inbox.find((node) => node.task.id === 'getting-started');
  assert.equal(todo?.children.length, 4);
  const today = store.tasksOnDay(todayISO());
  assert.ok(today.some((task) => task.id === 'photo-bird'));
  assert.ok(store.photoTasks().some((task) => task.id === 'photo-bird'));
});

test('create, nest, complete, and schedule persist across relaunch', async () => {
  const { repo, store } = await boot('persist-user');
  const created = await store.create({ name: 'Write report', onList: true });
  await store.addSubtask(created.id, 'Outline');
  await store.addSubtask(created.id, 'Draft');
  const outline = store.allTasks().find((task) => task.name === 'Outline');
  const draft = store.allTasks().find((task) => task.name === 'Draft');
  assert.ok(outline);
  assert.ok(draft);
  await store.indent(draft.id);
  await store.toggleDone(outline.id);
  await store.schedule(created.id, todayISO(), '10:30', 45);

  const relaunch = new TaskTreeStore(repo, 'persist-user');
  await relaunch.init();
  const report = relaunch.task(created.id);
  assert.equal(report?.name, 'Write report');
  assert.equal(report?.startDateISO, todayISO());
  assert.equal(report?.startTime, '10:30');
  const nestedDraft = relaunch.allTasks().find((task) => task.name === 'Draft');
  assert.equal(nestedDraft?.parentID, outline.id);
  assert.equal(relaunch.allTasks().find((task) => task.name === 'Outline')?.isDone, true);
  assert.equal(nestedDraft?.rootID, created.id);
  assert.ok(relaunch.tasksOnDay(todayISO()).some((task) => task.id === created.id));
  assert.ok(relaunch.inbox.some((node) => node.task.id === created.id));
});

test('archive hides a subtree from the inbox without deleting it', async () => {
  const { store } = await boot('archive-user');
  const parent = await store.create({ name: 'Parent' });
  await store.addSubtask(parent.id, 'Child');
  await store.archive(parent.id);
  assert.equal(store.inbox.some((node) => node.task.id === parent.id), false);
  assert.equal(store.task(parent.id)?.onList, false);
  assert.ok(store.lastUndo);
});

test('sync outbox records mutations', async () => {
  const { repo, store } = await boot('outbox-user');
  await store.create({ name: 'Queued' });
  const pending = await repo.loadOutbox('outbox-user');
  assert.ok(pending.length > 0);
});

test('simpleMode archives a task when it is scheduled', async () => {
  const { store } = await boot('simple-user');
  await store.setSimpleMode(true);
  const created = await store.create({ name: 'Call mom', onList: true });
  await store.schedule(created.id, todayISO(), '14:00');
  assert.equal(store.task(created.id)?.onList, false);
  assert.equal(store.inbox.some((node) => node.task.id === created.id), false);
});

test('mergeRemoteTasks keeps pending local rows', () => {
  const local = [
    defaultTask({ id: 'a', name: 'Local', pendingSync: true, onList: true, orderValue: 1 }),
    defaultTask({ id: 'b', name: 'Stay', pendingSync: false, onList: true, orderValue: 2 }),
  ];
  const remote = [
    defaultTask({ id: 'a', name: 'Remote', pendingSync: false, onList: true, orderValue: 1 }),
    defaultTask({ id: 'c', name: 'New', pendingSync: false, onList: true, orderValue: 3 }),
  ];
  const merged = mergeRemoteTasks(local, remote);
  assert.equal(merged.find((task) => task.id === 'a')?.name, 'Local');
  assert.ok(merged.some((task) => task.id === 'c'));
  assert.ok(!('pendingSync' in toFirestoreTask(local[0])));
});

test('migrateUid copies tasks to the new owner', async () => {
  const { repo, store } = await boot('guest-old');
  const created = await store.create({ name: 'Keep me' });
  await migrateUid(repo, 'guest-old', 'firebase-new');
  const next = new TaskTreeStore(repo, 'firebase-new');
  await next.init();
  assert.equal(next.task(created.id)?.name, 'Keep me');
  assert.equal(next.task(created.id)?.ownerUID, 'firebase-new');
});

test('migrateUid does not wipe the destination when the source is already empty', async () => {
  const { repo, store } = await boot('guest-source');
  const created = await store.create({ name: 'Keep me' });
  await migrateUid(repo, 'guest-source', 'firebase-dest');
  await migrateUid(repo, 'guest-source', 'firebase-dest');
  const next = new TaskTreeStore(repo, 'firebase-dest');
  await next.init();
  assert.equal(next.task(created.id)?.name, 'Keep me');
});

test('migrateUid does not reseed the emptied source uid', async () => {
  const { repo, store } = await boot('guest-reseed');
  const before = store.allTasks().length;
  assert.ok(before > 0);
  await migrateUid(repo, 'guest-reseed', 'firebase-keep');
  const leftover = new TaskTreeStore(repo, 'guest-reseed');
  await leftover.init();
  assert.equal(leftover.allTasks().length, 0);
  const dest = new TaskTreeStore(repo, 'firebase-keep');
  await dest.init();
  assert.equal(dest.allTasks().length, before);
  assert.ok(dest.inbox.some((node) => node.task.name === 'TO-DO'));
});

test('Continue as guest after promote restores the Firebase anonymous uid, not a new guest-*', async () => {
  const { repo, store } = await boot('guest-promo');
  const smoke = await store.create({ name: 'Overnight smoke' });
  await migrateUid(repo, 'guest-promo', 'BeBBm2PMGpromoted');
  const restored = restoreAnonymousGuestSession({
    lastAnonymous: {
      uid: 'BeBBm2PMGpromoted',
      email: '',
      isAnonymous: true,
      provider: 'anonymous',
    },
    deviceGuestUid: 'guest-promo',
  });
  assert.equal(restored?.uid, 'BeBBm2PMGpromoted');
  const next = new TaskTreeStore(repo, restored.uid);
  await next.init();
  assert.equal(next.task(smoke.id)?.name, 'Overnight smoke');
  assert.equal(next.allTasks().filter((task) => task.name === 'TO-DO').length, 1);
  assert.equal(next.allTasks().filter((task) => task.name === 'Overnight smoke').length, 1);
});

test('undo restores an archived subtree to the inbox', async () => {
  const { store } = await boot('undo-user');
  const parent = await store.create({ name: 'Parent' });
  await store.addSubtask(parent.id, 'Child');
  await store.archive(parent.id);
  assert.ok(store.lastUndo);
  await store.lastUndo.run();
  store.clearUndo();
  assert.equal(store.task(parent.id)?.onList, true);
  assert.equal(store.inbox.some((node) => node.task.id === parent.id), true);
  assert.equal(store.lastUndo, null);
});

test('agenda includes seeded photo blocks', async () => {
  const { store } = await boot('guest-agenda');
  const today = store.agendaDays(2)[0];
  assert.equal(today.iso, todayISO());
  assert.ok(today.tasks.some((task) => task.id === 'photo-bird'));
});

test('indent nests a task under its previous sibling', async () => {
  const { store } = await boot('indent-user');
  const parent = await store.create({ name: 'Parent' });
  await store.addSubtask(parent.id, 'First');
  await store.addSubtask(parent.id, 'Second');
  const first = store.allTasks().find((task) => task.name === 'First');
  const second = store.allTasks().find((task) => task.name === 'Second');
  assert.ok(first);
  assert.ok(second);
  const ok = await store.indent(second.id);
  assert.equal(ok, true);
  assert.equal(store.task(second.id)?.parentID, first.id);
  const refused = await store.indent(first.id);
  assert.equal(refused, false);
});

test('indent becomes the last child; outdent lands after the former parent', async () => {
  const { store } = await boot('indent-order');
  const root = await store.create({ name: 'Root' });
  const first = await store.create({ name: 'First', parentID: root.id, onList: true });
  const second = await store.create({ name: 'Second', parentID: root.id, onList: true });
  const third = await store.create({ name: 'Third', parentID: root.id, onList: true });
  await store.addSubtask(first.id, 'Existing child');
  await store.indent(second.id);
  const firstKids = store.inbox
    .find((node) => node.task.id === root.id)
    ?.children.find((node) => node.task.id === first.id)
    ?.children.map((node) => node.task.name);
  assert.deepEqual(firstKids, ['Existing child', 'Second']);

  await store.outdent(second.id);
  const rootKids = store.inbox
    .find((node) => node.task.id === root.id)
    ?.children.map((node) => node.task.name);
  assert.deepEqual(rootKids, ['First', 'Second', 'Third']);
  assert.equal(store.task(second.id)?.parentID, root.id);
  assert.ok(store.task(second.id)!.orderValue > store.task(first.id)!.orderValue);
  assert.ok(store.task(second.id)!.orderValue < store.task(third.id)!.orderValue);
});

test('drainIfPossible skips local-only guest UIDs', async () => {
  const { store } = await boot('guest-offline');
  const result = await store.syncNow();
  assert.equal(result.drained, 0);
  assert.match(result.reason, /local-only/);
});

test('create before init merges into disk and does not wipe or reseed', async () => {
  const { repo, store: primed } = await boot('guest-hydrate-merge');
  const existing = await primed.create({ name: 'Already on disk' });
  const store = new TaskTreeStore(repo, 'guest-hydrate-merge');
  const during = await store.create({ name: 'During load', onList: true, place: 'start' });
  await store.init();
  assert.equal(store.task(during.id)?.name, 'During load');
  assert.equal(store.task(existing.id)?.name, 'Already on disk');
  assert.equal(store.allTasks().filter((task) => task.name === 'TO-DO').length, 1);
  assert.equal(store.inbox[0]?.task.id, during.id);
});

test('adoptRepository keeps first-paint rows when SQLite attaches', async () => {
  const memory = new MemoryRepository();
  const disk = new MemoryRepository();
  const store = new TaskTreeStore(memory, 'guest-adopt');
  const painted = await store.create({ name: 'Painted first', place: 'start' });
  const seeded = new TaskTreeStore(disk, 'guest-adopt');
  await seeded.init();
  await store.adoptRepository(disk);
  assert.equal(store.task(painted.id)?.name, 'Painted first');
  assert.ok(store.inbox.some((node) => node.task.name === 'TO-DO'));
  assert.equal(store.allTasks().filter((task) => task.name === 'TO-DO').length, 1);
});

test('moveAmongSiblings swaps inbox order', async () => {
  const { store } = await boot('reorder-user');
  const first = await store.create({ name: 'Alpha' });
  const second = await store.create({ name: 'Beta' });
  const moved = await store.moveAmongSiblings(second.id, -1);
  assert.equal(moved, true);
  assert.deepEqual(
    store.inbox.filter((node) => node.task.name === 'Alpha' || node.task.name === 'Beta').map((node) => node.task.name),
    ['Beta', 'Alpha'],
  );
  const refused = await store.moveAmongSiblings(first.id, 1);
  assert.equal(refused, false);
});

test('create at dropzone index inserts between siblings', async () => {
  const { store } = await boot('dropzone-create');
  const parent = await store.create({ name: 'Holder', onList: true });
  const first = await store.create({ name: 'First', parentID: parent.id, onList: true });
  const third = await store.create({ name: 'Third', parentID: parent.id, onList: true });
  const middle = await store.create({ name: 'Middle', parentID: parent.id, onList: true, index: 1 });
  const names = store.inbox
    .find((node) => node.task.id === parent.id)
    ?.children.map((node) => node.task.name);
  assert.deepEqual(names, ['First', 'Middle', 'Third']);
  assert.ok(store.task(middle.id)!.orderValue > store.task(first.id)!.orderValue);
  assert.ok(store.task(middle.id)!.orderValue < store.task(third.id)!.orderValue);
});

test('placeOnList nests, reorders, and unschedules from calendar', async () => {
  const { store } = await boot('place-on-list');
  const parent = await store.create({ name: 'Parent', onList: true });
  const child = await store.create({ name: 'Child', onList: true });
  await store.schedule(child.id, todayISO(), '10:00');
  const nested = await store.placeOnList(child.id, { parentID: parent.id, index: 0, unschedule: true });
  assert.equal(nested, true);
  assert.equal(store.task(child.id)?.parentID, parent.id);
  assert.equal(store.task(child.id)?.startTime, '');
  assert.equal(store.task(child.id)?.startDateISO, '');
  const sibling = await store.create({ name: 'Sibling', parentID: parent.id, onList: true });
  await store.placeOnList(sibling.id, { parentID: parent.id, index: 0 });
  const kids = store.inbox.find((node) => node.task.id === parent.id)?.children.map((node) => node.task.name);
  assert.equal(kids?.[0], 'Sibling');
});

test('placeOnCal all-day leaves startTime empty', async () => {
  const { store } = await boot('place-on-cal-all-day');
  const task = await store.create({ name: 'All day', onList: true });
  await store.placeOnCal(task.id, todayISO(), '');
  assert.equal(store.task(task.id)?.startDateISO, todayISO());
  assert.equal(store.task(task.id)?.startTime, '');
  assert.equal(store.task(task.id)?.onList, true);
});

test('placeOnCal schedules onto a day', async () => {
  const { store } = await boot('place-on-cal');
  const task = await store.create({ name: 'Drag me', onList: true });
  await store.placeOnCal(task.id, todayISO(), '14:15');
  assert.equal(store.task(task.id)?.startDateISO, todayISO());
  assert.equal(store.task(task.id)?.startTime, '14:15');
  assert.equal(store.task(task.id)?.onList, true);
});

test('nest onto a calendar block then resize duration', async () => {
  const { store } = await boot('guest-cal-block-kids');
  const block = store.task('photo-bird');
  assert.ok(block);
  const child = await store.create({ name: 'Bring binoculars', onList: true });
  const first = await store.create({ name: 'Pack lunch', onList: true });
  await store.placeOnList(first.id, { parentID: block.id, index: 0 });
  await store.placeOnList(child.id, { parentID: block.id, index: store.childrenOf(block.id).length });
  const names = store.childrenOf(block.id).map((node) => node.task.name);
  assert.deepEqual(names, ['Pack lunch', 'Bring binoculars']);
  await store.setDuration(block.id, 45);
  assert.equal(store.task(block.id)?.duration, 45);
});

test('switching to an existing Google uid does not copy guest demo without migrateUid', async () => {
  const { repo, store: guest } = await boot('guest-switch-src');
  assert.ok(guest.task('getting-started'));
  // App.tsx account switch: new store for the Google uid, no migrateUid.
  const google = new TaskTreeStore(repo, 'googleUidExisting');
  await google.init();
  assert.equal(google.task('getting-started'), undefined);
  assert.equal(google.allTasks().length, 0);
  assert.ok(guest.task('getting-started'));
});

test('create writes Task.js schema fields with web defaults', async () => {
  const { store } = await boot('schema-user');
  const task = await store.create({ name: 'Schema check', onList: true });
  assert.equal(task.duration, 30);
  assert.equal(task.childrenLayout, 'normal');
  assert.equal(task.photoLayout, 'split-view');
  assert.equal(task.isCollapsed, false);
  assert.equal(task.templateID, '');
  assert.equal(task.imageFullPath, '');
  assert.equal(task.parentID, '');
  assert.equal(task.rootID, task.id);
  assert.deepEqual(task.tagIDs, []);
  assert.deepEqual(task.treeISOs, []);
  const firestore = toFirestoreTask(task);
  assert.ok(!('pendingSync' in firestore));
  assert.ok(!('ownerUID' in firestore));
  assert.ok(!('isTombstone' in firestore));
  assert.equal(firestore.photoLayout, 'split-view');
});
