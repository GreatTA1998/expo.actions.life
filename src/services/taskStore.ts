import { addDaysISO, todayISO } from '../dates';
import { randomID } from '../ids';
import { defaultProfile, defaultTask, type TaskRecord, type TaskTree, type UserProfile } from '../models/types';
import type { TaskRepository } from '../persistence/repository';
import {
  applyDateChange,
  applyDeletion,
  adjacentSibling,
  applyReparent,
  computeOrderValue,
  childrenForest,
  inboxForest,
  listSiblings,
  nextOrderValue,
  parentIDOf,
  previousSibling,
  subtreeIDs,
} from '../tree/treeMaintenance';
import { peekFirebase } from './firebase';
import { insertGuestSeed } from './seed';
import { isLocalOnlyUid, mergeUserProfiles } from './syncMerge';
import { SyncEngine } from './syncEngine';

export type CreateTaskInput = {
  name: string;
  parentID?: string;
  onList?: boolean;
  startDateISO?: string;
  startTime?: string;
  duration?: number;
  notes?: string;
  id?: string;
  childrenLayout?: string;
  photoLayout?: string;
  isDone?: boolean;
  isCollapsed?: boolean;
  imageDownloadURL?: string;
  imageFullPath?: string;
  iconURL?: string;
  templateID?: string;
  timeZone?: string;
  tagIDs?: string[];
  /** Root inbox rows go above the fold when set to `start`. */
  place?: 'start' | 'end';
  /** Explicit sibling rank (web dropzone / popover input). */
  orderValue?: number;
  /** Insert among current siblings at this index (0 = first). */
  index?: number;
};

export function mergeTaskRecords(disk: TaskRecord[], memory: TaskRecord[]): TaskRecord[] {
  const byId = new Map<string, TaskRecord>();
  for (const task of disk) byId.set(task.id, task);
  for (const task of memory) {
    const existing = byId.get(task.id);
    if (!existing || task.updatedAt >= existing.updatedAt) byId.set(task.id, task);
  }
  return [...byId.values()];
}

export class TaskTreeStore {
  readonly uid: string;
  private records: TaskRecord[] = [];
  inbox: TaskTree[] = [];
  profile: UserProfile;
  listHeightSplit = 0.5;
  hydrated = false;
  private writeThrough = false;
  private repo: TaskRepository;
  private readonly sync: SyncEngine;
  private listeners = new Set<() => void>();

  constructor(repo: TaskRepository, uid: string) {
    this.uid = uid;
    this.repo = repo;
    this.profile = defaultProfile(uid);
    this.sync = new SyncEngine(repo);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  async init(): Promise<void> {
    const loaded = await this.repo.loadTasks(this.uid);
    const loadedProfile = await this.repo.loadProfile(this.uid);
    this.records = mergeTaskRecords(loaded, this.records);
    if (loadedProfile) {
      // Disk is primary for settings; memory only fills blank identity fields.
      this.profile = mergeUserProfiles(loadedProfile, this.profile);
    }
    this.listHeightSplit = this.profile.listHeightSplit;
    this.reloadViews();
    this.notify();
    this.writeThrough = true;
    // Demo seed is guest-only (web seeds only new anonymous users). Never insert
    // TO-DO / Visa into a Google/Apple Firebase uid — that polluted linked accounts.
    if (!this.profile.didSeed && this.records.length === 0 && isLocalOnlyUid(this.uid)) {
      await insertGuestSeed(this);
      this.profile = { ...this.profile, didSeed: true, updatedAt: Date.now() };
      await this.repo.saveProfile(this.profile);
      this.reloadViews();
    } else if (!this.profile.didSeed) {
      this.profile = { ...this.profile, didSeed: true, updatedAt: Date.now() };
      await this.repo.saveProfile(this.profile);
    } else if (this.records.length !== loaded.length) {
      await this.persist();
    }
    this.hydrated = true;
    this.notify();
  }

  /** Swap the in-memory boot repo for SQLite without dropping rows created on first paint. */
  async adoptRepository(repo: TaskRepository): Promise<void> {
    if (this.repo === repo) {
      this.writeThrough = true;
      this.hydrated = true;
      return;
    }
    const loaded = await repo.loadTasks(this.uid);
    const loadedProfile = await repo.loadProfile(this.uid);
    this.records = mergeTaskRecords(loaded, this.records);
    if (loadedProfile) {
      // Disk is primary for settings; memory only fills blank identity fields.
      this.profile = mergeUserProfiles(loadedProfile, this.profile);
    }
    this.listHeightSplit = this.profile.listHeightSplit;
    this.repo = repo;
    this.writeThrough = true;
    this.hydrated = true;
    await this.persist();
  }

  private reloadViews() {
    this.inbox = inboxForest(this.records);
  }

  allTasks(): TaskRecord[] {
    return this.records;
  }

  childrenOf(parentID: string): TaskTree[] {
    return childrenForest(parentID, this.records);
  }

  task(id: string): TaskRecord | undefined {
    return this.records.find((doc) => doc.id === id);
  }

  tasksOnDay(dayISO: string): TaskRecord[] {
    return this.records
      .filter((doc) => doc.startDateISO === dayISO)
      .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));
  }

  siblingsOnList(parentID: string): TaskRecord[] {
    return listSiblings(parentID, this.records);
  }

  async create(input: CreateTaskInput, options?: { persist?: boolean }): Promise<TaskRecord> {
    const parentID = input.parentID ?? '';
    let order: number;
    if (typeof input.orderValue === 'number') {
      order = input.orderValue;
    } else if (typeof input.index === 'number') {
      order = computeOrderValue(input.index, this.siblingsOnList(parentID));
    } else if (input.place === 'start') {
      const siblings = this.records.filter((doc) => doc.parentID === parentID && !doc.isTombstone);
      const min = siblings.reduce((lowest, doc) => Math.min(lowest, doc.orderValue), 0);
      order = min - 1;
    } else {
      order = nextOrderValue(this.profile.maxOrderValue);
    }
    const id = input.id ?? randomID();
    const startDateISO = input.startDateISO ?? '';
    let rootID = id;
    let treeISOs = [startDateISO].filter(Boolean);
    let tagIDs: string[] = input.tagIDs ? [...input.tagIDs] : [];
    if (parentID) {
      const parent = this.records.find((doc) => doc.id === parentID);
      if (parent) {
        rootID = parent.rootID;
        if (!input.tagIDs) tagIDs = [...parent.tagIDs];
        treeISOs = [...parent.treeISOs];
        if (startDateISO) treeISOs = [...treeISOs, startDateISO];
      }
    }

    if (this.records.some((doc) => doc.id === id)) {
      return this.task(id)!;
    }

    const record = defaultTask({
      id,
      ownerUID: this.uid,
      name: input.name,
      duration: input.duration ?? 30,
      parentID,
      startTime: input.startTime ?? '',
      startDateISO,
      notes: input.notes ?? '',
      isDone: input.isDone ?? false,
      isCollapsed: input.isCollapsed ?? false,
      imageDownloadURL: input.imageDownloadURL ?? '',
      imageFullPath: input.imageFullPath ?? '',
      iconURL: input.iconURL ?? '',
      templateID: input.templateID ?? '',
      timeZone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      childrenLayout: input.childrenLayout ?? 'normal',
      photoLayout: input.photoLayout ?? 'split-view',
      onList: input.onList ?? true,
      orderValue: order,
      treeISOs,
      rootID,
      tagIDs,
      pendingSync: true,
      updatedAt: Date.now(),
    });

    this.records = [...this.records, record];
    if (parentID && startDateISO) {
      this.records = this.records.map((doc) =>
        doc.rootID === rootID ? { ...doc, treeISOs } : doc,
      );
    }
    const maxOrderValue = Math.max(this.profile.maxOrderValue, order);
    this.profile = { ...this.profile, maxOrderValue, updatedAt: Date.now(), pendingSync: true };
    if (this.writeThrough) await this.sync.enqueue(this.uid, 'create', 'tasks', id);
    if (options?.persist === false) {
      this.reloadViews();
      this.notify();
    } else {
      await this.persist();
    }
    return record;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.patch(id, { name });
  }

  async setNotes(id: string, notes: string): Promise<void> {
    await this.patch(id, { notes });
  }

  async setDuration(id: string, minutes: number): Promise<void> {
    await this.update(id, { duration: Math.max(1, minutes) });
  }

  async toggleDone(id: string): Promise<void> {
    const task = this.task(id);
    if (!task) return;
    await this.update(id, { isDone: !task.isDone });
  }

  async setCollapsed(id: string, isCollapsed: boolean): Promise<void> {
    await this.update(id, { isCollapsed });
  }

  async setOnList(id: string, onList: boolean): Promise<void> {
    await this.update(id, { onList });
  }

  lastSyncReason = 'not-yet';
  lastUndo: { label: string; run: () => Promise<void> } | null = null;

  async schedule(id: string, dayISO: string, time?: string, duration?: number): Promise<void> {
    const previous = this.task(id);
    this.records = applyDateChange(id, dayISO, this.records);
    this.records = this.records.map((doc) => {
      if (doc.id !== id) return doc;
      return {
        ...doc,
        startTime: time ?? doc.startTime,
        duration: duration ?? doc.duration,
        onList: this.profile.simpleMode ? false : doc.onList,
        pendingSync: true,
        updatedAt: Date.now(),
      };
    });
    await this.sync.enqueue(this.uid, 'batchTree', 'tasks', id);
    if (this.profile.simpleMode && previous?.onList) {
      this.lastUndo = {
        label: 'Archived from the list',
        run: () => this.setOnList(id, true),
      };
    }
    await this.persist();
  }

  async clearSchedule(id: string): Promise<void> {
    this.records = applyDateChange(id, '', this.records);
    this.records = this.records.map((doc) =>
      doc.id === id ? { ...doc, startTime: '', pendingSync: true, updatedAt: Date.now() } : doc,
    );
    await this.sync.enqueue(this.uid, 'batchTree', 'tasks', id);
    await this.persist();
  }

  async nest(id: string, underParentID: string, index?: number): Promise<void> {
    const rooms = this.siblingsOnList(underParentID).filter((doc) => doc.id !== id);
    await this.placeOnList(id, { parentID: underParentID, index: index ?? rooms.length });
  }

  /**
   * Web placeOnList: reparent + orderValue + onList.
   * `unschedule` clears calendar fields (drag from calendar onto the list).
   */
  async placeOnList(
    id: string,
    opts: { parentID: string; index: number; unschedule?: boolean },
  ): Promise<boolean> {
    const current = this.task(id);
    if (!current) return false;
    if (opts.parentID === id) return false;
    const rooms = this.siblingsOnList(opts.parentID);
    const orderValue = computeOrderValue(opts.index, rooms);
    if (current.parentID !== opts.parentID) {
      const before = current.parentID;
      this.records = applyReparent(id, opts.parentID, this.records);
      if (this.task(id)?.parentID === before && opts.parentID !== before) return false;
    }
    if (opts.unschedule) {
      this.records = applyDateChange(id, '', this.records);
    }
    this.records = this.records.map((doc) => {
      if (doc.id !== id) return doc;
      return {
        ...doc,
        orderValue,
        onList: true,
        ...(opts.unschedule ? { startTime: '', startDateISO: '' } : {}),
        pendingSync: true,
        updatedAt: Date.now(),
      };
    });
    const parent = opts.parentID ? this.task(opts.parentID) : undefined;
    if (parent?.isCollapsed) {
      this.records = this.records.map((doc) =>
        doc.id === parent.id ? { ...doc, isCollapsed: false, pendingSync: true, updatedAt: Date.now() } : doc,
      );
    }
    this.profile = {
      ...this.profile,
      maxOrderValue: Math.max(this.profile.maxOrderValue, orderValue),
      updatedAt: Date.now(),
      pendingSync: true,
    };
    await this.sync.enqueue(this.uid, 'batchTree', 'tasks', id);
    await this.persist();
    return true;
  }

  /** Web placeOnCal. Nested calendar blocks become roots. */
  async placeOnCal(id: string, dayISO: string, time: string, unparent = false): Promise<void> {
    if (unparent) {
      this.records = applyReparent(id, '', this.records);
    }
    await this.schedule(id, dayISO, time);
  }

  async indent(id: string): Promise<boolean> {
    const sibling = previousSibling(id, this.inbox);
    if (!sibling) return false;
    await this.nest(id, sibling.id);
    if (sibling.isCollapsed) await this.setCollapsed(sibling.id, false);
    return true;
  }

  async outdent(id: string): Promise<boolean> {
    const currentParent = parentIDOf(id, this.records);
    if (!currentParent) return false;
    const grandparent = parentIDOf(currentParent, this.records) ?? '';
    const rooms = this.siblingsOnList(grandparent).filter((doc) => doc.id !== id);
    const parentIndex = rooms.findIndex((doc) => doc.id === currentParent);
    await this.nest(id, grandparent, parentIndex < 0 ? rooms.length : parentIndex + 1);
    return true;
  }

  async archive(id: string): Promise<void> {
    const ids = new Set(subtreeIDs(id, this.records));
    const count = ids.size;
    this.records = this.records.map((doc) =>
      ids.has(doc.id) ? { ...doc, onList: false, pendingSync: true, updatedAt: Date.now() } : doc,
    );
    this.lastUndo = {
      label: `${count} task${count > 1 ? 's' : ''} archived from the list`,
      run: () => this.unarchive(id),
    };
    await this.sync.enqueue(this.uid, 'update', 'tasks', id);
    await this.persist();
  }

  async unarchive(id: string): Promise<void> {
    const ids = new Set(subtreeIDs(id, this.records));
    this.records = this.records.map((doc) =>
      ids.has(doc.id) ? { ...doc, onList: true, pendingSync: true, updatedAt: Date.now() } : doc,
    );
    await this.sync.enqueue(this.uid, 'update', 'tasks', id);
    await this.persist();
  }

  async deleteSubtree(id: string): Promise<void> {
    this.records = applyDeletion(id, this.records);
    await this.sync.enqueue(this.uid, 'delete', 'tasks', id);
    await this.persist();
  }

  async addSubtask(parentID: string, name: string): Promise<void> {
    await this.create({ name, parentID, onList: true });
  }

  async moveAmongSiblings(id: string, delta: -1 | 1): Promise<boolean> {
    const neighbor = adjacentSibling(id, this.inbox, delta);
    const self = this.task(id);
    if (!neighbor || !self) return false;
    let nextSelf = neighbor.orderValue;
    let nextNeighbor = self.orderValue;
    if (nextSelf === nextNeighbor) {
      nextSelf = self.orderValue + delta;
    }
    this.records = this.records.map((doc) => {
      if (doc.id === id) {
        return { ...doc, orderValue: nextSelf, pendingSync: true, updatedAt: Date.now() };
      }
      if (doc.id === neighbor.id) {
        return { ...doc, orderValue: nextNeighbor, pendingSync: true, updatedAt: Date.now() };
      }
      return doc;
    });
    await this.sync.enqueue(this.uid, 'batchTree', 'tasks', id);
    await this.persist();
    return true;
  }

  async setSimpleMode(value: boolean): Promise<void> {
    this.profile = { ...this.profile, simpleMode: value, pendingSync: true, updatedAt: Date.now() };
    await this.repo.saveProfile(this.profile);
    this.notify();
  }

  photoTasks(): TaskRecord[] {
    return this.records
      .filter((task) => task.imageDownloadURL)
      .sort((a, b) => (b.startDateISO || '').localeCompare(a.startDateISO || ''));
  }

  agendaDays(count = 14): { iso: string; tasks: TaskRecord[] }[] {
    const start = todayISO();
    const days: { iso: string; tasks: TaskRecord[] }[] = [];
    for (let i = 0; i < count; i += 1) {
      const iso = addDaysISO(start, i);
      days.push({ iso, tasks: this.tasksOnDay(iso) });
    }
    return days;
  }

  /** Keep Auth/session identity on the local profile without letting blanks wipe richer values. */
  applySessionIdentity(session: { email?: string | null }): void {
    const email = session.email ?? '';
    if (!email && !this.profile.email) return;
    this.profile = mergeUserProfiles(this.profile, {
      ...this.profile,
      email,
      updatedAt: Date.now(),
    });
  }

  async syncNow(): Promise<{ drained: number; reason: string }> {
    const result = await this.sync.drainIfPossible({
      uid: this.uid,
      tasks: this.records,
      profile: this.profile,
    });
    this.lastSyncReason = result.reason;
    if (result.profile) {
      this.profile = mergeUserProfiles(this.profile, result.profile);
      await this.repo.saveProfile(this.profile);
    }
    if (result.reason === 'ok') {
      this.records = this.records.map((task) => ({ ...task, pendingSync: false }));
      await this.repo.replaceTasks(this.uid, this.records);
      const pulled = await this.sync.pull(this.uid, this.records);
      if (pulled) {
        this.records = pulled;
        await this.repo.replaceTasks(this.uid, this.records);
        this.reloadViews();
      }
    }
    this.notify();
    return result;
  }

  clearUndo() {
    this.lastUndo = null;
    this.notify();
  }

  private splitTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  async setListHeightSplit(value: number): Promise<void> {
    this.listHeightSplit = Math.min(1, Math.max(0, value));
    this.profile = { ...this.profile, listHeightSplit: this.listHeightSplit, updatedAt: Date.now() };
    this.notify();
    if (this.splitTimer) clearTimeout(this.splitTimer);
    this.splitTimer = setTimeout(() => {
      void this.repo.saveProfile(this.profile);
    }, 200);
  }

  async flush(): Promise<void> {
    await this.persist();
  }

  private async patch(id: string, changes: Partial<TaskRecord>): Promise<void> {
    this.records = this.records.map((doc) =>
      doc.id === id ? { ...doc, ...changes, pendingSync: true, updatedAt: Date.now() } : doc,
    );
    if (this.writeThrough) await this.sync.enqueue(this.uid, 'update', 'tasks', id);
    await this.persist();
  }

  private async update(id: string, changes: Partial<TaskRecord>): Promise<void> {
    this.records = this.records.map((doc) =>
      doc.id === id ? { ...doc, ...changes, pendingSync: true, updatedAt: Date.now() } : doc,
    );
    if (this.writeThrough) await this.sync.enqueue(this.uid, 'update', 'tasks', id);
    await this.persist();
  }

  private async persist(): Promise<void> {
    this.reloadViews();
    this.notify();
    if (!this.writeThrough) return;
    await this.repo.replaceTasks(this.uid, this.records);
    await this.repo.saveProfile(this.profile);
    const signedIn = peekFirebase()?.auth.currentUser;
    if (!signedIn || signedIn.uid !== this.uid) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      void this.syncNow();
    }, 400);
  }
}
