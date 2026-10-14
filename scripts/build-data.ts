// Builds the published data files in public/data from the raw snapshots in data/raw.
// Never touches the network: run the fetch-*.ts scripts first (they are cache-first).
//
//   npx tsx scripts/build-data.ts
import fs from "node:fs";
import path from "node:path";
import {
  bbox,
  boundingRectangle,
  cleanRing,
  encodeRing,
  interiorPoint,
  makeProjector,
  makeUnprojector,
  overlap,
  pointInRing,
  ringArea,
  ringCentroid,
  shareInside,
  simplifyLine,
  simplifyRing,
  type Pt,
  type Ring,
} from "../src/shared/geo.ts";
import { aucklandWallTime } from "../src/shared/time.ts";
import type {
  AcademicCalendar,
  AreaClass,
  Building,
  Campus,
  CampusData,
  ContextBuilding,
  ContextData,
  ContextRoof,
  Coverage,
  FlatRing,
  Floor,
  FloorPlans,
  Meta,
  RoadClass,
  RoofShape,
  Room,
  RoomIndex,
  RoomKind,
  Schedule,
  SourceInfo,
  SpaceIcon,
  SpaceKind,
  SpaceType,
  Subject,
  TerrainData,
} from "../src/shared/types.ts";
import { AREAS, CENTRAL, type SceneArea } from "./lib/areas.ts";
import { decodePng, type Image } from "./lib/png.ts";
import { TERRAIN_ZOOM, globalPixel, terrainBox, terrainFile, terrarium, tilesFor } from "./lib/terrain.ts";
import { buildSchedule, loadClassSnapshots } from "./lib/classes.ts";
import { hasSnapshot, manifest, readSnapshot } from "./lib/snapshot.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "data");

/** Origin of the local metric frame: roughly the middle of the City Campus. */
const ORIGIN = { lat: -36.8523, lon: 174.7691 };
/** Display convention for stacking floors; the source has no heights. */
const FLOOR_HEIGHT = 3.6;
/** A floor outline with less of its area than this over its own building belongs to another one. */
const MIN_FOOTPRINT_SHARE = 0.2;
/**
 * Two floors whose outlines share this much of the area either covers are drawn from outside as
 * one block. Of the 472 pairs of neighbouring floors in the snapshot of 2026-10-13, 251 share 99%
 * or more: the same walls, traced again floor by floor. The value keeps a real setback, which
 * takes away far more than a twentieth of a floor.
 */
const STACK_OVERLAP = 0.95;
const project = makeProjector(ORIGIN);

/**
 * The areas the 3D map draws (scripts/lib/areas.ts) whose OpenStreetMap snapshot has been taken,
 * each with its box in the local frame, metres. An area without its snapshot is not drawn.
 */
const areaBoxes = AREAS.filter((area) => hasSnapshot(area.osm)).map((area) => {
  const [x0, y0] = project(area.bbox[1], area.bbox[0]);
  const [x1, y1] = project(area.bbox[3], area.bbox[2]);
  return { area, x0, y0, x1, y1 };
});
type AreaBox = (typeof areaBoxes)[number];
const inBox = (b: AreaBox, p: Pt, margin = 0) => p[0] >= b.x0 - margin && p[0] <= b.x1 + margin && p[1] >= b.y0 - margin && p[1] <= b.y1 + margin;
/** The area of the map a point lies in, if any. */
const areaOf = (p: Pt): SceneArea | undefined => areaBoxes.find((b) => inBox(b, p))?.area;
/** The area whose surroundings are being built; `inScene` and `clipLine` ask about it. */
let sceneBox: AreaBox = areaBoxes.find((b) => b.area === CENTRAL)!;
const inScene = (p: Pt, margin = 0) => inBox(sceneBox, p, margin);

/** Where a building or campus centred here stands: in the central area, in another one, or off the map. */
const placeOnMap = (center: Pt): { area?: string; offMap?: true } => {
  const area = areaOf(center);
  return !area ? { offMap: true } : area === CENTRAL ? {} : { area: area.id };
};

const readJson = <T>(file: string): T => JSON.parse(readSnapshot(file).toString("utf8")) as T;
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------------------------
// Campus map (MapsIndoors)
// ---------------------------------------------------------------------------------------------

interface MiVenue {
  id: string;
  name: string;
  venueInfo: { name: string };
}
interface MiGeometry {
  type: "Polygon" | "MultiPolygon" | "Point";
  coordinates: unknown;
}
interface MiFloor {
  name: string;
  geometry: MiGeometry;
}
interface MiBuilding {
  administrativeId: string;
  venueId: string;
  buildingInfo: { name: string };
  geometry: MiGeometry;
  floors: Record<string, MiFloor>;
}
interface MiLocation {
  geometry: MiGeometry;
  properties: {
    name: string;
    type: string;
    floor: string;
    floorName: string;
    building: string;
    venue: string;
    locationType: string;
    status: number;
    externalId: string | null;
  };
}

/** Campus ids by the source's venue name. Whether a campus is on the map follows scripts/lib/areas.ts. */
const CAMPUS_IDS: Record<string, { id: string }> = {
  CITY_CAMPUS: { id: "city" },
  GRAFTON_CAMPUS: { id: "grafton" },
  NEWMARKET_CAMPUS: { id: "newmarket" },
  LEIGH_CAMPUS: { id: "leigh" },
  ARDMORE_CAMPUS: { id: "ardmore" },
  TAI_TOKERAU_CAMPUS: { id: "tai-tokerau" },
  TAI_TONGA_CAMPUS: { id: "tai-tonga" },
  WAIHEKE_RESEARCH_STATION: { id: "waiheke" },
};

/** Source room types that are published with an outline, and the kind they map to. */
const LEARNING_TYPES: Record<string, RoomKind> = {
  "Lecture theatres": "lectureTheatre",
  "Teaching spaces": "teaching",
  "Computer labs": "computerLab",
  Laboratories: "lab",
  "Lab-Undergrad": "lab",
  "Study spaces": "study",
  "Student spaces": "study",
  Library: "library",
  "Student hubs": "studentHub",
};

/** Source types left out of the lazy room index: private, non-rooms, or not something to navigate to. */
const INDEX_EXCLUDED_TYPES = new Set([
  "Stud Residential Accom",
  "Accommodation Reception",
  "Parking For Vehicles",
  "Non Usable Area",
  "Nonasgn Rentable",
  "Ancillary Area",
  "Void 2.0 test",
  "Stairs",
  "Elevator",
  "Female",
  "Male",
  "Unisex",
  "Accessible",
  "Gender Diverse",
  "Shower",
  "Squat",
  "Cages",
  "Bike Store",
  "Building",
]);

/** A floor holding any of these gets no floor plan: where people live is not drawn, even unnamed. */
const PLAN_RESIDENTIAL_TYPES = new Set(["Stud Residential Accom"]);
/** Buildings that get no floor plan, by their name in the source: childcare centres. */
const PLAN_CHILDCARE_BUILDINGS = /Early Childhood|K[oō]hanga Reo/i;
/** Shapes that are not rooms: single parking bays and the source's own test records. */
const PLAN_SKIPPED_TYPES = new Set(["Parking For Vehicles", "Void 2.0 test"]);
/**
 * The group each source type of a floor-plan shape is drawn in. A type not listed here, such as
 * "Non Usable Area", "Ancillary Area" or "Nonasgn Rentable", is "other": the source does not say
 * what it holds. A learning type lands here when the source hides the room from its search or
 * gives it no standard code, so it is not named.
 */
const SPACE_KINDS: Record<string, SpaceKind> = {
  ...Object.fromEntries(Object.keys(LEARNING_TYPES).map((t) => [t, "learning"])),
  "Office Accommodation": "office",
  "Lab-Research": "lab",
  "Lab-Postgrad": "lab",
  "Lab-Circulation spaces": "lab",
  "Lab-Music": "lab",
  "Lab-Media": "lab",
  Female: "toilet",
  Male: "toilet",
  Unisex: "toilet",
  Accessible: "toilet",
  "Gender Diverse": "toilet",
  Squat: "toilet",
  Shower: "toilet",
  Stairs: "stairs",
  Elevator: "stairs",
  "Cafes and Restaurants": "amenity",
  Bars: "amenity",
  Groceries: "amenity",
  Pharmacy: "amenity",
  Post: "amenity",
  Kitchen: "amenity",
  Gyms: "amenity",
  "Health and counselling": "amenity",
  "Disability services": "amenity",
  "Information Serv": "amenity",
  "Parent Space": "amenity",
  "Accommodation Reception": "amenity",
  Emergency: "amenity",
  "Bike Store": "amenity",
};
/**
 * The sign drawn on a shape of these types. In the snapshot of 2026-10-13 every "Accessible" shape
 * is named as a toilet ("Accessible - Unisex", "Accessible - Female"), and "Squat" as a squat toilet.
 */
const SPACE_ICONS: Record<string, SpaceIcon> = {
  Stairs: "stairs",
  Elevator: "lift",
  Female: "toilet",
  Male: "toilet",
  Unisex: "toilet",
  "Gender Diverse": "toilet",
  Squat: "toilet",
  Accessible: "accessible",
  Shower: "shower",
};
/**
 * A floor on which the campus map's shapes, of every kind, cover less of the floor than this is
 * marked as partly drawn. In the snapshot of 2026-10-13 such floors hold stairs, lifts, toilets and
 * plant and little else: roof plant levels, mezzanines, the landings of a split-level building.
 */
const PARTIAL_PLAN = 0.3;

const CODE_RE = /^(\d{3}[A-Z]?)-([A-Z0-9]+)$/;

function toRing(coords: number[][], tolerance: number): Ring {
  return simplifyRing(cleanRing(coords.map((c) => project(c[0]!, c[1]!))), tolerance);
}

/** Geometry -> list of polygons, each a list of rings (outer first). */
function polygons(g: MiGeometry, tolerance: number): Ring[][] {
  const raw =
    g.type === "Polygon"
      ? [g.coordinates as number[][][]]
      : g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][])
        : [];
  const out: Ring[][] = [];
  for (const poly of raw) {
    const rings = poly.map((r) => toRing(r, tolerance)).filter((r) => r.length >= 3);
    const outer = rings[0];
    if (!outer || ringArea(outer) < 2) continue;
    out.push([outer, ...rings.slice(1).filter((r) => ringArea(r) >= 1)]);
  }
  return out;
}

/** Area of polygons with holes, square metres. */
function polygonsArea(polys: Ring[][]): number {
  return polys.reduce((n, [outer, ...holes]) => n + ringArea(outer!) - holes.reduce((h, r) => h + ringArea(r), 0), 0);
}

function buildingName(raw: string, id: string): string {
  // Source names repeat the building id as a prefix ("B303 Science Centre", "B6WA A Block")
  // or as a suffix in brackets ("Med School Hospital Underpass (595)").
  const prefix = `B${id}`;
  const unprefixed = raw.startsWith(`${prefix} `) || raw === prefix ? raw.slice(prefix.length) : raw;
  let n = unprefixed
    .replace(/^B\d{3}[A-Z]?\b\s*/, "")
    .replace(/\s*\(\d{3}[A-Z]?\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) n = `Building ${id}`;
  return n;
}

function roomKind(sourceType: string, name: string): RoomKind {
  const kind = LEARNING_TYPES[sourceType] ?? "other";
  if (kind === "teaching" && /^studio/i.test(name)) return "studio";
  if (kind === "teaching" && /^(informal|study)/i.test(name)) return "study";
  return kind;
}

function buildCampus(): { data: CampusData; index: RoomIndex; plans: FloorPlans[]; stats: Record<string, number> } {
  const venues = readJson<MiVenue[]>("mapsindoors/venues.json");
  const miBuildings = readJson<MiBuilding[]>("mapsindoors/buildings.json");
  const locations = readJson<MiLocation[]>("mapsindoors/locations.json");
  const stats: Record<string, number> = {};
  const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

  const venueById = new Map(venues.map((v) => [v.id, v]));
  const venueCampus = (name: string) => CAMPUS_IDS[name]?.id ?? name.toLowerCase();

  const buildings: Building[] = [];
  /** Area of the outline each floor has in effect, square metres, by `${building}|${floor}`. */
  const floorArea = new Map<string, number>();
  for (const b of miBuildings) {
    const venue = venueById.get(b.venueId);
    if (!venue) continue;
    const id = b.administrativeId;
    if (/^Cage\b/i.test(b.buildingInfo.name)) {
      bump("buildings.skipped.cage");
      continue;
    }
    const outlinePolys = polygons(b.geometry, 0.25);
    const outline = outlinePolys[0];
    if (!outline) {
      bump("buildings.skipped.noGeometry");
      continue;
    }
    const center = ringCentroid(outline[0]!);

    const floors: Floor[] = [];
    // The outline each floor has in effect: its own, or the one it repeats from the floor below.
    const shapes: (Ring[][] | undefined)[] = [];
    let prevKey = "";
    const sorted = Object.entries(b.floors)
      .map(([k, f]) => ({ i: Number(k), f }))
      .sort((a, z) => a.i - z.i);
    for (const { i, f } of sorted) {
      const floor: Floor = { i, name: f.name };
      let rings = polygons(f.geometry, 0.25);
      // A few floors in the source carry the outline of a different building. The footprint
      // stands in for an outline that misses its own building, and the floor is marked.
      if (rings.length && shareInside(rings, outline[0]!) < MIN_FOOTPRINT_SHARE) {
        rings = [outline];
        floor.outlineFrom = "footprint";
        bump("floors.outlineFromFootprint");
      }
      const polys = rings.map((poly) => poly.map(encodeRing));
      const key = JSON.stringify(polys);
      if (polys.length && key !== prevKey) floor.outline = polys;
      if (polys.length) prevKey = key;
      shapes.push(floor.outline ? rings : shapes[shapes.length - 1]);
      floors.push(floor);
      floorArea.set(`${id}|${i}`, polygonsArea(shapes[shapes.length - 1] ?? [outline]));
    }
    // Storeys that are alike from outside stand as one block: each run of full levels at or above
    // entry is measured against its lowest floor, so that a slow drift up a tower still shows.
    const entry = floors.find((f) => f.i >= 0)?.i;
    let run: { i: number; shape: Ring[][] } | undefined;
    floors.forEach((floor, k) => {
      if (entry === undefined || floor.i < 0 || (floor.i - entry) % 10 !== 0) return;
      const shape = shapes[k] ?? [outline];
      if (run && shape !== run.shape && overlap(run.shape, shape) >= STACK_OVERLAP) {
        floor.stackWith = run.i;
        bump("floors.stackedWithLower");
      } else if (!run || shape !== run.shape) run = { i: floor.i, shape };
    });
    const above = floors.filter((f) => f.i >= 0).map((f) => f.i);
    const levels = above.length ? (Math.max(...above) - Math.min(...above)) / 10 + 1 : 0;
    const height = levels > 0 ? round1(levels * FLOOR_HEIGHT) : 1.2;

    buildings.push({
      id,
      campus: venueCampus(venue.name),
      name: { en: buildingName(b.buildingInfo.name, id) },
      sourceText: b.buildingInfo.name,
      outline: outline.map(encodeRing),
      center: [round1(center[0]), round1(center[1])],
      floors,
      height,
      heightSource: "floor-count",
      roomCount: 0,
      ...placeOnMap(center),
    });
  }
  buildings.sort((a, z) => a.id.localeCompare(z.id, "en", { numeric: true }));
  const byId = new Map(buildings.map((b) => [b.id, b]));

  // Rooms. A code can appear more than once in the source; keep the largest outline.
  const rooms = new Map<string, Room>();
  const index: RoomIndex = {};
  const indexed = new Set<string>();
  for (const loc of locations) {
    const p = loc.properties;
    const code = p.externalId?.trim().toUpperCase();
    if (!code) continue;
    const m = CODE_RE.exec(code);
    if (!m) {
      bump("rooms.skipped.nonStandardCode");
      continue;
    }
    if (p.status !== 3) {
      bump("rooms.skipped.notSearchableInSource");
      continue;
    }
    // Trust the code's own building prefix when that building exists; otherwise the source field.
    const building = byId.get(m[1]!) ?? byId.get(p.building);
    if (!building) {
      bump("rooms.skipped.unknownBuilding");
      continue;
    }
    const floorIndex = Number(p.floor);
    if (!Number.isFinite(floorIndex) || !building.floors.some((f) => f.i === floorIndex)) {
      bump("rooms.skipped.unknownFloor");
      continue;
    }
    if (loc.geometry.type !== "Polygon") continue;
    const ring = toRing((loc.geometry.coordinates as number[][][])[0]!, 0.15);
    if (ring.length < 3) continue;
    const area = ringArea(ring);
    const c = interiorPoint(ring);
    const roomPart = m[2]!;
    const fullCode = `${building.id}-${roomPart}`;

    const kind = LEARNING_TYPES[p.type] ? roomKind(p.type, p.name) : undefined;
    if (kind) {
      const existing = rooms.get(fullCode);
      if (existing) bump("rooms.duplicateCodes");
      if (!existing || existing.area < area) {
        rooms.set(fullCode, {
          code: fullCode,
          b: building.id,
          f: floorIndex,
          name: { en: p.name.trim() || p.type },
          kind,
          sourceType: p.type,
          poly: encodeRing(ring),
          c: [round1(c[0]), round1(c[1])],
          area: Math.round(area),
        });
      }
    } else if (!INDEX_EXCLUDED_TYPES.has(p.type) && p.locationType === "room" && !indexed.has(fullCode)) {
      indexed.add(fullCode);
      (index[building.id] ??= []).push([roomPart, floorIndex, Math.round(c[0] * 10), Math.round(c[1] * 10)]);
    } else {
      bump("rooms.notPublished");
    }
  }
  // A code published with an outline does not need an index entry as well.
  for (const [bid, list] of Object.entries(index)) {
    index[bid] = list.filter(([part]) => !rooms.has(`${bid}-${part}`)).sort((a, z) => a[0].localeCompare(z[0]));
  }

  const roomList = [...rooms.values()].sort((a, z) => a.code.localeCompare(z.code, "en", { numeric: true }));
  for (const r of roomList) byId.get(r.b)!.roomCount++;

  // Floor plans: whatever else the map draws on a floor, as shapes with the map's type for each.
  // Unlike the rooms above, these need no code and may be hidden from the source's search,
  // because nothing names them.
  for (const b of buildings) {
    if (PLAN_CHILDCARE_BUILDINGS.test(b.sourceText)) for (const f of b.floors) f.noPlan = "childcare";
  }
  const placed: { building: Building; floor: Floor; loc: MiLocation }[] = [];
  // How much of each floor the campus map covers with shapes of any kind, named or not.
  const drawnArea = new Map<string, number>();
  for (const loc of locations) {
    if (loc.geometry.type !== "Polygon") continue;
    const p = loc.properties;
    const m = CODE_RE.exec(p.externalId?.trim().toUpperCase() ?? "");
    const building = (m && byId.get(m[1]!)) ?? byId.get(p.building);
    const floor = building?.floors.find((f) => f.i === Number(p.floor));
    if (!building || !floor) continue;
    const key = `${building.id}|${floor.i}`;
    drawnArea.set(key, (drawnArea.get(key) ?? 0) + polygonsArea(polygons(loc.geometry, 0.2)));
    if (PLAN_RESIDENTIAL_TYPES.has(p.type)) floor.noPlan = "residential";
    else if (m && rooms.has(`${building.id}-${m[2]}`)) continue;
    else if (!building.offMap) placed.push({ building, floor, loc });
  }
  const namedOn = new Map<string, Pt[]>();
  for (const r of roomList) namedOn.set(`${r.b}|${r.f}`, [...(namedOn.get(`${r.b}|${r.f}`) ?? []), r.c]);
  const shapes = new Map<string, Map<number, { rings: Ring[]; area: number; type: string }[]>>();
  for (const { building, floor, loc } of placed) {
    if (floor.noPlan) {
      bump(`plans.skipped.${floor.noPlan}Floor`);
      continue;
    }
    if (PLAN_SKIPPED_TYPES.has(loc.properties.type)) {
      bump("plans.skipped.notARoom");
      continue;
    }
    // polygons() drops outlines under 2 square metres, which here are ducts and risers.
    const poly = polygons(loc.geometry, 0.2)[0];
    if (!poly) {
      bump("plans.skipped.tiny");
      continue;
    }
    // A shape lying over a named room is the open area around it; the room is what is drawn there.
    const named = namedOn.get(`${building.id}|${floor.i}`) ?? [];
    if (named.some((c) => pointInRing(c, poly[0]!) && !poly.slice(1).some((hole) => pointInRing(c, hole)))) {
      bump("plans.skipped.coversNamedRoom");
      continue;
    }
    let floors = shapes.get(building.id);
    if (!floors) shapes.set(building.id, (floors = new Map()));
    let list = floors.get(floor.i);
    if (!list) floors.set(floor.i, (list = []));
    const type = loc.properties.type.trim();
    list.push({ rings: poly, area: ringArea(poly[0]!), type });
    if (loc.properties.status !== 3) bump("plans.shapes.hiddenFromSourceSearch");
    bump(`plans.shapes.kind.${SPACE_KINDS[type] ?? "other"}`);
  }
  const plans: FloorPlans[] = [];
  for (const b of buildings) {
    const floors = shapes.get(b.id);
    if (!floors) continue;
    const plan: FloorPlans = { version: 2, building: b.id, types: [], floors: {}, typeOf: {} };
    const typeIndex = new Map<string, number>();
    const typeOf = (text: string): number => {
      let k = typeIndex.get(text);
      if (k === undefined) {
        const icon = SPACE_ICONS[text];
        k = plan.types.push({ text, kind: SPACE_KINDS[text] ?? "other", ...(icon ? { icon } : {}) } satisfies SpaceType) - 1;
        typeIndex.set(text, k);
      }
      return k;
    };
    b.planShapes = 0;
    for (const [i, list] of [...floors].sort((a, z) => a[0] - z[0])) {
      // Largest first, so a room inside an open area is drawn after the area around it.
      list.sort((a, z) => z.area - a.area);
      plan.floors[i] = list.map((s) => s.rings.map(encodeRing));
      plan.typeOf[i] = list.map((s) => typeOf(s.type));
      b.planShapes += list.length;
      bump("plans.floors");
    }
    plans.push(plan);
  }
  // Mark what the campus map itself leaves out, so that a bare floor is not taken for one this
  // site failed to draw.
  for (const b of buildings) {
    if (b.offMap) continue;
    for (const f of b.floors) {
      if (f.noPlan) continue;
      const key = `${b.id}|${f.i}`;
      const drawn = drawnArea.get(key) ?? 0;
      if (drawn === 0) {
        f.noPlan = "unmapped";
        bump("floors.unmapped");
      } else if (drawn < PARTIAL_PLAN * (floorArea.get(key) ?? 0)) {
        f.partialPlan = true;
        bump("floors.partialPlan");
      }
    }
  }

  const campuses: Campus[] = venues
    .map((v) => {
      const id = venueCampus(v.name);
      const own = buildings.filter((b) => b.campus === id);
      // Median of building centres, so one far-away outlier does not drag the campus centre.
      const xs = own.map((b) => b.center[0]).sort((a, z) => a - z);
      const ys = own.map((b) => b.center[1]).sort((a, z) => a - z);
      const mid = Math.floor(own.length / 2);
      const center: [number, number] = [round1(xs[mid] ?? 0), round1(ys[mid] ?? 0)];
      // A campus is on the map when its middle is; a building far from the rest has its own area.
      const place = placeOnMap(center);
      return {
        id,
        name: { en: v.venueInfo.name },
        onMap: !place.offMap,
        ...(place.area ? { area: place.area } : {}),
        center,
        buildingCount: own.length,
      };
    })
    // The central campuses first, then those in areas of their own, then any off the map.
    .sort((a, z) => Number(z.onMap) - Number(a.onMap) || Number(!!a.area) - Number(!!z.area) || z.buildingCount - a.buildingCount);

  return {
    data: {
      version: 1,
      generatedAt: new Date().toISOString(),
      origin: ORIGIN,
      floorHeight: FLOOR_HEIGHT,
      campuses,
      buildings,
      rooms: roomList,
    },
    index,
    plans,
    stats,
  };
}

// ---------------------------------------------------------------------------------------------
// OpenStreetMap context
// ---------------------------------------------------------------------------------------------

interface OsmNodeRef {
  lat: number;
  lon: number;
}
interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: OsmNodeRef[];
  members?: { type: string; role: string; geometry?: OsmNodeRef[] }[];
}

const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: "motorway",
  motorway_link: "motorway",
  trunk: "motorway",
  trunk_link: "motorway",
  primary: "major",
  primary_link: "major",
  secondary: "major",
  secondary_link: "major",
  tertiary: "major",
  tertiary_link: "major",
  residential: "street",
  unclassified: "street",
  living_street: "street",
  busway: "street",
  road: "street",
  service: "service",
  pedestrian: "path",
  footway: "path",
  path: "path",
  cycleway: "path",
  track: "path",
  steps: "steps",
};

/** Metres per level where OpenStreetMap gives levels and no height. */
const OSM_LEVEL = 3.3;
/** Parts covering at least this share of their building's outline stand in for it. */
const PARTS_REPLACE_OUTLINE = 0.9;
/** A ridge is drawn only on an outline that fills this share of its bounding rectangle. */
const RIDGE_MIN_FILL = 0.6;

/** OpenStreetMap roof shapes and the simplified shape each is drawn as. Others are drawn flat. */
const ROOF_SHAPES: Record<string, RoofShape> = {
  gabled: "gabled",
  "half-hipped": "gabled",
  gambrel: "gabled",
  hipped: "hipped",
  mansard: "hipped",
  crosspitched: "hipped",
  pyramidal: "pyramidal",
  dome: "dome",
  onion: "dome",
  round: "round",
  skillion: "skillion",
};

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function num(s: string | undefined): number | undefined {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : undefined;
}

/** A tagged height in metres; a height of zero or less is a mapping slip and counts as missing. */
function height(s: string | undefined): number | undefined {
  const n = num(s);
  return n !== undefined && n > 0 ? n : undefined;
}

/** A bearing in degrees from a number or a compass point. */
function bearing(s: string | undefined): number | undefined {
  const i = COMPASS.indexOf((s ?? "").toUpperCase());
  return i >= 0 ? i * 22.5 : num(s);
}

/** The roof an element's tags describe, sized to the outline it sits on. */
function roofOf(t: Record<string, string>, ring: Ring, bump: (k: string) => void): ContextRoof | undefined {
  const k = ROOF_SHAPES[t["roof:shape"] ?? ""];
  if (!k) return undefined;
  const box = boundingRectangle(ring);
  // A ridge over an L or a cross would send roof faces across the gap, so those stay flat.
  if ((k === "gabled" || k === "hipped" || k === "round") && ringArea(ring) < RIDGE_MIN_FILL * box.length * box.width) {
    bump("context.roofs.flatOnIrregularOutline");
    return undefined;
  }
  const levels = num(t["roof:levels"]);
  let h = num(t["roof:height"]) ?? (levels !== undefined ? levels * 3 : undefined);
  if (h === undefined || h <= 0) {
    h = k === "dome" || k === "pyramidal" ? box.width / 2 : k === "skillion" ? Math.min(2, box.width * 0.25) : Math.min(3.5, box.width * 0.3);
    bump("context.roofs.defaultHeight");
  }
  if (h < 0.2) return undefined;
  const roof: ContextRoof = { k, h: round1(h) };
  // roof:direction is the way a slope faces; some mappers put "along" or "across" in it.
  const word = t["roof:orientation"] ?? t["roof:direction"];
  const slope = bearing(t["roof:direction"]);
  if (k === "skillion") {
    if (slope !== undefined) roof.bearing = Math.round(slope);
  } else if (k !== "pyramidal" && k !== "dome") {
    if (word === "across") roof.across = true;
    else if (word !== "along" && slope !== undefined) {
      const rad = (slope * Math.PI) / 180;
      // The ridge runs across the long side when the slopes face along it.
      if (Math.abs(Math.sin(rad) * Math.cos(box.angle) + Math.cos(rad) * Math.sin(box.angle)) > 0.7) roof.across = true;
    }
  }
  bump(`context.roofs.${k}`);
  return roof;
}

function areaClass(t: Record<string, string>): AreaClass | undefined {
  if (t.natural === "water") return "water";
  if (t.natural === "wood" || t.landuse === "forest") return "wood";
  if (t.leisure === "pitch" || t.leisure === "track") return "pitch";
  if (t.leisure === "park" || t.leisure === "garden" || t.leisure === "playground") return "park";
  if (
    t.landuse === "grass" ||
    t.landuse === "village_green" ||
    t.landuse === "recreation_ground" ||
    t.landuse === "meadow" ||
    t.landuse === "cemetery" ||
    t.natural === "grassland" ||
    t.natural === "scrub"
  ) {
    return "grass";
  }
  return undefined;
}

/** Splits a polyline into the runs that lie inside the scene (plus a margin). */
function clipLine(line: Pt[], margin: number): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of line) {
    if (inScene(p, margin)) cur.push(p);
    else {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/** Outer rings of a way or multipolygon relation. Unclosed member ways are stitched end to end. */
function outerRings(e: OsmElement): Ring[] {
  const toPts = (g: OsmNodeRef[]) => g.map((n) => project(n.lon, n.lat));
  if (e.type === "way" && e.geometry) {
    const pts = toPts(e.geometry);
    const a = pts[0];
    const z = pts[pts.length - 1];
    if (!a || !z || Math.hypot(a[0] - z[0], a[1] - z[1]) > 0.5) return [];
    return [cleanRing(pts)];
  }
  if (e.type !== "relation" || !e.members) return [];
  const open: Pt[][] = [];
  const rings: Ring[] = [];
  const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.5;
  for (const m of e.members) {
    if (m.type !== "way" || !m.geometry || (m.role && m.role !== "outer")) continue;
    let seg = toPts(m.geometry);
    if (seg.length < 2) continue;
    if (near(seg[0]!, seg[seg.length - 1]!)) {
      rings.push(cleanRing(seg));
      continue;
    }
    // Stitch with any open chain that shares an endpoint.
    for (let i = 0; i < open.length; i++) {
      const chain = open[i]!;
      const head = chain[0]!;
      const tail = chain[chain.length - 1]!;
      if (near(tail, seg[0]!)) seg = [...chain, ...seg.slice(1)];
      else if (near(tail, seg[seg.length - 1]!)) seg = [...chain, ...seg.reverse().slice(1)];
      else if (near(head, seg[seg.length - 1]!)) seg = [...seg, ...chain.slice(1)];
      else if (near(head, seg[0]!)) seg = [...seg.reverse(), ...chain.slice(1)];
      else continue;
      open.splice(i, 1);
      i = -1;
    }
    if (near(seg[0]!, seg[seg.length - 1]!)) rings.push(cleanRing(seg));
    else open.push(seg);
  }
  return rings.filter((r) => r.length >= 3);
}

/** The surroundings of one area of the map, from its OpenStreetMap snapshot. */
function buildContext(campus: CampusData, box: AreaBox): { data: ContextData; stats: Record<string, number> } {
  sceneBox = box;
  const osm = readJson<{ elements: OsmElement[] }>(box.area.osm);
  const stats: Record<string, number> = {};
  // The central area's counts keep their old names; others are prefixed with the area.
  const prefix = box.area === CENTRAL ? "" : `${box.area.id}.`;
  const bump = (k: string, n = 1) => (stats[prefix + k] = (stats[prefix + k] ?? 0) + n);

  // University footprints, to drop the OSM copies of the same buildings.
  const uni = campus.buildings.map((b) => {
    const ring: Ring = [];
    const flat = b.outline[0]!;
    for (let i = 0; i < flat.length; i += 2) ring.push([flat[i]! / 10, flat[i + 1]! / 10]);
    return { ring, box: bbox(ring) };
  });
  const insideUni = (p: Pt) =>
    uni.some((u) => p[0] >= u.box[0] && p[0] <= u.box[2] && p[1] >= u.box[1] && p[1] <= u.box[3] && pointInRing(p, u.ring));

  const out: ContextData = {
    version: 1,
    origin: ORIGIN,
    attribution: "© OpenStreetMap contributors, ODbL 1.0",
    buildings: [],
    roads: [],
    areas: [],
    rails: [],
    trees: [],
    deciduous: [],
  };

  // Building outlines are held back until their parts are known.
  interface Outline {
    ring: Ring;
    box: [number, number, number, number];
    area: number;
    tags: Record<string, string>;
    /** Height from the tags, a default, or a tower's podium. */
    h: number;
    /** True when `h` is the building's tagged height, which includes its roof. */
    tagged: boolean;
    tower: boolean;
    parts: ContextBuilding[];
    partArea: number;
  }
  const outlines: Outline[] = [];
  const partElements: OsmElement[] = [];

  for (const e of osm.elements) {
    const t = e.tags ?? {};

    if (e.type === "node") {
      if (t.natural === "tree" && e.lat != null && e.lon != null) {
        const p = project(e.lon, e.lat);
        // A tree tagged deciduous is kept apart, so the scene can bare it in winter.
        if (inScene(p) && !insideUni(p)) (t.leaf_cycle === "deciduous" ? out.deciduous : out.trees).push(Math.round(p[0] * 10), Math.round(p[1] * 10));
      }
      continue;
    }

    if (t.building && t.building !== "no") {
      if (t.location === "underground" || Number(t.layer) < 0) continue;
      for (const ring0 of outerRings(e)) {
        const ring = simplifyRing(ring0, 0.5);
        const area = ringArea(ring);
        if (area < 12) continue;
        const c = ringCentroid(ring);
        if (!inScene(c, 30)) continue;
        // Same building as a University footprint? Sample the outline and the centre.
        const samples = [c, ...ring];
        const hit = samples.filter(insideUni).length / samples.length;
        const uniCentreInside = uni.some((u) => pointInRing(ringCentroid(u.ring), ring));
        if (hit > 0.35 || uniCentreInside) {
          bump("context.buildings.droppedAsUniversity");
          continue;
        }
        const tagged = height(t.height);
        const levels = num(t["building:levels"]);
        let h = tagged ?? (levels !== undefined ? levels * OSM_LEVEL + 1 : undefined);
        if (h === undefined) {
          h = t.building === "roof" || t.building === "carport" || t.building === "shed" ? 3 : area > 900 ? 10 : 6.5;
          bump("context.buildings.defaultHeight");
        }
        // Masts and observation towers are tagged with their full height on a podium-sized
        // footprint; extruding that would draw a 300 m slab, so only the podium is kept. A tower
        // that is mapped in parts is drawn from its parts instead, further down.
        const tower = h > 200 || t.man_made === "tower" || t.building === "tower";
        if (tower) h = Math.min(h, 24);
        outlines.push({ ring, box: bbox(ring), area, tags: t, h, tagged: tagged !== undefined && !tower, tower, parts: [], partArea: 0 });
      }
      continue;
    }

    if (t["building:part"] && t["building:part"] !== "no") {
      partElements.push(e);
      continue;
    }

    if (t.highway && e.type === "way" && e.geometry) {
      const k = ROAD_CLASS[t.highway];
      if (!k) continue;
      if (t.tunnel && t.tunnel !== "no") continue;
      if (t.indoor === "yes" || t.area === "yes" || t.access === "private") continue;
      if ((k === "path" || k === "steps") && t.footway === "sidewalk") continue;
      const line = e.geometry.map((n) => project(n.lon, n.lat));
      for (const run of clipLine(line, 40)) {
        const simple = simplifyLine(run, k === "path" || k === "steps" ? 0.6 : 0.4);
        if (simple.length >= 2) out.roads.push({ k, p: encodeRing(simple) });
      }
      continue;
    }

    if (t.railway === "rail" && e.type === "way" && e.geometry) {
      if (t.tunnel && t.tunnel !== "no") continue;
      const line = e.geometry.map((n) => project(n.lon, n.lat));
      for (const run of clipLine(line, 40)) out.rails.push(encodeRing(simplifyLine(run, 0.5)));
      continue;
    }

    const k = areaClass(t);
    if (k) {
      for (const ring0 of outerRings(e)) {
        const ring = simplifyRing(ring0, 0.6);
        if (ringArea(ring) < 25) continue;
        const [x0, y0, x1, y1] = bbox(ring);
        if (x1 < sceneBox.x0 || x0 > sceneBox.x1 || y1 < sceneBox.y0 || y0 > sceneBox.y1) continue;
        out.areas.push({ k, p: encodeRing(ring) });
      }
    }
  }

  // Parts: where OpenStreetMap maps a building as several volumes, each with its own height.
  for (const e of partElements) {
    const t = e.tags ?? {};
    for (const ring0 of outerRings(e)) {
      const ring = simplifyRing(ring0, 0.3);
      const area = ringArea(ring);
      if (area < 0.5) continue;
      const c = ringCentroid(ring);
      if (!inScene(c, 30)) continue;
      if (insideUni(c)) {
        bump("context.parts.droppedAsUniversity");
        continue;
      }
      // The smallest outline around the part is its building.
      let holder: Outline | undefined;
      for (const o of outlines) {
        if (c[0] < o.box[0] || c[0] > o.box[2] || c[1] < o.box[1] || c[1] > o.box[3] || !pointInRing(c, o.ring)) continue;
        if (!holder || o.area < holder.area) holder = o;
      }
      const roof = roofOf(t, ring, bump);
      const tagged = height(t.height);
      const levels = num(t["building:levels"]);
      // A tagged height includes the roof; levels do not.
      let top = tagged !== undefined ? tagged - (roof?.h ?? 0) : levels !== undefined ? levels * OSM_LEVEL : undefined;
      if (top === undefined) {
        top = holder && !holder.tower ? holder.h : 6.5;
        bump("context.parts.heightFromBuilding");
      }
      const minLevel = num(t["building:min_level"]);
      let base = num(t.min_height) ?? (minLevel !== undefined ? minLevel * OSM_LEVEL : 0);
      // A part tagged as a roof is a canopy: a thin slab at its height.
      if (t["building:part"] === "roof") base = Math.max(base, top - 0.4);
      if (top < base + 0.3) top = base + 0.3;
      const part: ContextBuilding = { p: encodeRing(ring), h: round1(top), ...(base > 0 ? { b: round1(base) } : {}), ...(roof ? { roof } : {}) };
      if (holder) {
        holder.parts.push(part);
        // Only parts that stand on the ground cover the outline; stacked ones would count twice.
        if (base === 0) holder.partArea += area;
      } else {
        out.buildings.push(part);
        bump("context.parts.withoutOutline");
      }
    }
  }
  for (const o of outlines) {
    if (o.parts.length) {
      out.buildings.push(...o.parts);
      bump("context.parts", o.parts.length);
      if (o.partArea >= PARTS_REPLACE_OUTLINE * o.area) {
        bump("context.buildings.replacedByParts");
        continue;
      }
      // Parts cover only some of the outline: it stays as the base they stand on, no higher
      // than the lowest part that starts at the ground.
      const lowest = Math.min(...o.parts.filter((p) => !p.b).map((p) => p.h));
      out.buildings.push({ p: encodeRing(o.ring), h: round1(Math.min(o.h, lowest)) });
      bump("context.buildings.underParts");
      continue;
    }
    const roof = o.tower ? undefined : roofOf(o.tags, o.ring, bump);
    const top = roof && o.tagged ? Math.max(o.h - roof.h, 2) : o.h;
    out.buildings.push({ p: encodeRing(o.ring), h: round1(top), ...(roof ? { roof } : {}) });
  }

  // Largest areas first so small pitches and gardens draw on top of the parks that contain them.
  out.areas.sort((a, z) => ringArea(decode(z.p)) - ringArea(decode(a.p)));
  stats["context.buildings"] = out.buildings.length;
  stats["context.roads"] = out.roads.length;
  stats["context.areas"] = out.areas.length;
  stats["context.trees"] = out.trees.length / 2;
  return { data: out, stats };
}

function decode(flat: FlatRing): Ring {
  const r: Ring = [];
  for (let i = 0; i < flat.length; i += 2) r.push([flat[i]! / 10, flat[i + 1]! / 10]);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Subjects (University Calendar "course codes by faculty" page)
// ---------------------------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&rsquo;|&#39;/g, "'")
    .replace(/&ndash;/g, "–");
}

// ---------------------------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------------------------

/** Grid spacing of the published ground, metres: a little coarser than the 8 m source. */
const TERRAIN_STEP = 10;
/**
 * Lowest height kept, metres. The tiles hold single-pixel pits where land meets sea (-1,421 m in
 * Hobson Bay, -451 m at the Viaduct); the sea itself is near 0.
 */
const TERRAIN_FLOOR = -2;

/** The ground under one area of the map on a square grid, from the elevation tile snapshot. */
function buildTerrain(area: SceneArea): { data?: TerrainData; stats: Record<string, number> } {
  const stats: Record<string, number> = {};
  const box = terrainBox(area);
  const tiles = new Map<string, Image>();
  for (const [x, y] of tilesFor(box, TERRAIN_ZOOM)) {
    const file = terrainFile(TERRAIN_ZOOM, x, y);
    if (!hasSnapshot(file)) return { stats };
    tiles.set(`${x}/${y}`, decodePng(readSnapshot(file)));
  }
  const pixel = (px: number, py: number): number => {
    const tx = Math.floor(px / 256);
    const ty = Math.floor(py / 256);
    const img = tiles.get(`${tx}/${ty}`);
    if (!img) return 0;
    const i = ((py - ty * 256) * img.width + (px - tx * 256)) * 3;
    return terrarium(img.rgb[i]!, img.rgb[i + 1]!, img.rgb[i + 2]!);
  };
  // Pixel values stand for pixel centres; sample between the four nearest.
  const sample = (lon: number, lat: number): number => {
    const [gx, gy] = globalPixel(lon, lat, TERRAIN_ZOOM).map((v) => v - 0.5);
    const x0 = Math.floor(gx!);
    const y0 = Math.floor(gy!);
    const fx = gx! - x0;
    const fy = gy! - y0;
    const v = (dx: number, dy: number) => Math.max(TERRAIN_FLOOR, pixel(x0 + dx, y0 + dy));
    return (v(0, 0) * (1 - fx) + v(1, 0) * fx) * (1 - fy) + (v(0, 1) * (1 - fx) + v(1, 1) * fx) * fy;
  };
  const unproject = makeUnprojector(ORIGIN);
  const [sx, sy] = project(box[1], box[0]);
  const [ex, ey] = project(box[3], box[2]);
  const x0 = Math.floor(sx / TERRAIN_STEP) * TERRAIN_STEP;
  const y0 = Math.floor(sy / TERRAIN_STEP) * TERRAIN_STEP;
  const cols = Math.ceil((ex - x0) / TERRAIN_STEP) + 1;
  const rows = Math.ceil((ey - y0) / TERRAIN_STEP) + 1;
  const heights = new Int16Array(cols * rows);
  let lo = Infinity;
  let hi = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = sample(...unproject(x0 + c * TERRAIN_STEP, y0 + r * TERRAIN_STEP));
      heights[r * cols + c] = Math.round(h * 10);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  const prefix = area === CENTRAL ? "" : `${area.id}.`;
  stats[`${prefix}terrain.lowest`] = Math.round(lo);
  stats[`${prefix}terrain.highest`] = Math.round(hi);
  stats[`${prefix}terrain.points`] = cols * rows;
  return {
    data: {
      version: 1,
      area: area.id,
      x0,
      y0,
      step: TERRAIN_STEP,
      cols,
      rows,
      h: Buffer.from(heights.buffer).toString("base64"),
    },
    stats,
  };
}

function buildSubjects(): Subject[] {
  if (!hasSnapshot("uoa-calendar/courses.html")) return [];
  const html = readSnapshot("uoa-calendar/courses.html").toString("utf8");
  const subjects = new Map<string, Subject>();
  const section = /<h2 id="[^"]*">([^<]+)<\/h2>\s*<\/div>\s*<div class="text section">([\s\S]*?)<\/div>/g;
  for (let m = section.exec(html); m; m = section.exec(html)) {
    const faculty = decodeEntities(m[1]!).trim();
    const lines = m[2]!
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .split("\n");
    for (const raw of lines) {
      const line = decodeEntities(raw).replace(/\s+/g, " ").trim();
      const s = /^([A-ZĀĒĪŌŪ]{2,10})\s+[–-]\s+(.+)$/u.exec(line);
      if (!s) continue;
      const code = s[1]!;
      if (!subjects.has(code)) subjects.set(code, { code, name: { en: s[2]!.trim() }, faculty: { en: faculty } });
    }
  }
  return [...subjects.values()].sort((a, z) => a.code.localeCompare(z.code));
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function snapshotDate(source: string): string {
  const times = manifest()
    .filter((s) => s.source === source)
    .map((s) => s.fetchedAt)
    .sort();
  const latest = times[times.length - 1];
  return latest ? aucklandWallTime(new Date(latest)).date : "";
}

function write(name: string, value: unknown): number {
  const file = path.join(OUT, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value);
  fs.writeFileSync(file, text + "\n");
  return text.length;
}

const { data: campus, index, plans, stats: campusStats } = buildCampus();
// One file of surroundings per area: the central one loads with the map, the others when a
// campus or building in them is shown.
const contexts = areaBoxes.map((box) => ({ area: box.area, ...buildContext(campus, box) }));
const contextStats = Object.assign({}, ...contexts.map((c) => c.stats)) as Record<string, number>;
// The ground under each area, where its elevation tiles have been taken.
const terrains = areaBoxes.map((box) => ({ area: box.area, ...buildTerrain(box.area) }));
Object.assign(contextStats, ...terrains.map((t) => t.stats));
const subjects = buildSubjects();
const calendar = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "academic-calendar.json"), "utf8")) as AcademicCalendar;

const classSnapshots = loadClassSnapshots();
const { schedule, stats: scheduleStats } = buildSchedule(classSnapshots, campus, index, snapshotDate("uoa-classes"));

const count = (p: Schedule["sessions"][number]["precision"]) => schedule.sessions.filter((s) => s.precision === p).length;
const coverage: Coverage = {
  buildings: campus.buildings.length,
  buildingsOnMap: campus.buildings.filter((b) => !b.offMap).length,
  rooms: campus.rooms.length,
  indexedRooms: Object.values(index).reduce((n, l) => n + l.length, 0),
  planShapes: campus.buildings.reduce((n, b) => n + (b.planShapes ?? 0), 0),
  subjects: subjects.length,
  courses: schedule.courses.length,
  sessions: schedule.sessions.length,
  sessionsLocatedToRoom: count("room"),
  sessionsLocatedToFloor: count("floor"),
  sessionsLocatedToBuilding: count("building"),
  sessionsExcluded: schedule.exclusions.length,
};

const sources: SourceInfo[] = [
  {
    id: "mapsindoors",
    name: "University of Auckland campus maps (maps.auckland.ac.nz)",
    url: "https://maps.auckland.ac.nz/",
    licence: "© University of Auckland. Public campus map; building, floor and room positions derived from it, outlines simplified.",
    snapshotDate: snapshotDate("mapsindoors"),
    provides: "Buildings, floors, room codes, room types and room positions",
  },
  {
    id: "osm",
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    licence: "© OpenStreetMap contributors, Open Database License (ODbL) 1.0",
    snapshotDate: snapshotDate("osm"),
    provides: "Surrounding buildings, streets, paths, parks and trees",
  },
  {
    id: "uoa-calendar",
    name: "University of Auckland Calendar 2026 (key dates and course codes)",
    url: "https://www.auckland.ac.nz/en/about-us/about-the-university/the-university/official-publications/university-calendar/current-calendar.html",
    licence: "© University of Auckland. Dates and subject codes are quoted as facts with a link to the source.",
    snapshotDate: snapshotDate("uoa-calendar"),
    provides: "Semester dates, breaks, holidays and the list of subject codes",
  },
];
if (terrains.some((t) => t.data)) {
  sources.push({
    id: "terrain",
    name: "Land Information New Zealand 8 m Digital Elevation Model (2012), via the AWS Terrain Tiles",
    url: "https://registry.opendata.aws/terrain-tiles/",
    licence:
      "New Zealand terrain data © Land Information New Zealand and the New Zealand Government, CC BY 3.0 NZ; tiles by Mapzen/Tilezen, with SRTM, GMTED2010 (U.S. Geological Survey) and ETOPO1 (U.S. NOAA) data at the coast.",
    snapshotDate: snapshotDate("terrain"),
    provides: "The height of the ground under the map",
  });
}
if (schedule.available) {
  sources.push({
    id: "uoa-classes",
    name: "University of Auckland Classes API v2",
    url: "https://developer.auckland.ac.nz/prd/documentation/api-classes-v2",
    licence: "© University of Auckland. Retrieved with the site maintainer's own API credentials.",
    snapshotDate: snapshotDate("uoa-classes"),
    provides: "Timetabled classes: course, day, time, date range and room",
  });
}

const meta: Meta = { version: 1, generatedAt: campus.generatedAt, sources, coverage };

// One file per building, so opening a building loads only its own floors. The folder is rebuilt
// whole: a building that lost its plan must not keep an old file.
fs.rmSync(path.join(OUT, "plans"), { recursive: true, force: true });
const planBytes = plans.reduce((n, plan) => n + write(`plans/${plan.building}.json`, plan), 0);
fs.rmSync(path.join(OUT, "context"), { recursive: true, force: true });
fs.rmSync(path.join(OUT, "terrain"), { recursive: true, force: true });
const terrainBytes = Object.fromEntries(terrains.filter((t) => t.data).map((t) => [`terrain/${t.area.id}.json`, write(`terrain/${t.area.id}.json`, t.data)]));
const contextBytes = Object.fromEntries(
  contexts.map((c) => {
    const file = c.area === CENTRAL ? "context.json" : `context/${c.area.id}.json`;
    return [file, write(file, c.data)];
  }),
);

const sizes = {
  [`plans/ (${plans.length} files)`]: planBytes,
  "campus.json": write("campus.json", campus),
  ...contextBytes,
  ...terrainBytes,
  "rooms-index.json": write("rooms-index.json", index),
  "subjects.json": write("subjects.json", subjects),
  "calendar.json": write("calendar.json", calendar),
  "schedule.json": write("schedule.json", schedule),
  "meta.json": write("meta.json", meta),
};

console.log("coverage", coverage);
console.log("stats", { ...campusStats, ...contextStats, ...scheduleStats });
console.log("bytes", sizes);
