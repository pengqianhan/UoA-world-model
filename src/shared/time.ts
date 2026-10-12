// Wall-clock time in Pacific/Auckland, independent of the viewer's own time zone.
//
// Dates are ISO strings ("2026-10-13"), times of day are minutes after local midnight.
// Date arithmetic is done on calendar dates (UTC noon anchors), never by adding
// 24-hour blocks to instants, so daylight-saving changes cannot shift a date.

export const AUCKLAND = "Pacific/Auckland";

export interface WallTime {
  /** ISO calendar date in Auckland. */
  date: string;
  /** Minutes after local midnight. */
  minutes: number;
  /** ISO weekday: 1 = Monday .. 7 = Sunday. */
  weekday: number;
}

const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: AUCKLAND,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function wallParts(instant: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const out: Record<string, number> = {};
  for (const p of partsFormat.formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year!, mo: out.month!, d: out.day!, h: out.hour! % 24, mi: out.minute!, s: out.second! };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function isoDate(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function parseIsoDate(date: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** ISO weekday (1 = Monday .. 7 = Sunday) of a calendar date. */
export function isoWeekday(date: string): number {
  const p = parseIsoDate(date);
  if (!p) throw new Error(`bad date: ${date}`);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function addDays(date: string, days: number): string {
  const p = parseIsoDate(date);
  if (!p) throw new Error(`bad date: ${date}`);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseIsoDate(a);
  const pb = parseIsoDate(b);
  if (!pa || !pb) throw new Error(`bad date: ${a} / ${b}`);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/** Monday of the week containing the date. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** The Auckland wall-clock reading of an instant. */
export function aucklandWallTime(instant: Date = new Date()): WallTime {
  const p = wallParts(instant);
  const date = isoDate(p.y, p.mo, p.d);
  return { date, minutes: p.h * 60 + p.mi, weekday: isoWeekday(date) };
}

/** Auckland's offset from UTC at an instant, in minutes (+720 in winter, +780 during daylight saving). */
export function aucklandOffsetMinutes(instant: Date): number {
  const p = wallParts(instant);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/**
 * The instant at which Auckland clocks show the given date and time.
 * A time skipped by the spring-forward change (02:00-02:59 on the last Sunday of September)
 * is shifted forward by the skipped hour, as most date libraries do (02:30 becomes 03:30).
 * A time repeated by the autumn change maps to its first occurrence.
 */
export function aucklandInstant(date: string, minutes: number): Date {
  const p = parseIsoDate(date);
  if (!p) throw new Error(`bad date: ${date}`);
  const naive = Date.UTC(p.y, p.m - 1, p.d, 0, minutes);
  // Try both possible offsets; keep the earliest instant whose wall time matches.
  const candidates = [780, 720].map((off) => new Date(naive - off * 60000));
  for (const c of candidates) {
    const w = aucklandWallTime(c);
    if (w.date === date && w.minutes === minutes) return c;
  }
  // Skipped time: apply the offset in force just before the gap, which lands one hour later on the clock.
  return new Date(naive - aucklandOffsetMinutes(new Date(naive - 780 * 60000 - 3600000)) * 60000);
}

export function formatMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Parses "9:05", "09:05", "0905", "09:05:00". */
export function parseTimeOfDay(text: string): number | null {
  const m = /^\s*(\d{1,2})[:.]?(\d{2})(?::\d{2})?\s*$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return null;
  return h * 60 + mi;
}

export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export function weekdayKey(isoDay: number): WeekdayKey {
  return WEEKDAY_KEYS[isoDay - 1] ?? "mon";
}

export function weekdayFromKey(key: string): number | null {
  const i = WEEKDAY_KEYS.indexOf(key.toLowerCase().slice(0, 3) as WeekdayKey);
  return i < 0 ? null : i + 1;
}
