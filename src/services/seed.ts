import { addDaysISO, addMonthsISO, nowHM, todayISO } from '../dates';
import type { TaskTreeStore } from './taskStore';

const ICON = {
  waterPlant:
    'https://firebasestorage.googleapis.com/v0/b/project-y-2a061.appspot.com/o/icons%2FEPtvgSIsPkpznSIffOoa.png?alt=media&token=018a960d-1f76-47eb-a0fe-85c6a5423bd9',
  drinkWater:
    'https://firebasestorage.googleapis.com/v0/b/project-y-2a061.appspot.com/o/icons%2F6w6I9VRWZLRWqphuLgFz.png?alt=media&token=ba68dd3b-83fe-4ed2-bc38-9a2888d31f1b',
  meditate:
    'https://firebasestorage.googleapis.com/v0/b/project-y-2a061.appspot.com/o/icons%2FhsCFkECSF4PcFt6MOcW0.png?alt=media&token=d4ed8987-9001-43bc-b48b-4f36caef6fb1',
  laundry:
    'https://firebasestorage.googleapis.com/v0/b/project-y-2a061.appspot.com/o/icons%2Fk49WsIjV1kQ2e6MW52BR.png?alt=media&token=0d44da5b-dfd7-4ff3-9971-3637b748c6be',
};

export const HABIT_TEMPLATES = [
  { id: 'template-habit-water', name: 'Water the plant', duration: 15, rr: 'Weekly on Wednesday', iconURL: ICON.waterPlant },
  { id: 'template-habit-drink', name: 'Drink water', duration: 1, rr: 'Every day', iconURL: ICON.drinkWater },
  { id: 'template-habit-meditate', name: 'Meditate', duration: 15, rr: 'Every day', iconURL: ICON.meditate },
  { id: 'template-habit-laundry', name: 'Dry laundry', duration: 10, rr: 'Weekly on Sunday', iconURL: ICON.laundry },
] as const;

export function matchHabitTemplates(query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return HABIT_TEMPLATES.filter((habit) => habit.name.toLowerCase().includes(needle));
}

const PHOTOS = {
  olaDrawingByDad: 'https://i.imgur.com/Pu7PxCi.jpeg',
  redCrownBird: 'https://i.imgur.com/waIioxd.jpeg',
};

export async function insertGuestSeed(store: TaskTreeStore): Promise<void> {
  const today = todayISO();
  const time = nowHM();

  const skip = { persist: false as const };
  await store.create(
    {
      id: 'photo-bird',
      name: 'Bird-watching with family',
      imageDownloadURL: PHOTOS.redCrownBird,
      startDateISO: today,
      startTime: time,
      onList: false,
      duration: 106,
      isDone: true,
    },
    skip,
  );
  await store.create(
    {
      id: 'photo-dog',
      name: 'Drawing with friends',
      imageDownloadURL: PHOTOS.olaDrawingByDad,
      startDateISO: addDaysISO(today, 1),
      startTime: time,
      onList: false,
      duration: 106,
    },
    skip,
  );

  await store.create({ id: 'getting-started', name: 'TO-DO', onList: true }, skip);
  await store.create(
    {
      id: 'todo-drag',
      name: 'Drag me to the calendar',
      parentID: 'getting-started',
      onList: true,
    },
    skip,
  );
  await store.create(
    {
      id: 'todo-photo',
      name: 'Attach a photo',
      parentID: 'getting-started',
      onList: true,
    },
    skip,
  );
  await store.create(
    {
      id: 'todo-icon',
      name: 'Draw a habit icon',
      parentID: 'getting-started',
      onList: true,
      notes: 'Create a repeat template, then replace the checkbox with an icon',
    },
    skip,
  );
  await store.create(
    {
      id: 'todo-gcal',
      name: 'Connect with Google Calendar',
      parentID: 'getting-started',
      onList: true,
      notes: 'Multiple accounts can be associated',
    },
    skip,
  );

  await store.create(
    {
      id: 'visa',
      name: 'Visa timeline',
      onList: true,
      childrenLayout: 'timeline',
    },
    skip,
  );
  await store.create(
    {
      id: 'visa-startup',
      name: 'Startup visa',
      parentID: 'visa',
      onList: true,
      startDateISO: addMonthsISO(today, -3),
      isDone: true,
    },
    skip,
  );
  await store.create(
    {
      id: 'visa-renewal',
      name: 'Visa renewal',
      parentID: 'visa',
      onList: true,
      startDateISO: addDaysISO(today, 8),
    },
    skip,
  );
  await store.create(
    {
      id: 'visa-manager',
      name: 'Business Manager visa',
      parentID: 'visa',
      onList: true,
      startDateISO: addMonthsISO(today, 11),
    },
    skip,
  );
  await store.flush();
}
