import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSchedule, parseDate, parseDays, parseTime, type RawClass } from "../scripts/lib/classes.ts";
import { decodeRing, pointInRing, shareInside } from "../src/shared/geo.ts";
import { buildIndex, compact, fold, search } from "../src/shared/search.ts";
import type { CampusData, ContextData, FloorPlans, Meta, RoomIndex, Schedule, Subject } from "../src/shared/types.ts";

const read = <T>(name: string) => JSON.parse(fs.readFileSync(`public/data/${name}`, "utf8")) as T;
const campus = read<CampusData>("campus.json");
const roomIndex = read<RoomIndex>("rooms-index.json");
const subjects = read<Subject[]>("subjects.json");

describe("text folding", () => {
  it("ignores macrons, case and punctuation", () => {
    expect(fold("Māori Studies")).toBe("maori studies");
    expect(fold("Te Pūtahi Tangata")).toBe("te putahi tangata");
    expect(fold("Waipārūrū Hall")).toBe("waiparuru hall");
    expect(fold("  O'Rorke   Hall ")).toBe("ororke hall");
    expect(compact("COMPSCI 101")).toBe("compsci101");
    expect(compact("303-G23")).toBe("303g23");
  });
});

describe("search over the published data", () => {
  type Item = { type: "building" | "room" | "subject"; id: string };
  const index = buildIndex<Item>([
    ...campus.buildings.map((b) => ({
      item: { type: "building" as const, id: b.id },
      code: b.id,
      text: [b.name.en, b.sourceText],
      boost: 5,
    })),
    ...campus.rooms.map((r) => ({ item: { type: "room" as const, id: r.code }, code: r.code, text: [r.name.en] })),
    ...subjects.map((s) => ({ item: { type: "subject" as const, id: s.code }, code: s.code, text: [s.name.en] })),
  ]);
  const top = (q: string) => search(index, q, 5).map((h) => `${h.item.type}:${h.item.id}`);

  it("finds a room by code however it is typed", () => {
    expect(top("303-G23")[0]).toBe("room:303-G23");
    expect(top("303 g23")[0]).toBe("room:303-G23");
    expect(top("303g23")[0]).toBe("room:303-G23");
    expect(top("260-098")[0]).toBe("room:260-098");
  });
  it("finds a building by number or by name", () => {
    expect(top("303")[0]).toBe("building:303");
    expect(top("general library")[0]).toBe("building:109");
    expect(top("OGGB")[0]).toBe("building:260");
    expect(top("clock tower")).toContain("building:105");
  });
  it("matches Māori names typed without macrons", () => {
    expect(top("Te Putahi Tangata")[0]).toBe("building:201");
    expect(top("waiparuru")).toContain("building:441");
    expect(top("maori")).toContain("subject:MĀORI");
  });
  it("finds a subject by code or name", () => {
    expect(top("COMPSCI")[0]).toBe("subject:COMPSCI");
    expect(top("computer science")).toContain("subject:COMPSCI");
  });
  it("returns nothing for nonsense", () => {
    expect(top("zzzzqqq")).toEqual([]);
    expect(top("   ")).toEqual([]);
  });
});

describe("published campus data is self-consistent", () => {
  const buildings = new Map(campus.buildings.map((b) => [b.id, b]));

  it("has the expected scale", () => {
    expect(campus.buildings.length).toBeGreaterThan(150);
    expect(campus.rooms.length).toBeGreaterThan(600);
    expect(campus.campuses.find((c) => c.id === "city")?.onMap).toBe(true);
  });
  it("every room points at an existing building and floor, and its label point is inside its outline", () => {
    for (const r of campus.rooms) {
      const b = buildings.get(r.b);
      expect(b, r.code).toBeDefined();
      expect(b!.floors.some((f) => f.i === r.f), r.code).toBe(true);
      expect(r.code.startsWith(`${r.b}-`), r.code).toBe(true);
      expect(pointInRing(r.c, decodeRing(r.poly)), r.code).toBe(true);
    }
  });
  it("every floor outline lies over its own building's footprint", () => {
    for (const b of campus.buildings) {
      const footprint = decodeRing(b.outline[0]!);
      for (const f of b.floors) {
        if (!f.outline) continue;
        const polys = f.outline.map((poly) => poly.map((r) => decodeRing(r)));
        expect(shareInside(polys, footprint), `${b.id} floor ${f.name}`).toBeGreaterThan(0.2);
      }
    }
  });
  it("room codes are unique across the published rooms and the index", () => {
    const seen = new Set<string>();
    for (const r of campus.rooms) {
      expect(seen.has(r.code), r.code).toBe(false);
      seen.add(r.code);
    }
    for (const [bid, list] of Object.entries(roomIndex)) {
      expect(buildings.has(bid), bid).toBe(true);
      for (const [part] of list) {
        const code = `${bid}-${part}`;
        expect(seen.has(code), code).toBe(false);
        seen.add(code);
      }
    }
  });
  it("on-map buildings sit within a couple of kilometres of the origin", () => {
    for (const b of campus.buildings) {
      if (b.offMap) continue;
      expect(Math.abs(b.center[0]), b.id).toBeLessThan(1200);
      expect(Math.abs(b.center[1]), b.id).toBeLessThan(2200);
      expect(b.height, b.id).toBeGreaterThan(0);
      expect(b.height, b.id).toBeLessThan(90);
    }
  });
  it("does not publish residential rooms or people's names", () => {
    for (const r of campus.rooms) expect(r.sourceType).not.toMatch(/Residential|Accom/i);
    const text = JSON.stringify(campus) + JSON.stringify(read<Schedule>("schedule.json"));
    expect(text).not.toMatch(/instructor|lecturer|coordinator/i);
  });
  it("context data carries the OpenStreetMap attribution", () => {
    const ctx = read<ContextData>("context.json");
    expect(ctx.attribution).toMatch(/OpenStreetMap contributors/);
    expect(ctx.buildings.length).toBeGreaterThan(1000);
    expect(Math.max(...ctx.buildings.map((b) => b.h))).toBeLessThanOrEqual(200);
  });
  it("meta lists every source with a link and a snapshot date", () => {
    const meta = read<Meta>("meta.json");
    for (const s of meta.sources) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(meta.coverage.rooms).toBe(campus.rooms.length);
  });
  it("ships no timetable sessions unless a real snapshot produced them", () => {
    const schedule = read<Schedule>("schedule.json");
    if (!schedule.available) {
      expect(schedule.sessions).toEqual([]);
      expect(schedule.courses).toEqual([]);
    } else {
      expect(schedule.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const s of schedule.sessions) expect(s.sourceText.length).toBeGreaterThan(0);
    }
  });
});

describe("published floor plans", () => {
  const files = fs.readdirSync("public/data/plans");
  const plans = files.map((f) => JSON.parse(fs.readFileSync(`public/data/plans/${f}`, "utf8")) as FloorPlans);
  const buildings = new Map(campus.buildings.map((b) => [b.id, b]));

  it("have one file for each building that counts plan shapes, and the counts agree", () => {
    expect(files.sort()).toEqual(campus.buildings.filter((b) => b.planShapes).map((b) => `${b.id}.json`).sort());
    let total = 0;
    for (const plan of plans) {
      const b = buildings.get(plan.building)!;
      expect(b.offMap, b.id).toBeUndefined();
      const count = Object.values(plan.floors).reduce((n, shapes) => n + shapes.length, 0);
      expect(count, b.id).toBe(b.planShapes);
      for (const i of Object.keys(plan.floors)) expect(b.floors.some((f) => f.i === Number(i)), `${b.id} floor ${i}`).toBe(true);
      total += count;
    }
    expect(total).toBe(read<Meta>("meta.json").coverage.planShapes);
    expect(total).toBeGreaterThan(10_000);
  });
  it("carry shapes and nothing that names them: no code, no name, no type", () => {
    for (const plan of plans) {
      expect(Object.keys(plan).sort(), plan.building).toEqual(["building", "floors", "version"]);
      for (const shapes of Object.values(plan.floors)) {
        for (const rings of shapes) {
          expect(rings[0]!.length, plan.building).toBeGreaterThanOrEqual(6);
          for (const ring of rings) expect(ring.every(Number.isInteger), plan.building).toBe(true);
        }
      }
    }
  });
  it("leave every floor where people live blank", () => {
    const residential = campus.buildings.flatMap((b) => b.floors.filter((f) => f.residential).map((f) => [b.id, f.i] as const));
    expect(residential.length).toBeGreaterThan(100);
    const byBuilding = new Map(plans.map((p) => [p.building, p]));
    for (const [id, i] of residential) expect(byBuilding.get(id)?.floors[i], `${id} floor ${i}`).toBeUndefined();
  });
  it("never lay a shape over a named room", () => {
    const byBuilding = new Map(plans.map((p) => [p.building, p]));
    for (const r of campus.rooms) {
      for (const rings of byBuilding.get(r.b)?.floors[r.f] ?? []) {
        const covered = pointInRing(r.c, decodeRing(rings[0]!)) && !rings.slice(1).some((hole) => pointInRing(r.c, decodeRing(hole)));
        expect(covered, r.code).toBe(false);
      }
    }
  });
});

describe("Classes API records -> schedule (synthetic fixture, shaped like the published OpenAPI schema)", () => {
  // These records are invented for the test and are never written to public/data.
  const fixture: RawClass[] = [
    {
      subject: "TESTSUBJ",
      catalogNbr: "101",
      classDescr: "Fixture Course",
      classSection: "L01C",
      component: "LEC",
      term: "1265",
      meetingPatterns: [
        { startDate: "2026-07-20", endDate: "2026-08-28", startTime: "10:00:00", endTime: "11:00:00", daysOfWeek: "mon,wed", location: "303-G23" },
        { startDate: "2026-09-14", endDate: "2026-10-23", startTime: "10:00:00", endTime: "11:00:00", daysOfWeek: "mon,wed", location: "303-G23" },
      ],
    },
    {
      subject: "TESTSUBJ",
      catalogNbr: "101",
      classDescr: "Fixture Course",
      classSection: "T01C",
      component: "TUT",
      term: "1265",
      meetingPatterns: [
        { startDate: "2026-07-20", endDate: "2026-10-23", startTime: "14:00", endTime: "15:00", daysOfWeek: "Fri", location: "104-G53" },
        { startDate: "2026-07-20", endDate: "2026-10-23", startTime: "15:00", endTime: "16:00", daysOfWeek: "Fri", location: "303-999" },
        { startDate: "2026-07-20", endDate: "2026-10-23", startTime: "16:00", endTime: "17:00", daysOfWeek: "Fri", location: "Online" },
        { startDate: "2026-07-20", endDate: "2026-10-23", startTime: "", endTime: "", daysOfWeek: "Fri", location: "303-G23" },
        { startDate: "2026-07-20", endDate: "2026-10-23", startTime: "09:00", endTime: "10:00", daysOfWeek: "Fri", location: "" },
      ],
    },
    { subject: "TESTSUBJ", catalogNbr: "102", classDescr: "No Times", term: "1265", meetingPatterns: [] },
    { subject: "TESTSUBJ", catalogNbr: "103", classDescr: "Cancelled", term: "1265", classStatus: "X", meetingPatterns: [{ daysOfWeek: "mon" }] },
  ];
  const { schedule } = buildSchedule(fixture, campus, roomIndex, "2026-10-13");

  it("expands meeting patterns into one session per weekday and keeps the source text", () => {
    const lec = schedule.sessions.filter((s) => s.component === "LEC");
    expect(lec).toHaveLength(4);
    expect(lec.map((s) => s.day).sort()).toEqual([1, 1, 3, 3]);
    expect(lec[0]).toMatchObject({ start: 600, end: 660, room: "303-G23", building: "303", precision: "room", sourceText: "303-G23" });
    expect(schedule.courses).toEqual([{ code: "TESTSUBJ 101", subject: "TESTSUBJ", catalogNbr: "101", title: { en: "Fixture Course" } }]);
  });
  it("grades how precisely each session is located", () => {
    const byText = (t: string) => schedule.sessions.find((s) => s.sourceText === t)!;
    // Known to the campus map without a published outline: still room precision, floor from the map.
    expect(byText("104-G53")).toMatchObject({ precision: "room", building: "104" });
    // Unknown room in a known building: floor inferred from the number and flagged as such.
    expect(byText("303-999")).toMatchObject({ precision: "floor", building: "303", floorInferred: true });
  });
  it("records what it could not use, with reasons, instead of dropping it silently", () => {
    const reasons = schedule.exclusions.map((e) => e.reason);
    expect(reasons.some((r) => r.includes("not a room code"))).toBe(true);
    expect(reasons.some((r) => r.includes("time not recognised"))).toBe(true);
    expect(reasons.some((r) => r.includes("no location"))).toBe(true);
    expect(reasons.some((r) => r.includes("no meeting pattern"))).toBe(true);
    expect(reasons.some((r) => r.includes("cancelled"))).toBe(true);
    expect(schedule.sessions.length + schedule.exclusions.length).toBe(4 + 2 + 5);
  });
  it("parses the field formats it might meet", () => {
    expect(parseDays("MoWeFr")).toEqual([1, 3, 5]);
    expect(parseDays("TUE THU")).toEqual([2, 4]);
    expect(parseDays("sun")).toEqual([7]);
    expect(parseDays("")).toEqual([]);
    expect(parseDate("2026-07-20T00:00:00+12:00")).toBe("2026-07-20");
    expect(parseDate("20/07/2026")).toBe("2026-07-20");
    expect(parseDate("soon")).toBeNull();
    expect(parseTime("10:00:00")).toBe(600);
    expect(parseTime("2026-07-20T14:30:00")).toBe(870);
    expect(parseTime("")).toBeNull();
  });
});
