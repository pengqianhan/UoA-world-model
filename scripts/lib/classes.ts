// Turns raw Classes API records into the published timetable (public/data/schedule.json).
//
// The record shape follows the University's published OpenAPI document for "Classes Api V2"
// (developer.auckland.ac.nz/prd/documentation/api-classes-v2): a class has `meetingPatterns`,
// each with startDate, endDate, startTime, endTime, daysOfWeek and location. The exact text
// formats of those fields are not documented, so every parser here is tolerant, the original
// location text is always kept, and anything that cannot be understood goes to `exclusions`
// with a reason instead of being dropped or guessed.
//
// Teacher names are never read or published.
import fs from "node:fs";
import path from "node:path";
import { codeKey, findRoomCode, inferFloor } from "../../src/shared/roomcode.ts";
import { isoDate, parseIsoDate, parseTimeOfDay } from "../../src/shared/time.ts";
import type { CampusData, Course, Exclusion, RoomIndex, Schedule, Session } from "../../src/shared/types.ts";
import { RAW_DIR } from "./snapshot.ts";

export interface RawMeetingPattern {
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  daysOfWeek?: string | null;
  meetingNumber?: number | null;
}

export interface RawClass {
  subject?: string | null;
  catalogNbr?: string | null;
  classDescr?: string | null;
  classSection?: string | null;
  component?: string | null;
  classStatus?: string | null;
  status?: string | null;
  campus?: string | null;
  term?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  meetingPatterns?: RawMeetingPattern[] | null;
}

/** Reads every page saved by scripts/fetch-classes.ts. Returns [] when there is no snapshot. */
export function loadClassSnapshots(): RawClass[] {
  const dir = path.join(RAW_DIR, "uoa-classes");
  if (!fs.existsSync(dir)) return [];
  const out: RawClass[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const page = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { data?: RawClass[] } | RawClass[];
    const rows = Array.isArray(page) ? page : (page.data ?? []);
    out.push(...rows);
  }
  return out;
}

const DAY_TOKENS: Record<string, number> = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 7 };

/** "mon", "Mon,Wed", "MoWeFr", "TUE THU" -> ISO weekdays. */
export function parseDays(text: string): number[] {
  const out = new Set<number>();
  const re = /(mon|tue|wed|thu|fri|sat|sun|mo|tu|we|th|fr|sa|su)/g;
  const t = text.toLowerCase();
  for (let m = re.exec(t); m; m = re.exec(t)) out.add(DAY_TOKENS[m[1]!.slice(0, 2)]!);
  return [...out].sort((a, b) => a - b);
}

/** Accepts "2026-07-20", "2026-07-20T00:00:00+12:00" and "20/07/2026". */
export function parseDate(text: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.trim());
  if (iso) {
    const d = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return parseIsoDate(d) ? d : null;
  }
  const nz = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (nz) {
    const d = isoDate(Number(nz[3]), Number(nz[2]), Number(nz[1]));
    return parseIsoDate(d) ? d : null;
  }
  return null;
}

/** Accepts "10:00:00", "10:00", "1000", "10.00" and ISO date-times. */
export function parseTime(text: string): number | null {
  const t = text.trim();
  const isoTime = /T(\d{2}:\d{2})/.exec(t);
  return parseTimeOfDay(isoTime ? isoTime[1]! : t);
}

export interface ScheduleStats {
  "schedule.classes": number;
  "schedule.meetingPatterns": number;
  [key: string]: number;
}

export function buildSchedule(
  classes: readonly RawClass[],
  campus: CampusData,
  roomIndex: RoomIndex,
  snapshotDate: string,
): { schedule: Schedule; stats: ScheduleStats } {
  const stats: ScheduleStats = { "schedule.classes": classes.length, "schedule.meetingPatterns": 0 };
  const buildings = new Map(campus.buildings.map((b) => [b.id, b]));
  const buildingIds = new Set(buildings.keys());
  // Keyed without zero padding so "114-G10" on a timetable finds "114-G010" on the map.
  const rooms = new Map(campus.rooms.map((r) => [codeKey(r.code), r]));
  const indexed = new Map<string, { code: string; floor: number }>();
  for (const [bid, list] of Object.entries(roomIndex)) {
    for (const [part, floor] of list) indexed.set(codeKey(`${bid}-${part}`), { code: `${bid}-${part}`, floor });
  }

  const courses: Course[] = [];
  const courseIndex = new Map<string, number>();
  const sessions: Session[] = [];
  const exclusions: Exclusion[] = [];
  const terms = new Set<string>();
  const seen = new Set<string>();

  for (const c of classes) {
    const subject = (c.subject ?? "").trim().toUpperCase();
    const catalogNbr = (c.catalogNbr ?? "").trim().toUpperCase();
    if (!subject || !catalogNbr) continue;
    const code = `${subject} ${catalogNbr}`;
    const term = (c.term ?? "").trim();
    const exclude = (sourceText: string, reason: string) => exclusions.push({ course: code, term, sourceText, reason });

    const status = (c.classStatus ?? c.status ?? "").trim().toUpperCase();
    if (status === "X" || status === "CANCELLED" || status === "CANCELED") {
      exclude("", "class is cancelled");
      continue;
    }
    const patterns = c.meetingPatterns ?? [];
    if (!patterns.length) {
      exclude("", "no meeting pattern (no scheduled time)");
      continue;
    }

    let ci = courseIndex.get(code);
    if (ci === undefined) {
      ci = courses.length;
      courseIndex.set(code, ci);
      courses.push({ code, subject, catalogNbr, title: { en: (c.classDescr ?? "").trim() || code } });
    }
    if (term) terms.add(term);

    for (const mp of patterns) {
      stats["schedule.meetingPatterns"]++;
      const sourceText = (mp.location ?? "").trim();
      const days = parseDays(mp.daysOfWeek ?? "");
      const start = parseTime(mp.startTime ?? "");
      const end = parseTime(mp.endTime ?? "");
      const startDate = parseDate(mp.startDate ?? c.startDate ?? "");
      const endDate = parseDate(mp.endDate ?? c.endDate ?? "");
      if (!days.length) {
        exclude(sourceText, `day of week not recognised: "${mp.daysOfWeek ?? ""}"`);
        continue;
      }
      if (start === null || end === null || end <= start) {
        exclude(sourceText, `time not recognised: "${mp.startTime ?? ""}" to "${mp.endTime ?? ""}"`);
        continue;
      }
      if (!startDate || !endDate || endDate < startDate) {
        exclude(sourceText, `date range not recognised: "${mp.startDate ?? ""}" to "${mp.endDate ?? ""}"`);
        continue;
      }
      if (!sourceText) {
        exclude(sourceText, "no location given (possibly online or to be advised)");
        continue;
      }
      const parsed = findRoomCode(sourceText, buildingIds);
      const building = parsed ? buildings.get(parsed.building) : undefined;
      if (!parsed || !building) {
        exclude(sourceText, "location is not a room code in a known building");
        continue;
      }

      const located: Pick<Session, "room" | "building" | "floor" | "campus" | "precision" | "floorInferred"> = {
        room: parsed.code,
        building: building.id,
        campus: building.campus,
        precision: "building",
      };
      const known = rooms.get(codeKey(parsed.code));
      const inIndex = indexed.get(codeKey(parsed.code));
      if (known) {
        located.room = known.code;
        located.floor = known.f;
        located.precision = "room";
      } else if (inIndex) {
        located.room = inIndex.code;
        located.floor = inIndex.floor;
        located.precision = "room";
      } else {
        const floor = inferFloor(building.floors, parsed.room);
        if (floor) {
          located.floor = floor.i;
          located.precision = "floor";
          located.floorInferred = true;
        }
      }

      for (const day of days) {
        const s: Session = {
          course: ci,
          term,
          component: (c.component ?? "").trim().toUpperCase(),
          section: (c.classSection ?? "").trim(),
          day,
          start,
          end,
          startDate,
          endDate,
          sourceText,
          ...located,
        };
        const key = [ci, s.term, s.component, s.section, day, start, end, startDate, endDate, s.room].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        sessions.push(s);
      }
    }
  }

  sessions.sort((a, b) => a.day - b.day || a.start - b.start || a.course - b.course);
  return {
    schedule: {
      version: 1,
      generatedAt: new Date().toISOString(),
      available: sessions.length > 0,
      snapshotDate: sessions.length > 0 ? snapshotDate : undefined,
      terms: [...terms].sort(),
      courses,
      sessions,
      exclusions,
    },
    stats,
  };
}
