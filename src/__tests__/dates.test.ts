import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDaysISO,
  addMonthsISO,
  calendarFocusMinutes,
  calendarScrollOffset,
  dayWindow,
  parseMinutes,
  relativeDateChip,
  todayISO,
} from '../dates';
import { matchHabitTemplates } from '../services/seed';

test('calendarFocusMinutes keeps 09:00 visible when the first event is later', () => {
  assert.equal(calendarFocusMinutes([]), 9 * 60);
  assert.equal(calendarFocusMinutes(['13:51']), 9 * 60);
  assert.equal(calendarFocusMinutes(['09:00', '13:51']), 9 * 60);
  assert.equal(calendarFocusMinutes(['07:15', '13:51']), parseMinutes('07:15'));
  assert.equal(calendarFocusMinutes(['22:30']), 9 * 60);
  assert.equal(calendarFocusMinutes(['00:40']), 9 * 60);
});

test('calendarScrollOffset pins 08:00 at the top so 09:00 stays visible in a short split', () => {
  assert.equal(calendarScrollOffset([]), 2 * 50 - 8);
  assert.equal(calendarScrollOffset(['13:51']), calendarScrollOffset([]));
  assert.ok(calendarScrollOffset([]) < 3 * 50 - 8);
});

test('relativeDateChip matches the web DateBadge labels', () => {
  const today = '2026-09-18';
  assert.equal(relativeDateChip(today, today), 'today');
  assert.equal(relativeDateChip(addDaysISO(today, 1), today), 'tomorrow');
  assert.equal(relativeDateChip(addDaysISO(today, 8), today), 'in 8d');
  assert.equal(relativeDateChip(addMonthsISO(today, -3), today), '3mo ago');
  assert.equal(relativeDateChip(addMonthsISO(today, 11), today), 'in 11mo');
});

test('matchHabitTemplates opens after the first character', () => {
  assert.equal(matchHabitTemplates('').length, 0);
  assert.ok(matchHabitTemplates('w').some((habit) => habit.name === 'Water the plant'));
  assert.ok(matchHabitTemplates('med').some((habit) => habit.name === 'Meditate'));
});

test('dayWindow is a partial-infinite range around today', () => {
  const today = todayISO();
  const days = dayWindow(today, 2, 3);
  assert.equal(days.length, 6);
  assert.equal(days[2], today);
  assert.equal(days[0], addDaysISO(today, -2));
  assert.equal(days[5], addDaysISO(today, 3));
});
