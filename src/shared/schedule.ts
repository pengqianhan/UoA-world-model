// Which timetabled sessions run at a given Auckland date and time.
//
// A session is a weekly meeting pattern: a weekday, a start and end time of day, and an inclusive
// date range. It describes when a class is *scheduled*, not whether anyone is in the room.
import { isTeachingDay } from "./calendar.ts";
import { isoWeekday } from "./time.ts";
import type { AcademicCalendar, Session } from "./types.ts";

/** True if the session is scheduled on this calendar date (any time of day). */
export function runsOnDate(s: Session, date: string, cal?: AcademicCalendar): boolean {
  if (date < s.startDate || date > s.endDate) return false;
  if (isoWeekday(date) !== s.day) return false;
  // Meeting patterns often span a mid-semester break or a public holiday without saying so.
  if (cal && !isTeachingDay(cal, date)) return false;
  return true;
}

/** True if the session is in progress at `minutes` after midnight on `date`. End time is exclusive. */
export function runsAt(s: Session, date: string, minutes: number, cal?: AcademicCalendar): boolean {
  return minutes >= s.start && minutes < s.end && runsOnDate(s, date, cal);
}

export function sessionsAt(sessions: readonly Session[], date: string, minutes: number, cal?: AcademicCalendar): Session[] {
  return sessions.filter((s) => runsAt(s, date, minutes, cal));
}

export function sessionsOnDate(sessions: readonly Session[], date: string, cal?: AcademicCalendar): Session[] {
  return sessions.filter((s) => runsOnDate(s, date, cal)).sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The next session in the list starting after `minutes` on `date`, if any. */
export function nextSession(sessions: readonly Session[], date: string, minutes: number, cal?: AcademicCalendar): Session | undefined {
  return sessionsOnDate(sessions, date, cal).find((s) => s.start > minutes);
}
