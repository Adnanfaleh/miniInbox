import { DAYS, parseWorkingDays } from '@mini-inbox/contracts';

export { parseWorkingDays };

function minutesOf(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Day of week (0 = Sunday) and minute of day for `now` in the tenant's IANA time zone. */
export function localDayAndMinute(now: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = DAYS.indexOf(get('weekday').toUpperCase().slice(0, 3) as (typeof DAYS)[number]);
  return { day, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

export interface WorkingHours {
  timeZone: string;
  workingDays: string;
  /** HH:MM */
  workStart: string;
  /** HH:MM. Earlier than start means the shift runs past midnight. */
  workEnd: string;
}

/**
 * True if `now` falls inside the tenant's working hours. An unreadable configuration counts as "open", so a
 * bad setting never silences the assistant. The persona API validates the format on save.
 */
export function isWithinWorkingHours(now: Date, hours: WorkingHours): boolean {
  const days = parseWorkingDays(hours.workingDays);
  const start = minutesOf(hours.workStart);
  const end = minutesOf(hours.workEnd);
  if (!days || start === null || end === null || start === end) return true;
  const { day, minute } = localDayAndMinute(now, hours.timeZone);
  if (start < end) return days.has(day) && minute >= start && minute < end;
  // Overnight shift: the part after midnight belongs to the previous day's shift.
  const previous = (day + 6) % 7;
  return (days.has(day) && minute >= start) || (days.has(previous) && minute < end);
}
