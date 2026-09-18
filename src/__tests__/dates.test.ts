import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDaysISO,
  addMonthsISO,
  calendarFocusMinutes,
  calendarJumpToNowY,
  calendarMountedWindow,
  calendarNudgeCreateTime,
  calendarOriginISO,
  calendarScrollOffset,
  calendarShouldRecenter,
  calendarStripISO,
  CAL_ORIGIN_OFFSET,
  CAL_TOTAL_COLUMNS,
  clampSplitFraction,
  dayWindow,
  habitDueOn,
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

test('calendarJumpToNowY is the current hour minus 48px', () => {
  assert.equal(calendarJumpToNowY('09:00', 50, 48), 9 * 50 - 48);
  assert.equal(calendarJumpToNowY('00:20', 50, 48), 0);
});

test('habitDueOn matches the web seed rrule labels', () => {
  assert.equal(habitDueOn('2026-09-18', 'Every day'), true);
  assert.equal(habitDueOn('2026-09-18', 'Weekly on Wednesday'), false);
  assert.equal(habitDueOn('2026-09-16', 'Weekly on Wednesday'), true);
  assert.equal(habitDueOn('2026-09-20', 'Weekly on Sunday'), true);
});

test('dayWindow is a partial-infinite range around today', () => {
  const today = todayISO();
  const days = dayWindow(today, 2, 3);
  assert.equal(days.length, 6);
  assert.equal(days[2], today);
  assert.equal(days[0], addDaysISO(today, -2));
  assert.equal(days[5], addDaysISO(today, 3));
});

test('calendar strip is 365 days with today at offset 182', () => {
  const today = '2026-09-18';
  assert.equal(calendarOriginISO(today), addDaysISO(today, -CAL_ORIGIN_OFFSET));
  assert.equal(calendarStripISO(today, CAL_ORIGIN_OFFSET), today);
  assert.equal(calendarStripISO(today, CAL_TOTAL_COLUMNS - 1), addDaysISO(today, 182));
});

test('calendar DOM window is viewport ±8 and recenters at a 4-column cushion', () => {
  const window = calendarMountedWindow(182, 183);
  assert.equal(window.start, 174);
  assert.equal(window.end, 191);
  assert.equal(calendarShouldRecenter(182, 183, 174, 191), false);
  assert.equal(calendarShouldRecenter(176, 177, 174, 191), true);
  assert.equal(calendarShouldRecenter(188, 190, 174, 191), true);
  const start = calendarMountedWindow(0, 1);
  assert.equal(start.start, 0);
  const end = calendarMountedWindow(363, 364);
  assert.equal(end.end, 364);
});

test('calendar Enter nudges the next create by duration + 30 minutes', () => {
  assert.equal(calendarNudgeCreateTime('07:00', 30, 30), '08:00');
  assert.equal(calendarNudgeCreateTime('23:30', 30, 30), '23:59');
  assert.equal(calendarNudgeCreateTime(''), '');
});

test('split clamp keeps 48px on each pane of the space after the grip', () => {
  const remaining = 800 - 48;
  assert.equal(clampSplitFraction(0.5, 800), 0.5);
  assert.equal(clampSplitFraction(0, 800), 48 / remaining);
  assert.equal(clampSplitFraction(1, 800), 1 - 48 / remaining);
  assert.equal(clampSplitFraction(0.01, 800), 48 / remaining);
  assert.ok(clampSplitFraction(0.1, 800) > 48 / remaining);
});
