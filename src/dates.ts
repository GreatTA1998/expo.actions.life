function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function nowHM(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setMonth(date.getMonth() + months);
  return toISODate(date);
}

export function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function weekdayShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
}

export function dayNumber(iso: string): string {
  return iso.slice(8);
}

export function surroundingDays(centerISO: string, radius = 7): string[] {
  const days: string[] = [];
  for (let i = -radius; i <= radius; i += 1) days.push(addDaysISO(centerISO, i));
  return days;
}

/** Inclusive day window used by the partial-infinite calendar. */
export function dayWindow(centerISO: string, past: number, future: number): string[] {
  const days: string[] = [];
  for (let i = -past; i <= future; i += 1) days.push(addDaysISO(centerISO, i));
  return days;
}

export function monthYearLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function snapMinutes(total: number, interval = 15): number {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  return Math.round(clamped / interval) * interval;
}

export function parseMinutes(hhmm: string): number {
  if (!hhmm || !hhmm.includes(':')) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Scroll the day grid so 09:00 stays visible even when the day is empty or only has night events. */
export function calendarFocusMinutes(startTimes: string[], morning = 9 * 60): number {
  const times = startTimes.filter(Boolean).map(parseMinutes);
  const daytime = times.filter((minutes) => minutes >= 6 * 60 && minutes < 21 * 60);
  if (daytime.length === 0) return morning;
  return Math.min(Math.min(...daytime), morning);
}

export function calendarScrollOffset(
  startTimes: string[],
  startHour = 6,
  pxPerHour = 50,
): number {
  const minutes = calendarFocusMinutes(startTimes);
  // Pin 08:00 at the top when we only need 09:00 on screen. The short home split
  // otherwise clips 08:00 above the fold; later hours stay reachable by scrolling.
  const topMinutes = minutes >= 9 * 60 ? 8 * 60 : minutes;
  return Math.max(0, ((topMinutes - startHour * 60) / 60) * pxPerHour - 8);
}

/** Web jumpToToday: current hour − 48px headroom. */
export function calendarJumpToNowY(now = nowHM(), pxPerHour = 50, headroom = 48): number {
  return Math.max(0, (parseMinutes(now) / 60) * pxPerHour - headroom);
}

export function habitDueOn(iso: string, rr: string): boolean {
  const dow = new Date(`${iso}T00:00:00`).getDay();
  if (rr === 'Every day') return true;
  if (rr.includes('Wednesday')) return dow === 3;
  if (rr.includes('Sunday')) return dow === 0;
  return false;
}

export function formatMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${pad(h)}:${pad(m)}`;
}

export function isValidISODate(dateStr: string): boolean {
  if (dateStr === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00`);
  const to = new Date(`${toISO}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Web DateBadge: today / tomorrow / `8d` / `3mo` / `1y`, with ago vs in. */
export function relativeDateChip(iso: string, today = todayISO()): string {
  if (!iso) return 'select date';
  const days = daysBetween(today, iso);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  const span = Math.abs(days);
  const amount =
    span < 28 ? `${span}d` : span < 365 ? `${Math.round(span / 30)}mo` : `${Math.round(span / 365)}y`;
  return days < 0 ? `${amount} ago` : `in ${amount}`;
}

export function isPastDate(iso: string, today = todayISO()): boolean {
  return !!iso && daysBetween(today, iso) < 0;
}
