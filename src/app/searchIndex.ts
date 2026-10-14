// What the search box can find, and how a query is turned into results.
import { codeKey, parseRoomCode } from "../shared/roomcode.ts";
import { buildIndex, compact, fold, search, type IndexedEntry, type SearchEntry } from "../shared/search.ts";
import type { Building, Campus, CatalogueData, Course, Room, Subject } from "../shared/types.ts";
import type { AppData } from "./data.ts";
import { resolveRoom, type Marker } from "./state.ts";

/** A course in the Curriculum Catalogue, with the terms and campuses it is offered in, in the catalogue's words. */
export interface CatalogueCourse {
  code: string;
  title: string;
  /** The catalogue year the terms are for. */
  year: number;
  terms: string[];
  campuses: CatalogueData["campuses"];
}

export type SearchItem =
  | { type: "building"; building: Building }
  | { type: "room"; room: Room }
  | { type: "marker"; marker: Marker }
  | { type: "course"; course: Course; index: number }
  | { type: "catalogue"; course: CatalogueCourse }
  | { type: "subject"; subject: Subject; asked?: string }
  | { type: "campus"; campus: Campus };

let cached: { data: AppData; catalogue?: CatalogueData; index: IndexedEntry<SearchItem>[]; subjects: Map<string, Subject> } | undefined;

/** The catalogue's courses, each spelled out from its bit masks. */
function catalogueCourses(c: CatalogueData): CatalogueCourse[] {
  const pick = <T>(list: T[], mask: number) => list.filter((_, bit) => mask & (1 << bit));
  return c.courses.map(([code, title, terms, campuses]) => ({ code, title, year: c.year, terms: pick(c.terms, terms), campuses: pick(c.campuses, campuses) }));
}

function indexFor(d: AppData, catalogue?: CatalogueData) {
  if (cached?.data === d && cached.catalogue === catalogue) return cached;
  const entries: SearchEntry<SearchItem>[] = [];
  for (const campus of d.campus.campuses) {
    entries.push({ item: { type: "campus", campus }, text: Object.values(campus.name), boost: 30 });
  }
  for (const building of d.campus.buildings) {
    entries.push({
      item: { type: "building", building },
      code: building.id,
      text: [...Object.values(building.name), building.sourceText],
      // Buildings outrank their own rooms for a bare number such as "303".
      boost: 40 + Math.min(20, building.roomCount),
    });
  }
  for (const room of d.campus.rooms) {
    entries.push({
      item: { type: "room", room },
      code: room.code,
      // The zero-padding-insensitive form lets "114-G10" find "114-G010".
      text: [...Object.values(room.name), codeKey(room.code)],
      boost: room.kind === "lectureTheatre" ? 6 : 0,
    });
  }
  d.schedule.courses.forEach((course, index) => {
    entries.push({ item: { type: "course", course, index }, code: course.code, text: Object.values(course.title), boost: 20 });
  });
  // The catalogue, for the courses the timetable does not already bring.
  if (catalogue) {
    const timetabled = new Set(d.schedule.courses.map((c) => c.code));
    for (const course of catalogueCourses(catalogue)) {
      if (!timetabled.has(course.code)) entries.push({ item: { type: "catalogue", course }, code: course.code, text: [course.title], boost: 18 });
    }
  }
  for (const subject of d.subjects) {
    entries.push({
      item: { type: "subject", subject },
      code: subject.code,
      text: [...Object.values(subject.name), ...Object.values(subject.faculty)],
      boost: 10,
    });
  }
  cached = { data: d, catalogue, index: buildIndex(entries), subjects: new Map(d.subjects.map((s) => [compact(s.code), s])) };
  return cached;
}

export interface SearchResults {
  items: SearchItem[];
  /** Set when the query looks like a room code that is not among the published rooms. */
  pendingRoom?: Promise<SearchItem | undefined>;
}

export function runSearch(d: AppData, query: string, limit = 40, catalogue?: CatalogueData): SearchResults {
  const { index, subjects } = indexFor(d, catalogue);
  const items = search(index, query, limit).map((h) => h.item);

  // "COMPSCI 101" when that course is neither timetabled nor in the catalogue: still say what the subject is.
  const course = /^([a-z]{2,10})\s*(\d{3}[a-z]{0,2})$/.exec(fold(query));
  if (course && !items.some((i) => (i.type === "course" || i.type === "catalogue") && compact(i.course.code) === compact(query))) {
    const subject = subjects.get(course[1]!);
    if (subject && !items.some((i) => i.type === "subject" && i.subject.code === subject.code)) {
      items.unshift({ type: "subject", subject, asked: `${subject.code} ${course[2]!.toUpperCase()}` });
    }
  }

  // A room code that has no published outline: resolve it against the campus map's room index.
  let pendingRoom: SearchResults["pendingRoom"];
  const parsed = parseRoomCode(query, d.buildingIds);
  if (parsed && d.buildingById.has(parsed.building) && !d.roomByKey.has(codeKey(parsed.code))) {
    pendingRoom = resolveRoom(query).then((r) => (r?.marker ? { type: "marker", marker: r.marker } : undefined));
  }
  return { items, pendingRoom };
}

/** Buildings to offer before anything is typed. */
export function browseBuildings(d: AppData, campus: string, limit = 12): Building[] {
  return d.campus.buildings
    .filter((b) => b.roomCount > 0 && !b.offMap && (b.campus === campus || !d.campusById.get(campus)?.onMap))
    .sort((a, b) => b.roomCount - a.roomCount)
    .slice(0, limit);
}
