// What a walker on the map walks round and along: the University buildings as they stand on the
// ground, the surrounding buildings, water, and OpenStreetMap's paths and streets. Builds a
// walking grid (walkpath.ts) for any box of the map on demand and plans walks across it.
import { bbox, decodeRing, pointInRing, type Pt, type Ring } from "./geo.ts";
import { massing } from "./massing.ts";
import type { Building, ContextData, RoadClass } from "./types.ts";
import {
  WALK_COST,
  blockPolygon,
  cellsAround,
  centreOf,
  findCells,
  lineLength,
  makeGrid,
  paintLine,
  nearestFree,
  paintPolygon,
  straighten,
  type WalkGrid,
} from "./walkpath.ts";

/** Metres per grid cell for a walk; a longer walk gets coarser cells so the grid stays small. */
const CELL = 1.5;
const MAX_CELLS = 1_400_000;
/** Metres of map round the two ends of a walk that the search may use, at first. */
const MARGIN = 220;
/** How the box widens when the way round lies outside it. */
const WIDEN = [1, 2.5, 5] as const;
/** A walk to a building ends this close to its walls, metres. */
export const ARRIVE_REACH = 2.5;

const ROAD_COST: Record<RoadClass, number> = {
  path: WALK_COST.path,
  steps: WALK_COST.path,
  service: WALK_COST.service,
  street: WALK_COST.street,
  major: WALK_COST.major,
  motorway: WALK_COST.motorway,
};
/** Widths a little wider than drawn, so that a footpath beside a street is part of the way. */
const ROAD_WIDTH: Record<RoadClass, number> = { motorway: 16, major: 13, street: 10, service: 5, path: 3, steps: 3 };

interface Shape {
  rings: Ring[];
  box: [number, number, number, number];
}
interface Line {
  pts: Pt[];
  box: [number, number, number, number];
  k: RoadClass | "rail";
}

/** A walk planned across the map: the legs to follow and how far that is. */
export interface WalkPlan {
  points: Pt[];
  metres: number;
}

function shapeOf(rings: Ring[]): Shape {
  return { rings, box: bbox(rings[0]!) };
}

function overlaps(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Distance from a point to the edges of a ring, metres; 0 inside it. */
export function distanceToRing(p: Pt, ring: Ring): number {
  if (pointInRing(p, ring)) return 0;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]!;
    const [bx, by] = ring[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]));
  }
  return best;
}

export class WalkMap {
  /** University buildings by id: what stands on the ground of each. */
  readonly footprints = new Map<string, Ring[][]>();
  private obstacles: Shape[] = [];
  /** The buildings among the obstacles, which a camera behind a walker keeps in front of. */
  private walls: Shape[] = [];
  private greens: Shape[] = [];
  private lines: Line[] = [];

  constructor(buildings: readonly Building[], floorHeight: number, context?: ContextData) {
    for (const b of buildings) {
      if (b.offMap) continue;
      // What stands on the ground: the lowest block of the building as drawn from outside, which
      // leaves out a passage under a street (the Southern Underpass) and strips no wider than a wall.
      const block = massing(b, floorHeight)[0];
      const polys = (block?.outline ?? [b.outline]).map((poly) => poly.map((ring) => decodeRing(ring)));
      this.footprints.set(b.id, polys);
      for (const rings of polys) if (rings[0]?.length) this.obstacles.push(shapeOf(rings));
    }
    this.walls = [...this.obstacles];
    if (!context) return;
    for (const cb of context.buildings) {
      // A part that starts above the ground (an overhang, a bridge) is walked under.
      if (cb.b) continue;
      const shape = shapeOf([decodeRing(cb.p)]);
      this.obstacles.push(shape);
      this.walls.push(shape);
    }
    for (const a of context.areas) {
      const rings = [decodeRing(a.p)];
      if (a.k === "water") this.obstacles.push(shapeOf(rings));
      else this.greens.push(shapeOf(rings));
    }
    for (const r of context.roads) {
      const pts = decodeRing(r.p);
      this.lines.push({ pts, box: bbox(pts), k: r.k });
    }
    for (const rail of context.rails) {
      const pts = decodeRing(rail);
      this.lines.push({ pts, box: bbox(pts), k: "rail" });
    }
    // A mapped tree's trunk is in the way; its crown is not. Each is a small square round the point.
    const trunk = 0.45;
    for (const list of [context.trees, context.deciduous ?? []]) {
      for (let i = 0; i + 1 < list.length; i += 2) {
        const x = list[i]! / 10;
        const y = list[i + 1]! / 10;
        this.obstacles.push(shapeOf([[[x - trunk, y - trunk], [x + trunk, y - trunk], [x + trunk, y + trunk], [x - trunk, y + trunk]]]));
      }
    }
  }

  /** The walking grid over a box of the map, metres east and north. */
  grid(box: [number, number, number, number], cell = CELL): WalkGrid {
    let size = cell;
    while (((box[2] - box[0]) / size) * ((box[3] - box[1]) / size) > MAX_CELLS) size *= 1.5;
    const g = makeGrid(box, size);
    for (const s of this.greens) if (overlaps(s.box, box)) paintPolygon(g, s.rings, WALK_COST.green);
    // Dear ways first, so that a footpath over a motorway (a footbridge) paints over it.
    const order = (k: Line["k"]) => (k === "motorway" ? 0 : k === "rail" ? 1 : 2);
    const lines = this.lines.filter((l) => overlaps([l.box[0] - 10, l.box[1] - 10, l.box[2] + 10, l.box[3] + 10], box));
    lines.sort((a, b) => order(a.k) - order(b.k));
    for (const l of lines) paintLine(g, l.pts, l.k === "rail" ? 3 : ROAD_WIDTH[l.k], l.k === "rail" ? WALK_COST.rail : ROAD_COST[l.k]);
    for (const s of this.obstacles) if (overlaps(s.box, box)) blockPolygon(g, s.rings);
    return g;
  }

  /** The box a walk between two points may search: both ends with room round them. */
  static boxFor(a: Pt, b: Pt, margin = MARGIN): [number, number, number, number] {
    return [Math.min(a[0], b[0]) - margin, Math.min(a[1], b[1]) - margin, Math.max(a[0], b[0]) + margin, Math.max(a[1], b[1]) + margin];
  }

  /**
   * A walk from a point to a point. Undefined when there is no way on foot. The search starts in
   * a box round the two ends and widens it when the way round lies outside.
   */
  planTo(from: Pt, to: Pt): WalkPlan | undefined {
    for (const widen of WIDEN) {
      const g = this.grid(WalkMap.boxFor(from, to, MARGIN * widen));
      const cells = findCells(g, from, { at: to });
      if (!cells) continue;
      const points = straighten(g, cells);
      points[0] = from;
      return { points, metres: lineLength(points) };
    }
    return undefined;
  }

  /** A walk from a point to the ground beside a University building. */
  planToBuilding(from: Pt, id: string): WalkPlan | undefined {
    const polys = this.footprints.get(id);
    if (!polys?.length) return undefined;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const rings of polys) {
      const [a, b, c, d] = bbox(rings[0]!);
      x0 = Math.min(x0, a);
      y0 = Math.min(y0, b);
      x1 = Math.max(x1, c);
      y1 = Math.max(y1, d);
    }
    const aim: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
    for (const widen of WIDEN) {
      const g = this.grid(WalkMap.boxFor(from, aim, MARGIN * widen + Math.max(x1 - x0, y1 - y0) / 2));
      const cells = new Uint8Array(g.cols * g.rows);
      for (const rings of polys) {
        const ring = cellsAround(g, rings, ARRIVE_REACH);
        for (let i = 0; i < ring.length; i++) if (ring[i]) cells[i] = 1;
      }
      const found = findCells(g, from, { cells, aim });
      if (!found) continue;
      const points = straighten(g, found);
      points[0] = from;
      return { points, metres: lineLength(points) };
    }
    return undefined;
  }

  /** The free ground nearest a point: where a walker can stand. Undefined when none is near. */
  freeNear(p: Pt, reach = 60): Pt | undefined {
    const g = this.grid([p[0] - reach, p[1] - reach, p[0] + reach, p[1] + reach], 1);
    const cell = nearestFree(g, p, Math.ceil(reach));
    return cell ? centreOf(g, cell[0], cell[1]) : undefined;
  }

  /**
   * Somewhere to stand near a point with room round it, `clearance` metres of free ground every
   * way, facing the way that is open furthest: where a walker starts, not nose to a wall.
   */
  openNear(p: Pt, reach = 60, clearance = 3): { at: Pt; heading: number } | undefined {
    const g = this.grid([p[0] - reach - 130, p[1] - reach - 130, p[0] + reach + 130, p[1] + reach + 130], 1);
    const free = (c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.cost[r * g.cols + c]! !== Infinity;
    const k = Math.ceil(clearance);
    const roomy = (c: number, r: number) => {
      for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) if (dc * dc + dr * dr <= k * k && !free(c + dc, r + dr)) return false;
      return true;
    };
    const [c0, r0] = [Math.floor((p[0] - g.x0) / g.cell), Math.floor((p[1] - g.y0) / g.cell)];
    let spot: [number, number] | undefined;
    for (let ring = 0; ring <= reach && !spot; ring++) {
      let bestD = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (!roomy(c, r)) continue;
          const d = dc * dc + dr * dr;
          if (d < bestD) (bestD = d), (spot = [c, r]);
        }
      }
    }
    spot ??= nearestFree(g, p, reach);
    if (!spot) return undefined;
    const at = centreOf(g, spot[0], spot[1]);
    // The way that is open furthest, out to 120 m, in steps of 15 degrees.
    let heading = 0;
    let longest = -1;
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      let d = 0;
      while (d < 120) {
        const [c, r] = [Math.floor((at[0] + Math.sin(rad) * (d + 1) - g.x0) / g.cell), Math.floor((at[1] + Math.cos(rad) * (d + 1) - g.y0) / g.cell)];
        if (!free(c, r)) break;
        d++;
      }
      if (d > longest) (longest = d), (heading = deg);
    }
    return { at, heading };
  }

  /** The University building whose ground a point stands on, if any. */
  buildingAt(p: Pt): string | undefined {
    for (const [id, polys] of this.footprints) {
      for (const [outer, ...holes] of polys) {
        if (outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h))) return id;
      }
    }
    return undefined;
  }

  /**
   * How far along the line from `from` to `to` (0 to 1) it first meets the wall of a building, or
   * undefined when it meets none. The camera behind a walker stops short of that wall.
   */
  wallAlong(from: Pt, to: Pt): number | undefined {
    const box: [number, number, number, number] = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.max(from[0], to[0]), Math.max(from[1], to[1])];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    let first: number | undefined;
    for (const s of this.walls) {
      if (!overlaps(s.box, box)) continue;
      for (const ring of s.rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [ax, ay] = ring[j]!;
          const [bx, by] = ring[i]!;
          const ex = bx - ax;
          const ey = by - ay;
          const den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((ax - from[0]) * ey - (ay - from[1]) * ex) / den;
          const u = ((ax - from[0]) * dy - (ay - from[1]) * dx) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (first === undefined || t < first)) first = t;
        }
      }
    }
    return first;
  }

  /** Metres from a point to a University building's walls; 0 inside. */
  distanceTo(p: Pt, id: string): number {
    let best = Infinity;
    for (const [outer] of this.footprints.get(id) ?? []) if (outer) best = Math.min(best, distanceToRing(p, outer));
    return best;
  }
}
