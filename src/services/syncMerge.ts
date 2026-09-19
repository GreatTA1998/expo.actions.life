import { defaultProfile, defaultTask, type TaskRecord, type UserProfile } from '../models/types';

const LOCAL_TASK_KEYS = new Set(['ownerUID', 'pendingSync', 'updatedAt', 'isTombstone']);

/** Identity / display strings where empty must never clobber a real value. */
const RICH_STRING_KEYS = ['email', 'nickname', 'avatarFilter'] as const;

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** Prefer the first non-blank string; otherwise return `''`. */
export function preferNonEmptyString(...candidates: Array<string | null | undefined>): string {
  for (const value of candidates) {
    if (!isBlank(value) && typeof value === 'string') return value;
  }
  return '';
}

/**
 * Field-level merge of two user profiles.
 * Non-empty strings are never overwritten by `''` / null / undefined.
 * Identity fields (email, nickname, avatarFilter) always keep the richer value
 * regardless of which side is primary. Other fields prefer `primary` when both
 * sides define a non-blank value; otherwise the defined side wins.
 */
export function mergeUserProfiles(
  primary: UserProfile,
  secondary: Partial<UserProfile> | null | undefined,
): UserProfile {
  if (!secondary) return { ...primary, tags: { ...primary.tags } };

  const merged: UserProfile = {
    ...primary,
    tags: { ...(secondary.tags ?? {}), ...(primary.tags ?? {}) },
  };

  const keys = new Set([
    ...Object.keys(primary),
    ...Object.keys(secondary),
  ]) as Set<keyof UserProfile>;

  for (const key of keys) {
    if (key === 'tags') continue;
    const a = primary[key];
    const b = secondary[key];
    if (RICH_STRING_KEYS.includes(key as (typeof RICH_STRING_KEYS)[number])) {
      (merged as Record<string, unknown>)[key] = preferNonEmptyString(
        typeof a === 'string' ? a : undefined,
        typeof b === 'string' ? b : undefined,
      );
      continue;
    }
    if (typeof a === 'string' || typeof b === 'string') {
      (merged as Record<string, unknown>)[key] = preferNonEmptyString(
        typeof a === 'string' ? a : undefined,
        typeof b === 'string' ? b : undefined,
      );
      continue;
    }
    if (b === undefined || b === null) continue;
    if (a === undefined || a === null) {
      (merged as Record<string, unknown>)[key] = b;
      continue;
    }
    // Both defined: keep primary (caller chooses which side is authoritative for settings).
    (merged as Record<string, unknown>)[key] = a;
  }

  merged.uid = preferNonEmptyString(primary.uid, secondary.uid) || primary.uid;
  merged.didSeed = Boolean(primary.didSeed || secondary.didSeed);
  merged.pendingSync = Boolean(primary.pendingSync || secondary.pendingSync);
  merged.updatedAt = Math.max(primary.updatedAt ?? 0, secondary.updatedAt ?? 0);
  return merged;
}

export function fromFirestoreProfile(
  uid: string,
  data: Record<string, unknown> | undefined,
): UserProfile {
  const base = defaultProfile(uid);
  if (!data) return base;
  return {
    ...base,
    uid,
    email: preferNonEmptyString(typeof data.email === 'string' ? data.email : '', base.email),
    maxOrderValue: typeof data.maxOrderValue === 'number' ? data.maxOrderValue : base.maxOrderValue,
    calendarTheme: typeof data.calendarTheme === 'string' ? data.calendarTheme : base.calendarTheme,
    fontScale: typeof data.fontScale === 'number' ? data.fontScale : base.fontScale,
    defaultPhotoLayout:
      typeof data.defaultPhotoLayout === 'string' ? data.defaultPhotoLayout : base.defaultPhotoLayout,
    calSnapInterval: typeof data.calSnapInterval === 'number' ? data.calSnapInterval : base.calSnapInterval,
    listAreaWidthRatio:
      typeof data.listAreaWidthRatio === 'number' ? data.listAreaWidthRatio : base.listAreaWidthRatio,
    listAreaHeightRatio:
      typeof data.listAreaHeightRatio === 'number' ? data.listAreaHeightRatio : base.listAreaHeightRatio,
    listWidthSplit: typeof data.listWidthSplit === 'number' ? data.listWidthSplit : base.listWidthSplit,
    listHeightSplit: typeof data.listHeightSplit === 'number' ? data.listHeightSplit : base.listHeightSplit,
    simpleMode: typeof data.simpleMode === 'boolean' ? data.simpleMode : base.simpleMode,
    photoUploadAutoArchive:
      typeof data.photoUploadAutoArchive === 'boolean'
        ? data.photoUploadAutoArchive
        : base.photoUploadAutoArchive,
    photoCompressWhenAttachingToTask:
      typeof data.photoCompressWhenAttachingToTask === 'boolean'
        ? data.photoCompressWhenAttachingToTask
        : base.photoCompressWhenAttachingToTask,
    hideRoutines: typeof data.hideRoutines === 'boolean' ? data.hideRoutines : base.hideRoutines,
    lastRanRoutines: preferNonEmptyString(
      typeof data.lastRanRoutines === 'string' ? data.lastRanRoutines : '',
      base.lastRanRoutines,
    ),
    nickname: preferNonEmptyString(typeof data.nickname === 'string' ? data.nickname : '', base.nickname),
    avatarFilter: preferNonEmptyString(
      typeof data.avatarFilter === 'string' ? data.avatarFilter : '',
      base.avatarFilter,
    ),
    tags: data.tags && typeof data.tags === 'object' ? (data.tags as UserProfile['tags']) : {},
    pixelsPerHour: typeof data.pixelsPerHour === 'number' ? data.pixelsPerHour : base.pixelsPerHour,
    calColumnWidth: typeof data.calColumnWidth === 'number' ? data.calColumnWidth : base.calColumnWidth,
    didSeed: true,
    pendingSync: false,
    updatedAt: 0,
  };
}

export type FirestoreTask = Omit<
  TaskRecord,
  'ownerUID' | 'pendingSync' | 'updatedAt' | 'isTombstone'
>;

export function toFirestoreTask(task: TaskRecord): FirestoreTask {
  const payload = { ...task } as TaskRecord & Record<string, unknown>;
  for (const key of LOCAL_TASK_KEYS) delete payload[key];
  delete (payload as { id?: string }).id;
  return payload as FirestoreTask;
}

export function fromFirestoreTask(id: string, data: Record<string, unknown>, ownerUID: string): TaskRecord {
  return defaultTask({
    id,
    ownerUID,
    name: String(data.name ?? ''),
    duration: Number(data.duration ?? 30),
    parentID: String(data.parentID ?? ''),
    startTime: String(data.startTime ?? ''),
    startDateISO: String(data.startDateISO ?? ''),
    iconURL: String(data.iconURL ?? ''),
    timeZone: String(data.timeZone ?? ''),
    notes: String(data.notes ?? ''),
    templateID: String(data.templateID ?? ''),
    isDone: Boolean(data.isDone),
    imageDownloadURL: String(data.imageDownloadURL ?? ''),
    imageFullPath: String(data.imageFullPath ?? ''),
    childrenLayout: String(data.childrenLayout ?? 'normal'),
    photoLayout: String(data.photoLayout ?? 'split-view'),
    isCollapsed: Boolean(data.isCollapsed),
    tagIDs: Array.isArray(data.tagIDs) ? data.tagIDs.map(String) : [],
    onList: data.onList === undefined ? true : Boolean(data.onList),
    orderValue: Number(data.orderValue ?? 0),
    treeISOs: Array.isArray(data.treeISOs) ? data.treeISOs.map(String) : [],
    rootID: String(data.rootID ?? id),
    pendingSync: false,
    updatedAt: 0,
    isTombstone: false,
  });
}

export function isLocalOnlyUid(uid: string): boolean {
  return uid.startsWith('guest-') || uid.startsWith('apple-');
}

/** Last-write-wins per document: pending local rows win; otherwise remote replaces. */
export function mergeRemoteTasks(local: TaskRecord[], remote: TaskRecord[]): TaskRecord[] {
  const localById = new Map(local.map((task) => [task.id, task]));
  const remoteById = new Map(remote.map((task) => [task.id, task]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const merged: TaskRecord[] = [];
  for (const id of ids) {
    const loc = localById.get(id);
    const rem = remoteById.get(id);
    if (loc?.pendingSync || loc?.isTombstone) {
      merged.push(loc);
      continue;
    }
    if (rem) {
      merged.push({
        ...rem,
        ownerUID: loc?.ownerUID ?? rem.ownerUID,
        pendingSync: false,
        updatedAt: loc?.updatedAt ?? 0,
        isTombstone: false,
      });
      continue;
    }
    if (loc) merged.push(loc);
  }
  return merged;
}

export function toFirestoreProfile(profile: {
  uid: string;
  email: string;
  maxOrderValue: number;
  calendarTheme: string;
  fontScale: number;
  defaultPhotoLayout: string;
  calSnapInterval: number;
  listAreaWidthRatio: number;
  listAreaHeightRatio: number;
  listWidthSplit: number;
  listHeightSplit: number;
  simpleMode: boolean;
  photoUploadAutoArchive: boolean;
  photoCompressWhenAttachingToTask: boolean;
  hideRoutines: boolean;
  lastRanRoutines: string;
  nickname: string;
  avatarFilter: string;
  tags: Record<string, { color: string; name: string }>;
  pixelsPerHour: number;
  calColumnWidth: number;
}) {
  // Omit blank identity fields so setDoc({ merge: true }) cannot wipe a richer
  // remote email/nickname with local defaults (`''`).
  const payload: Record<string, unknown> = {
    uid: profile.uid,
    maxOrderValue: profile.maxOrderValue,
    calendarTheme: profile.calendarTheme,
    fontScale: profile.fontScale,
    defaultPhotoLayout: profile.defaultPhotoLayout,
    calSnapInterval: profile.calSnapInterval,
    listAreaWidthRatio: profile.listAreaWidthRatio,
    listAreaHeightRatio: profile.listAreaHeightRatio,
    listWidthSplit: profile.listWidthSplit,
    listHeightSplit: profile.listHeightSplit,
    simpleMode: profile.simpleMode,
    photoUploadAutoArchive: profile.photoUploadAutoArchive,
    photoCompressWhenAttachingToTask: profile.photoCompressWhenAttachingToTask,
    hideRoutines: profile.hideRoutines,
    lastRanRoutines: profile.lastRanRoutines,
    tags: profile.tags,
    pixelsPerHour: profile.pixelsPerHour,
    calColumnWidth: profile.calColumnWidth,
  };
  if (!isBlank(profile.email)) payload.email = profile.email;
  if (!isBlank(profile.nickname)) payload.nickname = profile.nickname;
  if (!isBlank(profile.avatarFilter)) payload.avatarFilter = profile.avatarFilter;
  return payload;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
