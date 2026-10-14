// Loads the published JSON files and builds the lookup tables the app needs.
import { codeKey } from "../shared/roomcode.ts";
import type {
  AcademicCalendar,
  Building,
  Campus,
  CampusData,
  ContextData,
  FloorPlans,
  Meta,
  Room,
  RoomIndex,
  Schedule,
  Session,
  Subject,
} from "../shared/types.ts";

export interface AppData {
  campus: CampusData;
  calendar: AcademicCalendar;
  schedule: Schedule;
  subjects: Subject[];
  meta: Meta;
  campusById: Map<string, Campus>;
  buildingById: Map<string, Building>;
  buildingIds: Set<string>;
  roomByCode: Map<string, Room>;
  /** Rooms keyed without zero padding, so "114-G10" finds "114-G010". */
  roomByKey: Map<string, Room>;
  roomsByBuilding: Map<string, Room[]>;
  sessionsByRoom: Map<string, Session[]>;
  sessionsByBuilding: Map<string, Session[]>;
  sessionsByCourse: Map<number, Session[]>;
}

const base = import.meta.env.BASE_URL;

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${base}data/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function group<K, V>(items: readonly V[], key: (v: V) => K | undefined): Map<K, V[]> {
  const out = new Map<K, V[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export async function loadData(): Promise<AppData> {
  const [campus, calendar, schedule, subjects, meta] = await Promise.all([
    getJson<CampusData>("campus.json"),
    getJson<AcademicCalendar>("calendar.json"),
    getJson<Schedule>("schedule.json"),
    getJson<Subject[]>("subjects.json"),
    getJson<Meta>("meta.json"),
  ]);
  return {
    campus,
    calendar,
    schedule,
    subjects,
    meta,
    campusById: new Map(campus.campuses.map((c) => [c.id, c])),
    buildingById: new Map(campus.buildings.map((b) => [b.id, b])),
    buildingIds: new Set(campus.buildings.map((b) => b.id)),
    roomByCode: new Map(campus.rooms.map((r) => [r.code, r])),
    roomByKey: new Map(campus.rooms.map((r) => [codeKey(r.code), r])),
    roomsByBuilding: group(campus.rooms, (r) => r.b),
    sessionsByRoom: group(schedule.sessions, (s) => s.room),
    sessionsByBuilding: group(schedule.sessions, (s) => s.building),
    sessionsByCourse: group(schedule.sessions, (s) => s.course),
  };
}

export function loadContext(): Promise<ContextData> {
  return getJson<ContextData>("context.json");
}

let roomIndexPromise: Promise<RoomIndex> | undefined;

/** Rooms that have a position on the campus map but no published outline. Loaded on first use. */
export function loadRoomIndex(): Promise<RoomIndex> {
  roomIndexPromise ??= getJson<RoomIndex>("rooms-index.json").catch((e) => {
    roomIndexPromise = undefined;
    throw e;
  });
  return roomIndexPromise;
}

const plansPromises = new Map<string, Promise<FloorPlans>>();

/** The floor plans of one building: its other spaces as typed shapes. Loaded when the building is opened. */
export function loadPlans(building: string): Promise<FloorPlans> {
  let promise = plansPromises.get(building);
  if (!promise) {
    promise = getJson<FloorPlans>(`plans/${building}.json`).catch((e) => {
      plansPromises.delete(building);
      throw e;
    });
    plansPromises.set(building, promise);
  }
  return promise;
}

export interface IndexedRoom {
  code: string;
  building: string;
  floor: number;
  /** Position in metres, [east, north]. */
  at: [number, number];
}

/** Looks a code up in the room index, ignoring zero padding. */
export function findIndexedRoom(index: RoomIndex, building: string, room: string): IndexedRoom | undefined {
  const want = codeKey(`${building}-${room}`);
  for (const [part, floor, x, y] of index[building] ?? []) {
    if (codeKey(`${building}-${part}`) === want) return { code: `${building}-${part}`, building, floor, at: [x / 10, y / 10] };
  }
  return undefined;
}
