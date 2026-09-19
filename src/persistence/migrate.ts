import { defaultProfile } from '../models/types';
import type { TaskRepository } from './repository';
import { mergeUserProfiles } from '../services/syncMerge';

export async function migrateUid(repo: TaskRepository, fromUid: string, toUid: string): Promise<void> {
  if (fromUid === toUid) return;
  const [tasks, profile, outbox, destProfile] = await Promise.all([
    repo.loadTasks(fromUid),
    repo.loadProfile(fromUid),
    repo.loadOutbox(fromUid),
    repo.loadProfile(toUid),
  ]);
  // Promote already copies then clears the source. A second migrate of the empty
  // source must not overwrite the destination.
  if (tasks.length === 0 && !profile && outbox.length === 0) return;
  const destTasks = await repo.loadTasks(toUid);
  if (tasks.length === 0 && destTasks.length > 0) return;
  await repo.replaceTasks(
    toUid,
    tasks.map((task) => ({ ...task, ownerUID: toUid, pendingSync: true })),
  );
  if (profile || destProfile) {
    const base = destProfile ?? defaultProfile(toUid);
    const incoming = profile ? { ...profile, uid: toUid } : null;
    // Dest is primary so a guest '' email cannot wipe a Google account email.
    const merged = mergeUserProfiles(base, incoming);
    await repo.saveProfile({ ...merged, uid: toUid, pendingSync: true, updatedAt: Date.now() });
  }
  for (const op of outbox) {
    await repo.enqueue({ ...op, ownerUID: toUid });
  }
  await repo.replaceTasks(fromUid, []);
  await repo.clearOutbox(fromUid);
  // Leave a didSeed stub so booting the emptied guest-* uid cannot insert a second seed tree.
  await repo.saveProfile({ ...defaultProfile(fromUid), didSeed: true, updatedAt: Date.now() });
}
