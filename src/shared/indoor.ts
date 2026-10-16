// Finding a way inside a building, on one floor: a grid over the floor's outline, where the open
// floor and the spaces the campus map leaves undescribed (corridors, mostly) are cheap, and the
// other rooms and spaces are dear, as walls with no known doors. The campus map has no doors, so a
// walk inside can only keep to where corridors probably are; it says so. Pure, so that it can be
// tested without a browser.
import { decodeRing, interiorPoint, pointInRing, type Pt, type Ring } from "./geo.ts";
import { withoutStrips } from "./massing.ts";
import type { Building, FlatRing, FloorPlans, Room, SpaceKind } from "./types.ts";
import { centreOf, findCells, lineLength, makeGrid, nearestFree, scanPolygon, straighten, type WalkGrid } from "./walkpath.ts";
import type { WalkPlan } from "./walkmap.ts";

/** Metres per cell of the grid inside a floor. */
const CELL = 0.4;
/** What crossing a room or space that is not the start or the end costs, a metre: a wall with no door. */
const THROUGH_ROOM = 7;
const THROUGH_STAIRS = 1.6;

/** A space on a floor: a room that can be selected, or a shape of the floor plan with its type. */
export interface FloorSpace {
  rings: Ring[];
  kind: SpaceKind | "room";
  /** Room code, for a room that can be selected. */
  code?: string;
  name?: string;
  /** The campus map's type, for a shape. */
  type?: string;
  icon?: string;
  /** A point inside it. */
  at: Pt;
  area: number;
}

/** A floor's outline as polygons with holes, as the floor is drawn in building view. */
export function floorRings(b: Building, index: number): Ring[][] {
  let outline: FlatRing[][] | undefined;
  for (const f of b.floors) {
    if (f.outline) outline = f.outline;
    if (f.i === index) break;
  }
  return withoutStrips(outline ?? [b.outline]).map((poly) => poly.map((ring) => decodeRing(ring)));
}

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] + r[i]![0]) * (r[j]![1] - r[i]![1]);
  return Math.abs(a) / 2;
}

/** The spaces of one floor: its rooms, and the shapes of its floor plan when it has one. */
export function floorSpaces(rooms: readonly Room[], plans: FloorPlans | undefined, index: number): FloorSpace[] {
  const out: FloorSpace[] = [];
  for (const r of rooms) {
    if (r.f !== index) continue;
    const ring = decodeRing(r.poly);
    out.push({ rings: [ring], kind: "room", code: r.code, name: r.name.en, at: r.c, area: r.area });
  }
  const shapes = plans?.floors[index] ?? [];
  const types = plans?.typeOf[index] ?? [];
  shapes.forEach((shape, k) => {
    const rings = shape.map((ring) => decodeRing(ring));
    const type = plans!.types[types[k]!];
    if (!rings[0] || !type) return;
    out.push({ rings, kind: type.kind, type: type.text, icon: type.icon, at: interiorPoint(rings[0]), area: ringArea(rings[0]) });
  });
  return out;
}

/** The innermost space holding a point: the smallest of those that do. */
export function spaceAt(spaces: readonly FloorSpace[], p: Pt): FloorSpace | undefined {
  let best: FloorSpace | undefined;
  for (const s of spaces) {
    const [outer, ...holes] = s.rings;
    if (!outer || !pointInRing(p, outer) || holes.some((h) => pointInRing(p, h))) continue;
    if (!best || s.area < best.area) best = s;
  }
  return best;
}

export class IndoorMap {
  readonly grid: WalkGrid;

  constructor(
    readonly outline: Ring[][],
    readonly spaces: FloorSpace[],
  ) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const poly of outline) {
      for (const [x, y] of poly[0] ?? []) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    const g = makeGrid([x0 - 1, y0 - 1, x1 + 1, y1 + 1], CELL, Infinity);
    // The floor is walkable; everything off it is not.
    for (const poly of outline) scanPolygon(g, poly, (i) => (g.cost[i] = 1));
    this.grid = g;
  }

  /** Whether a point is on the floor. */
  contains(p: Pt): boolean {
    return this.outline.some(([outer, ...holes]) => !!outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h)));
  }

  /** The point on the floor nearest a point, a cell or more in from its walls. */
  nearestOn(p: Pt): Pt | undefined {
    const g = this.grid;
    const free = (c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.cost[r * g.cols + c]! !== Infinity;
    const clear = (c: number, r: number) => {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (!free(c + dc, r + dr)) return false;
      return true;
    };
    const c0 = Math.floor((p[0] - g.x0) / g.cell);
    const r0 = Math.floor((p[1] - g.y0) / g.cell);
    const reach = Math.max(g.cols, g.rows);
    for (let ring = 0; ring <= reach; ring++) {
      let best: [number, number] | undefined;
      let bestD = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring || !clear(c0 + dc, r0 + dr)) continue;
          const d = dc * dc + dr * dr;
          if (d < bestD) (bestD = d), (best = [c0 + dc, r0 + dr]);
        }
      }
      if (best) return centreOf(g, best[0], best[1]);
    }
    const cell = nearestFree(g, p, reach);
    return cell ? centreOf(g, cell[0], cell[1]) : undefined;
  }

  /**
   * A way across the floor. Rooms and spaces other than the ones the walk starts and ends in are
   * dear to cross, so the way keeps to corridors where it can.
   */
  planTo(from: Pt, to: Pt): WalkPlan | undefined {
    const g: WalkGrid = { ...this.grid, cost: new Float32Array(this.grid.cost) };
    const start = spaceAt(this.spaces, from);
    const end = spaceAt(this.spaces, to);
    for (const s of this.spaces) {
      if (s === start || s === end || s.kind === "other") continue;
      const dear = s.kind === "stairs" ? THROUGH_STAIRS : THROUGH_ROOM;
      scanPolygon(g, s.rings, (i) => {
        if (g.cost[i]! !== Infinity && g.cost[i]! < dear) g.cost[i] = dear;
      });
    }
    // The start and end spaces are walked in freely, even where another lies over them.
    for (const s of [start, end]) if (s) scanPolygon(g, s.rings, (i) => g.cost[i]! !== Infinity && (g.cost[i] = 1));
    const cells = findCells(g, from, { at: to });
    if (!cells) return undefined;
    const points = straighten(g, cells);
    points[0] = from;
    return { points, metres: lineLength(points) };
  }

  /** The nearest space with one of these signs (stairs, lift), by straight distance. */
  nearestSign(p: Pt, icons: readonly string[]): FloorSpace | undefined {
    let best: FloorSpace | undefined;
    let bestD = Infinity;
    for (const s of this.spaces) {
      if (!s.icon || !icons.includes(s.icon)) continue;
      const d = Math.hypot(s.at[0] - p[0], s.at[1] - p[1]);
      if (d < bestD) (bestD = d), (best = s);
    }
    return best;
  }
}
