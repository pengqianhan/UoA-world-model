// Schema of the JSON files under public/data, produced by scripts/build-data.ts.

/** Text keyed by language code. `en` is always present; other languages are optional. */
export type LocalizedText = { en: string } & { [lang: string]: string };

/** Flat list of integer decimetres in the local east/north frame: [x0, y0, x1, y1, ...]. */
export type FlatRing = number[];

export interface Origin {
  lat: number;
  lon: number;
}

export type RoomKind =
  | "lectureTheatre"
  | "teaching"
  | "computerLab"
  | "lab"
  | "studio"
  | "study"
  | "library"
  | "studentHub"
  | "other";

export interface Campus {
  id: string;
  name: LocalizedText;
  /** True when the campus is part of the 3D scene. */
  onMap: boolean;
  /** Centre of the campus buildings in the local frame, metres. */
  center: [number, number];
  buildingCount: number;
}

export interface Floor {
  /** Level index from the source: 0 = entry level, 10 = one level up, 5 = mezzanine, -10 = one down. */
  i: number;
  /** Floor name as printed in room numbers and lift buttons, e.g. "G", "B", "3", "1M". */
  name: string;
  /** Polygons with holes: [polygon][ring] -> FlatRing. Omitted when identical to the floor below. */
  outline?: FlatRing[][];
  /** Set when the source's outline for this floor was unusable and the building's footprint stands in. */
  outlineFrom?: "footprint";
  /**
   * Level index of a lower floor that this floor matches almost exactly in outline. Seen from
   * outside the two are drawn as one block with the lower floor's outline; inside the building
   * each floor keeps its own.
   */
  stackWith?: number;
  /**
   * Set when no floor plan is published for this floor: people live on it, it is a childcare
   * centre, or the campus map draws nothing on it.
   */
  noPlan?: "residential" | "childcare" | "unmapped";
  /** Set when the campus map's shapes cover only a small part of this floor. */
  partialPlan?: true;
}

export interface Building {
  /** Building number as used in room codes, e.g. "303", "105S". */
  id: string;
  campus: string;
  name: LocalizedText;
  /** Name exactly as it appears in the source data. */
  sourceText: string;
  /** Footprint: [ring] -> FlatRing, first ring is the outer boundary. */
  outline: FlatRing[];
  center: [number, number];
  floors: Floor[];
  /** Estimated massing height in metres, from the number of levels at or above entry level. */
  height: number;
  /** How `height` was obtained. Nothing here is surveyed. */
  heightSource: "floor-count";
  /** Number of published learning spaces in this building. */
  roomCount: number;
  /** Number of shapes in this building's floor-plan file. Absent when there is no file. */
  planShapes?: number;
  /** True when the building lies outside the 3D scene (remote campuses and outliers). */
  offMap?: boolean;
}

export interface Room {
  /** Room code as used on timetables, e.g. "303-G23". */
  code: string;
  /** Building id. */
  b: string;
  /** Floor index (see Floor.i). */
  f: number;
  name: LocalizedText;
  kind: RoomKind;
  /** Room type exactly as in the source data. */
  sourceType: string;
  /** Simplified outline, outer ring only. */
  poly: FlatRing;
  /** A point inside the room for labels, metres. */
  c: [number, number];
  /** Floor area in square metres, from the simplified outline. */
  area: number;
}

export interface CampusData {
  version: 1;
  generatedAt: string;
  origin: Origin;
  /** Metres per level used when stacking floors. A display convention, not a measurement. */
  floorHeight: number;
  campuses: Campus[];
  buildings: Building[];
  rooms: Room[];
}

/** The group a space that is not named is drawn in, by its type on the campus map. */
export type SpaceKind = "office" | "lab" | "learning" | "toilet" | "stairs" | "amenity" | "other";

/** A space type on the campus map, in its own words, and the group it is drawn in. */
export interface SpaceType {
  text: string;
  kind: SpaceKind;
}

/**
 * The rest of a building's floors: every other space the campus map draws, as a shape with the
 * campus map's type for it and no code or name. One file per building,
 * public/data/plans/<building id>.json.
 */
export interface FloorPlans {
  version: 2;
  building: string;
  /** Every type the shapes in this file carry. */
  types: SpaceType[];
  /** Floor index (Floor.i) -> shapes, largest first. Each shape is [ring] -> FlatRing, outer ring first. */
  floors: Record<string, FlatRing[][]>;
  /** Floor index -> for each shape in `floors`, in the same order, its index in `types`. */
  typeOf: Record<string, number[]>;
}

export type RoadClass = "motorway" | "major" | "street" | "service" | "path" | "steps";
export type AreaClass = "park" | "grass" | "wood" | "pitch" | "water";

export type RoofShape = "gabled" | "hipped" | "pyramidal" | "dome" | "round" | "skillion";

/** A roof as OpenStreetMap tags it. The shape is drawn in a simplified form. */
export interface ContextRoof {
  k: RoofShape;
  /** Height of the roof above the top of the walls, metres. */
  h: number;
  /** Gabled, hipped and round roofs: true when the ridge runs across the long side instead of along it. */
  across?: true;
  /** Skillion roofs: compass bearing, in degrees, that the roof falls towards. */
  bearing?: number;
}

/** A building of the surrounding city, or one part of a building that OpenStreetMap maps in parts. */
export interface ContextBuilding {
  /** Outer ring. */
  p: FlatRing;
  /** Height of the top of the walls, metres above the ground. */
  h: number;
  /** Height the walls start at, for a part that sits on top of another. Absent when it is the ground. */
  b?: number;
  roof?: ContextRoof;
}

export interface ContextData {
  version: 1;
  origin: Origin;
  attribution: string;
  /** Non-University buildings and building parts. */
  buildings: ContextBuilding[];
  roads: { k: RoadClass; p: FlatRing }[];
  areas: { k: AreaClass; p: FlatRing }[];
  rails: FlatRing[];
  /** Flat [x, y, x, y, ...] in decimetres. */
  trees: number[];
  /** Trees OpenStreetMap tags `leaf_cycle=deciduous`, which are not in `trees`. Flat, in decimetres. */
  deciduous: number[];
}

/**
 * Compact index of every searchable room on the public campus map, including rooms
 * whose outline is not published: building id -> [roomPart, floorIndex, x_dm, y_dm][].
 */
export type RoomIndex = Record<string, [string, number, number, number][]>;

export interface SourceInfo {
  id: string;
  name: string;
  url: string;
  licence: string;
  /** ISO date (Pacific/Auckland) of the snapshot the published data was built from. */
  snapshotDate: string;
  provides: string;
}

export interface Coverage {
  buildings: number;
  buildingsOnMap: number;
  rooms: number;
  indexedRooms: number;
  /** Other spaces drawn as shapes in the floor plans, each with its type on the campus map. */
  planShapes: number;
  subjects: number;
  courses: number;
  sessions: number;
  sessionsLocatedToRoom: number;
  sessionsLocatedToFloor: number;
  sessionsLocatedToBuilding: number;
  sessionsExcluded: number;
}

export interface Meta {
  version: 1;
  generatedAt: string;
  sources: SourceInfo[];
  coverage: Coverage;
}

export type SessionPrecision = "room" | "floor" | "building" | "campus" | "none";

export interface Course {
  /** e.g. "COMPSCI 101" */
  code: string;
  subject: string;
  catalogNbr: string;
  title: LocalizedText;
}

export interface Session {
  /** Index into Schedule.courses. */
  course: number;
  term: string;
  /** Class component as in the source, e.g. "LEC", "TUT", "LAB". */
  component: string;
  section: string;
  /** ISO weekday 1 (Monday) .. 7 (Sunday). */
  day: number;
  /** Minutes after local midnight, Pacific/Auckland. */
  start: number;
  end: number;
  /** Inclusive local dates, ISO. */
  startDate: string;
  endDate: string;
  /** Location exactly as in the source. */
  sourceText: string;
  room?: string;
  building?: string;
  floor?: number;
  campus?: string;
  precision: SessionPrecision;
  /** True when the floor was derived from the room number instead of the campus map. */
  floorInferred?: boolean;
}

export interface Exclusion {
  course: string;
  term: string;
  sourceText: string;
  reason: string;
}

export interface Schedule {
  version: 1;
  generatedAt: string;
  /** False while no timetable snapshot is available; the UI explains why. */
  available: boolean;
  snapshotDate?: string;
  terms: string[];
  courses: Course[];
  sessions: Session[];
  exclusions: Exclusion[];
}

export interface Subject {
  code: string;
  name: LocalizedText;
  faculty: LocalizedText;
}

export interface TermDates {
  /** Term code used by the University's systems, e.g. "1265". */
  code: string;
  kind: "summer" | "semester" | "quarter" | "lateYear";
  name: LocalizedText;
  /** Inclusive ISO dates, Pacific/Auckland. */
  start: string;
  lecturesEnd: string;
  end: string;
  breaks: { name: LocalizedText; start: string; end: string }[];
  studyBreak?: { start: string; end: string };
  exams?: { start: string; end: string };
}

export interface AcademicCalendar {
  timezone: "Pacific/Auckland";
  source: { name: string; url: string; checked: string };
  notes: string[];
  holidays: { date: string; name: LocalizedText }[];
  terms: TermDates[];
}
