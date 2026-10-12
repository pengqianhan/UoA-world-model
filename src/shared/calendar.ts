// Where a calendar date falls in the academic year: teaching week, break, exams, holiday.
import type { AcademicCalendar, LocalizedText, TermDates } from "./types.ts";
import { addDays, daysBetween, isoWeekday, mondayOf } from "./time.ts";

export type Phase = "teaching" | "break" | "studyBreak" | "exams" | "betweenTerms";

export interface TermStatus {
  phase: Phase;
  /** The term the date belongs to; undefined between terms. */
  term?: TermDates;
  /** Teaching week number (1-based), counting only weeks with lectures. */
  week?: number;
  /** Name of the break when phase is "break". */
  breakName?: LocalizedText;
  /** Public or University holiday on this date, if any. Classes do not run on holidays. */
  holiday?: LocalizedText;
  /** True on Saturdays and Sundays. */
  weekend: boolean;
}

const within = (date: string, start: string, end: string) => date >= start && date <= end;

/** Number of teaching weeks from the start of term up to and including the week of `date`. */
export function teachingWeek(term: TermDates, date: string): number | undefined {
  if (date < term.start || date > term.lecturesEnd) return undefined;
  if (term.breaks.some((b) => within(date, b.start, b.end))) return undefined;
  const first = mondayOf(term.start);
  const target = mondayOf(date);
  let week = 0;
  for (let monday = first; monday <= target; monday = addDays(monday, 7)) {
    // A week counts as a teaching week if at least one weekday in it is outside every break.
    let teaches = false;
    for (let d = 0; d < 5; d++) {
      const day = addDays(monday, d);
      if (day < term.start || day > term.lecturesEnd) continue;
      if (!term.breaks.some((b) => within(day, b.start, b.end))) teaches = true;
    }
    if (teaches) week++;
  }
  return week || undefined;
}

/**
 * Status of a date. When terms overlap (quarters run alongside semesters) the semester-style
 * terms win, because they are what most on-campus classes follow.
 */
export function termStatus(cal: AcademicCalendar, date: string): TermStatus {
  const weekend = isoWeekday(date) >= 6;
  const holiday = cal.holidays.find((h) => h.date === date)?.name;
  const rank = (t: TermDates) => (t.kind === "semester" ? 0 : t.kind === "summer" ? 1 : t.kind === "lateYear" ? 3 : 2);
  const term = cal.terms
    .filter((t) => within(date, t.start, t.end))
    .sort((a, b) => rank(a) - rank(b))[0];
  if (!term) return { phase: "betweenTerms", holiday, weekend };

  const brk = term.breaks.find((b) => within(date, b.start, b.end));
  if (brk) return { phase: "break", term, breakName: brk.name, holiday, weekend };
  if (term.exams && within(date, term.exams.start, term.exams.end)) return { phase: "exams", term, holiday, weekend };
  if (term.studyBreak && within(date, term.studyBreak.start, term.studyBreak.end)) {
    return { phase: "studyBreak", term, holiday, weekend };
  }
  if (date <= term.lecturesEnd) return { phase: "teaching", term, week: teachingWeek(term, date), holiday, weekend };
  // After lectures end but before any listed study break or exams (e.g. the Labour Day Monday).
  return { phase: "studyBreak", term, holiday, weekend };
}

/** True when timetabled classes can run on this date: a teaching day that is not a holiday. */
export function isTeachingDay(cal: AcademicCalendar, date: string): boolean {
  const s = termStatus(cal, date);
  return s.phase === "teaching" && !s.holiday;
}

/**
 * A sensible default date for Preview mode: today if classes run today, otherwise the same weekday
 * in the closest teaching week (preferring the most recent one, so the timetable shown is one
 * that was actually published).
 */
export function representativeTeachingDate(cal: AcademicCalendar, today: string): string {
  if (isTeachingDay(cal, today) && isoWeekday(today) <= 5) return today;
  const weekday = Math.min(isoWeekday(today), 5);
  const sameWeekday = (date: string) => addDays(mondayOf(date), weekday - 1);
  for (let back = 0; back <= 60; back++) {
    for (const sign of [-1, 1]) {
      if (back === 0 && sign === 1) continue;
      const candidate = sameWeekday(addDays(today, sign * back * 7));
      if (isTeachingDay(cal, candidate)) return candidate;
    }
  }
  // No teaching day within about a year either side: fall back to the first day of the latest term.
  const latest = [...cal.terms].sort((a, b) => b.start.localeCompare(a.start))[0];
  return latest ? latest.start : today;
}

/** The next date on or after `date` on which classes run, or undefined if the calendar ends first. */
export function nextTeachingDay(cal: AcademicCalendar, date: string): string | undefined {
  const lastEnd = cal.terms.reduce((m, t) => (t.lecturesEnd > m ? t.lecturesEnd : m), "");
  for (let d = date; d <= lastEnd; d = addDays(d, 1)) {
    if (isTeachingDay(cal, d) && isoWeekday(d) <= 5) return d;
  }
  return undefined;
}

export function daysUntil(from: string, to: string): number {
  return daysBetween(from, to);
}
