import { describe, expect, it } from "vitest";
import {
  addDays,
  aucklandInstant,
  aucklandOffsetMinutes,
  aucklandWallTime,
  daysBetween,
  formatMinutes,
  isoWeekday,
  mondayOf,
  parseIsoDate,
  parseTimeOfDay,
  weekdayFromKey,
} from "../src/shared/time.ts";

describe("Auckland wall time", () => {
  it("is UTC+13 in summer and UTC+12 in winter", () => {
    expect(aucklandOffsetMinutes(new Date("2026-01-15T00:00:00Z"))).toBe(780);
    expect(aucklandOffsetMinutes(new Date("2026-07-15T00:00:00Z"))).toBe(720);
  });

  it("converts instants to the local date, time and weekday", () => {
    // 11:30 UTC on Mon 12 Oct 2026 is 00:30 on Tue 13 Oct in Auckland (NZDT).
    expect(aucklandWallTime(new Date("2026-10-12T11:30:00Z"))).toEqual({ date: "2026-10-13", minutes: 30, weekday: 2 });
    // Winter: 22:15 UTC on Sun 19 Jul is 10:15 on Mon 20 Jul (NZST), the first day of Semester Two.
    expect(aucklandWallTime(new Date("2026-07-19T22:15:00Z"))).toEqual({ date: "2026-07-20", minutes: 615, weekday: 1 });
  });

  it("round-trips ordinary times", () => {
    for (const [date, minutes] of [
      ["2026-03-02", 9 * 60],
      ["2026-07-20", 10 * 60 + 5],
      ["2026-10-13", 23 * 60 + 59],
      ["2026-12-31", 0],
    ] as const) {
      const w = aucklandWallTime(aucklandInstant(date, minutes));
      expect(w.date).toBe(date);
      expect(w.minutes).toBe(minutes);
    }
  });
});

describe("daylight saving changes", () => {
  // Daylight saving ends Sunday 5 April 2026 (03:00 NZDT -> 02:00 NZST)
  // and starts Sunday 27 September 2026 (02:00 NZST -> 03:00 NZDT), in the middle of Semester Two.
  it("switches offset on the right days in 2026", () => {
    expect(aucklandOffsetMinutes(aucklandInstant("2026-04-04", 12 * 60))).toBe(780);
    expect(aucklandOffsetMinutes(aucklandInstant("2026-04-05", 12 * 60))).toBe(720);
    expect(aucklandOffsetMinutes(aucklandInstant("2026-09-26", 12 * 60))).toBe(720);
    expect(aucklandOffsetMinutes(aucklandInstant("2026-09-27", 12 * 60))).toBe(780);
  });

  it("keeps a 10:00 class at 10:00 on both sides of the September change", () => {
    const before = aucklandInstant("2026-09-25", 600);
    const after = aucklandInstant("2026-09-28", 600);
    expect(aucklandWallTime(before).minutes).toBe(600);
    expect(aucklandWallTime(after).minutes).toBe(600);
    // Three calendar days apart, but only 71 hours of elapsed time because an hour was skipped.
    expect((after.getTime() - before.getTime()) / 3600000).toBe(71);
  });

  it("the spring-forward day has 23 hours and the autumn day has 25", () => {
    const len = (d: string) => (aucklandInstant(addDays(d, 1), 0).getTime() - aucklandInstant(d, 0).getTime()) / 3600000;
    expect(len("2026-09-27")).toBe(23);
    expect(len("2026-04-05")).toBe(25);
    expect(len("2026-10-13")).toBe(24);
  });

  it("shifts a time inside the skipped hour forward by that hour", () => {
    const shifted = aucklandInstant("2026-09-27", 2 * 60 + 30);
    expect(aucklandWallTime(shifted)).toEqual({ date: "2026-09-27", minutes: 210, weekday: 7 });
    expect(shifted.toISOString()).toBe("2026-09-26T14:30:00.000Z");
  });

  it("maps the repeated hour to its first occurrence", () => {
    const first = aucklandInstant("2026-04-05", 2 * 60 + 30);
    expect(aucklandWallTime(first).minutes).toBe(150);
    expect(aucklandOffsetMinutes(first)).toBe(780);
  });

  it("date arithmetic is unaffected by the changes", () => {
    expect(addDays("2026-09-26", 1)).toBe("2026-09-27");
    expect(addDays("2026-09-27", 1)).toBe("2026-09-28");
    expect(addDays("2026-04-04", 2)).toBe("2026-04-06");
    expect(daysBetween("2026-09-20", "2026-10-04")).toBe(14);
    expect(isoWeekday("2026-09-27")).toBe(7);
    expect(mondayOf("2026-09-27")).toBe("2026-09-21");
  });
});

describe("calendar helpers", () => {
  it("knows weekdays", () => {
    expect(isoWeekday("2026-10-13")).toBe(2);
    expect(isoWeekday("2026-07-20")).toBe(1);
    expect(isoWeekday("2026-10-25")).toBe(7);
  });
  it("validates dates", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2026-2-3")).toBeNull();
    expect(parseIsoDate("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 });
  });
  it("parses and formats times of day", () => {
    expect(parseTimeOfDay("9:05")).toBe(545);
    expect(parseTimeOfDay("09:05:00")).toBe(545);
    expect(parseTimeOfDay("1730")).toBe(1050);
    expect(parseTimeOfDay("25:00")).toBeNull();
    expect(parseTimeOfDay("noon")).toBeNull();
    expect(formatMinutes(545)).toBe("09:05");
    expect(formatMinutes(0)).toBe("00:00");
  });
  it("maps weekday keys", () => {
    expect(weekdayFromKey("tue")).toBe(2);
    expect(weekdayFromKey("Sunday")).toBe(7);
    expect(weekdayFromKey("xyz")).toBeNull();
  });
});
