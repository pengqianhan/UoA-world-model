import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { isTeachingDay, nextTeachingDay, representativeTeachingDate, teachingWeek, termStatus } from "../src/shared/calendar.ts";
import { nextSession, runsAt, runsOnDate, sessionsAt, sessionsOnDate } from "../src/shared/schedule.ts";
import { isoWeekday } from "../src/shared/time.ts";
import type { AcademicCalendar, Session } from "../src/shared/types.ts";

const cal = JSON.parse(fs.readFileSync("data/academic-calendar.json", "utf8")) as AcademicCalendar;
const s2 = cal.terms.find((t) => t.code === "1265")!;

describe("the transcribed 2026 calendar is internally consistent", () => {
  it("terms start on the weekday the official PDF prints (except the one noted misprint)", () => {
    for (const t of cal.terms) {
      if (t.code === "1267") continue; // PDF says "Monday 1 December"; that date is a Tuesday.
      expect(isoWeekday(t.start), t.name.en).toBe(1);
      expect(t.start <= t.lecturesEnd && t.lecturesEnd <= t.end, t.name.en).toBe(true);
    }
    expect(isoWeekday("2026-12-01")).toBe(2);
  });
  it("lectures end on a Friday and holidays fall on the printed weekdays", () => {
    expect(isoWeekday(s2.lecturesEnd)).toBe(5);
    expect(isoWeekday("2026-10-26")).toBe(1); // Labour Day, Monday
    expect(isoWeekday("2026-07-10")).toBe(5); // Matariki, Friday
    expect(isoWeekday("2026-06-01")).toBe(1); // King's Birthday, Monday
  });
});

describe("termStatus", () => {
  it("places today's snapshot date in Semester Two, teaching week 11", () => {
    const s = termStatus(cal, "2026-10-13");
    expect(s.phase).toBe("teaching");
    expect(s.term?.code).toBe("1265");
    expect(s.week).toBe(11);
  });
  it("numbers teaching weeks across the mid-semester break", () => {
    expect(teachingWeek(s2, "2026-07-20")).toBe(1);
    expect(teachingWeek(s2, "2026-08-28")).toBe(6);
    expect(teachingWeek(s2, "2026-09-02")).toBeUndefined();
    expect(teachingWeek(s2, "2026-09-14")).toBe(7);
    expect(teachingWeek(s2, "2026-10-23")).toBe(12);
  });
  it("recognises breaks, study break, exams and the gap between semesters", () => {
    expect(termStatus(cal, "2026-09-01").phase).toBe("break");
    expect(termStatus(cal, "2026-10-27").phase).toBe("studyBreak");
    expect(termStatus(cal, "2026-11-02").phase).toBe("exams");
    expect(termStatus(cal, "2026-07-01").phase).toBe("betweenTerms");
    expect(termStatus(cal, "2026-06-30").phase).toBe("betweenTerms");
  });
  it("flags holidays and weekends", () => {
    const labour = termStatus(cal, "2026-10-26");
    expect(labour.holiday?.en).toBe("Labour Day");
    expect(labour.phase).not.toBe("teaching");
    expect(termStatus(cal, "2026-06-01").holiday?.en).toBe("King's Birthday");
    expect(isTeachingDay(cal, "2026-06-01")).toBe(false);
    expect(termStatus(cal, "2026-10-17").weekend).toBe(true);
  });
  it("prefers semesters over the quarters that overlap them", () => {
    expect(termStatus(cal, "2026-10-13").term?.kind).toBe("semester");
    expect(termStatus(cal, "2026-07-08").term?.kind).toBe("quarter");
  });
});

describe("default preview date", () => {
  it("is today on a teaching weekday", () => {
    expect(representativeTeachingDate(cal, "2026-10-13")).toBe("2026-10-13");
  });
  it("falls back to the same weekday in the most recent teaching week", () => {
    // Exam period, Tuesday -> the last teaching Tuesday.
    expect(representativeTeachingDate(cal, "2026-11-03")).toBe("2026-10-20");
    // Saturday in term -> Friday of that week.
    expect(representativeTeachingDate(cal, "2026-10-17")).toBe("2026-10-16");
    // Labour Day Monday -> the Monday before.
    expect(representativeTeachingDate(cal, "2026-10-26")).toBe("2026-10-19");
  });
  it("finds the next teaching day", () => {
    expect(nextTeachingDay(cal, "2026-08-29")).toBe("2026-09-14");
    expect(nextTeachingDay(cal, "2026-10-13")).toBe("2026-10-13");
  });
});

// Synthetic sessions used only to exercise the time logic. They are test fixtures, never published.
const base: Session = {
  course: 0,
  term: "1265",
  component: "LEC",
  section: "L01C",
  day: 2,
  start: 600,
  end: 660,
  startDate: "2026-07-20",
  endDate: "2026-10-23",
  sourceText: "TEST-FIXTURE",
  precision: "none",
};

describe("which sessions run when", () => {
  it("matches weekday, date range and time, with an exclusive end", () => {
    expect(runsAt(base, "2026-10-13", 600, cal)).toBe(true);
    expect(runsAt(base, "2026-10-13", 659, cal)).toBe(true);
    expect(runsAt(base, "2026-10-13", 660, cal)).toBe(false);
    expect(runsAt(base, "2026-10-13", 599, cal)).toBe(false);
    expect(runsAt(base, "2026-10-14", 600, cal)).toBe(false);
    expect(runsAt(base, "2026-07-14", 600, cal)).toBe(false);
    expect(runsAt(base, "2026-10-27", 600, cal)).toBe(false);
  });
  it("does not run during the mid-semester break even if the date range spans it", () => {
    expect(runsOnDate(base, "2026-09-01", cal)).toBe(false);
    expect(runsOnDate(base, "2026-09-08", cal)).toBe(false);
    expect(runsOnDate(base, "2026-09-15", cal)).toBe(true);
    // Without a calendar the raw pattern is used as-is.
    expect(runsOnDate(base, "2026-09-01")).toBe(true);
  });
  it("does not run on public holidays", () => {
    const monday: Session = { ...base, day: 1, startDate: "2026-03-02", endDate: "2026-06-05", term: "1263" };
    expect(runsOnDate(monday, "2026-06-01", cal)).toBe(false); // King's Birthday
    expect(runsOnDate(monday, "2026-05-25", cal)).toBe(true);
    expect(runsOnDate(monday, "2026-04-27", cal)).toBe(false); // ANZAC Day
  });
  it("runs at the same wall-clock time on both sides of the September clock change", () => {
    expect(runsAt(base, "2026-09-22", 630, cal)).toBe(true);
    expect(runsAt(base, "2026-09-29", 630, cal)).toBe(true);
    const sunday: Session = { ...base, day: 7, start: 120, end: 240 };
    // 27 Sep is a Sunday inside term; the 02:00-03:00 hour does not exist but the pattern still matches by wall time.
    expect(runsOnDate(sunday, "2026-09-27", cal)).toBe(true);
  });
  it("lists and orders sessions", () => {
    const later: Session = { ...base, start: 840, end: 900 };
    const list = [later, base];
    expect(sessionsAt(list, "2026-10-13", 845, cal)).toEqual([later]);
    expect(sessionsOnDate(list, "2026-10-13", cal)).toEqual([base, later]);
    expect(nextSession(list, "2026-10-13", 700, cal)).toEqual(later);
    expect(nextSession(list, "2026-10-13", 900, cal)).toBeUndefined();
  });
});
