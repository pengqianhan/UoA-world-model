// Finding a way on foot across the map: a grid over the ground, where buildings and water are
// blocked and every other cell costs what it takes to walk there (a footpath least, open ground
// more), searched with A* and drawn as a few straight legs. Pure, so that it can be tested
// without a browser. The ground's own paths are OpenStreetMap's; where people really walk between
// them, and where the doors are, is not known.
import type { Pt } from "./geo.ts";

/** A walking grid: cells `cell` metres square from (x0, y0), metres east and north. */
export interface WalkGrid {
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  /** Cost to walk a metre through each cell; Infinity where nobody can walk. Row-major from the south-west. */
  cost: Float32Array;
}

/** Costs per metre walked. Footpaths and steps are the way people are meant to go. */
export const WALK_COST = {
  path: 1,
  service: 1.15,
  street: 1.25,
  major: 1.6,
  motorway: 25,
  green: 1.45,
  open: 2.1,
  rail: 6,
} as const;

/** The cheapest cost there is, which keeps the A* estimate from ever over-guessing. */
const MIN_COST = 1;

export function makeGrid(box: [number, number, number, number], cell: number, fill: number = WALK_COST.open): WalkGrid {
  const [x0, y0, x1, y1] = box;
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell));
  const rows = Math.max(1, Math.ceil((y1 - y0) / cell));
  return { x0, y0, cell, cols, rows, cost: new Float32Array(cols * rows).fill(fill) };
}

export function cellOf(g: WalkGrid, p: Pt): [number, number] {
  return [Math.floor((p[0] - g.x0) / g.cell), Math.floor((p[1] - g.y0) / g.cell)];
}

export function centreOf(g: WalkGrid, c: number, r: number): Pt {
  return [g.x0 + (c + 0.5) * g.cell, g.y0 + (r + 0.5) * g.cell];
}

function inside(g: WalkGrid, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows;
}

/**
 * Calls `each` for every cell whose centre lies inside a polygon (outer ring and holes, even-odd),
 * row by row along the scanline through the cell centres.
 */
export function scanPolygon(g: WalkGrid, rings: readonly (readonly Pt[])[], each: (index: number) => void): void {
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const ring of rings) for (const [, y] of ring) (ymin = Math.min(ymin, y)), (ymax = Math.max(ymax, y));
  const r0 = Math.max(0, Math.floor((ymin - g.y0) / g.cell - 0.5));
  const r1 = Math.min(g.rows - 1, Math.ceil((ymax - g.y0) / g.cell - 0.5));
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const y = g.y0 + (r + 0.5) * g.cell;
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[i]!;
        const [bx, by] = ring[j]!;
        if (ay > y !== by > y) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k]! - g.x0) / g.cell - 0.5));
      const c1 = Math.min(g.cols - 1, Math.floor((xs[k + 1]! - g.x0) / g.cell - 0.5));
      for (let c = c0; c <= c1; c++) each(r * g.cols + c);
    }
  }
}

/**
 * Blocks every cell a polygon covers any part of: the cells whose centres lie inside it, and the
 * cells its edges cross, so that a straight leg past a corner cannot clip the wall.
 */
export function blockPolygon(g: WalkGrid, rings: readonly (readonly Pt[])[]): void {
  scanPolygon(g, rings, (i) => (g.cost[i] = Infinity));
  const step = g.cell / 4;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j]!;
      const [bx, by] = ring[i]!;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 0; k <= n; k++) {
        const [c, r] = cellOf(g, [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
        if (inside(g, c, r)) g.cost[r * g.cols + c] = Infinity;
      }
    }
  }
}

/** Lowers the cost inside a polygon to `value`, leaving cheaper and blocked cells as they are. */
export function paintPolygon(g: WalkGrid, rings: readonly (readonly Pt[])[], value: number): void {
  scanPolygon(g, rings, (i) => {
    if (g.cost[i]! > value && g.cost[i]! !== Infinity) g.cost[i] = value;
  });
}

/**
 * Sets the cost along a line of the given width, metres. `value` replaces dearer open cells; a
 * cheaper way already painted there (a footbridge over a motorway) keeps its cost, and blocked
 * cells stay blocked.
 */
export function paintLine(g: WalkGrid, line: readonly Pt[], width: number, value: number): void {
  const half = Math.max(width / 2, g.cell * 0.5);
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, ay] = line[k]!;
    const [bx, by] = line[k + 1]!;
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - g.x0) / g.cell));
    const c1 = Math.min(g.cols - 1, Math.floor((Math.max(ax, bx) + half - g.x0) / g.cell));
    const r0 = Math.max(0, Math.floor((Math.min(ay, by) - half - g.y0) / g.cell));
    const r1 = Math.min(g.rows - 1, Math.floor((Math.max(ay, by) + half - g.y0) / g.cell));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const [px, py] = centreOf(g, c, r);
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const ex = ax + t * dx - px;
        const ey = ay + t * dy - py;
        if (ex * ex + ey * ey > half * half) continue;
        const i = r * g.cols + c;
        const cur = g.cost[i]!;
        if (cur === Infinity) continue;
        // A dear way (a motorway, a railway) takes over open ground, but a cheaper way on the same
        // ground (a footbridge over the motorway) keeps its cost. Costs are stored as 32-bit
        // floats, so compare with a little slack.
        if (value < cur - 1e-4 || (value > cur && cur >= WALK_COST.open - 1e-3)) g.cost[i] = value;
      }
    }
  }
}

/** The free cell nearest a point, searching outwards ring by ring; undefined if none is near. */
export function nearestFree(g: WalkGrid, p: Pt, maxRings = 60): [number, number] | undefined {
  const [c0, r0] = cellOf(g, p);
  if (inside(g, c0, r0) && g.cost[r0 * g.cols + c0]! !== Infinity) return [c0, r0];
  let best: [number, number] | undefined;
  let bestD = Infinity;
  for (let ring = 1; ring <= maxRings; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (!inside(g, c, r) || g.cost[r * g.cols + c]! === Infinity) continue;
        const [x, y] = centreOf(g, c, r);
        const d = Math.hypot(x - p[0], y - p[1]);
        if (d < bestD) (bestD = d), (best = [c, r]);
      }
    }
    if (best) return best;
  }
  return undefined;
}

/** Where a walk ends: a point, or any of a set of cells (round a building), with a point to aim for. */
export type WalkGoal = { at: Pt } | { cells: Uint8Array; aim: Pt };

/** Cells within `reach` metres of a polygon and free to stand in: the ground round a building. */
export function cellsAround(g: WalkGrid, rings: readonly (readonly Pt[])[], reach: number): Uint8Array {
  const mask = new Uint8Array(g.cols * g.rows);
  const inner = new Uint8Array(g.cols * g.rows);
  scanPolygon(g, rings, (i) => (inner[i] = 1));
  const k = Math.max(1, Math.ceil(reach / g.cell));
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (!inner[r * g.cols + c]) continue;
      for (let dr = -k; dr <= k; dr++) {
        for (let dc = -k; dc <= k; dc++) {
          const cc = c + dc;
          const rr = r + dr;
          if (!inside(g, cc, rr)) continue;
          const i = rr * g.cols + cc;
          if (!inner[i] && g.cost[i]! !== Infinity && dc * dc + dr * dr <= k * k) mask[i] = 1;
        }
      }
    }
  }
  return mask;
}

/** A small binary heap of cell indices keyed by a float priority. */
class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, key: number): void {
    const a = this.items;
    const k = this.keys;
    a.push(item);
    k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= key) break;
      a[i] = a[p]!;
      k[i] = k[p]!;
      i = p;
    }
    a[i] = item;
    k[i] = key;
  }
  pop(): number {
    const a = this.items;
    const k = this.keys;
    const top = a[0]!;
    const item = a.pop()!;
    const key = k.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mk = key;
        if (l < a.length && k[l]! < mk) (m = l), (mk = k[l]!);
        if (r < a.length && k[r]! < mk) (m = r), (mk = k[r]!);
        if (m === i) break;
        a[i] = a[m]!;
        k[i] = k[m]!;
        i = m;
      }
      a[i] = item;
      k[i] = key;
    }
    return top;
  }
}

const STEPS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * The cheapest way from `from` to the goal through free cells, 8-connected without cutting a
 * blocked corner, as cell centres. Undefined when the goal cannot be reached.
 */
export function findCells(g: WalkGrid, from: Pt, goal: WalkGoal): [number, number][] | undefined {
  const start = nearestFree(g, from);
  if (!start) return undefined;
  const n = g.cols * g.rows;
  let target: number | undefined;
  let mask: Uint8Array | undefined;
  let aim: Pt;
  if ("at" in goal) {
    const end = nearestFree(g, goal.at);
    if (!end) return undefined;
    target = end[1] * g.cols + end[0];
    aim = centreOf(g, end[0], end[1]);
  } else {
    mask = goal.cells;
    aim = goal.aim;
  }
  const isGoal = (i: number) => (mask ? mask[i] === 1 : i === target);
  // With a set of cells the estimate is to the nearest of them; a cell's distance to the aim
  // less the set's radius round it never over-guesses.
  let slack = 0;
  if (mask) {
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const [x, y] = centreOf(g, i % g.cols, Math.floor(i / g.cols));
      slack = Math.max(slack, Math.hypot(x - aim[0], y - aim[1]));
    }
  }
  const h = (i: number) => {
    const [x, y] = centreOf(g, i % g.cols, Math.floor(i / g.cols));
    return Math.max(0, Math.hypot(x - aim[0], y - aim[1]) - slack) * MIN_COST;
  };
  const best = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const s = start[1] * g.cols + start[0];
  best[s] = 0;
  const open = new Heap();
  open.push(s, h(s));
  while (open.size) {
    const i = open.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (isGoal(i)) {
      const cells: [number, number][] = [];
      for (let k = i; k !== -1; k = came[k]!) cells.push([k % g.cols, Math.floor(k / g.cols)]);
      return cells.reverse();
    }
    const c = i % g.cols;
    const r = Math.floor(i / g.cols);
    const here = g.cost[i]!;
    for (const [dc, dr, len] of STEPS) {
      const cc = c + dc;
      const rr = r + dr;
      if (!inside(g, cc, rr)) continue;
      const j = rr * g.cols + cc;
      const there = g.cost[j]!;
      if (there === Infinity || closed[j]) continue;
      if (dc && dr && (g.cost[r * g.cols + cc]! === Infinity || g.cost[rr * g.cols + c]! === Infinity)) continue;
      const d = best[i]! + len * g.cell * ((here + there) / 2);
      if (d < best[j]!) {
        best[j] = d;
        came[j] = i;
        open.push(j, d + h(j));
      }
    }
  }
  return undefined;
}

/**
 * Whether a straight leg from a to b stays on free cells no dearer than `limit`, sampled every
 * quarter cell.
 */
export function clearLeg(g: WalkGrid, a: Pt, b: Pt, limit: number): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(len / (g.cell / 4)));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const [c, r] = cellOf(g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    if (!inside(g, c, r)) return false;
    const v = g.cost[r * g.cols + c]!;
    if (v === Infinity || v > limit + 1e-6) return false;
  }
  return true;
}

/**
 * Cell centres as a few straight legs: from each turning point, the leg runs on to the furthest
 * point it can reach without leaving free cells or taking to dearer ground than the cells it
 * replaces, so a way along a footpath keeps to the footpath.
 */
export function straighten(g: WalkGrid, cells: readonly [number, number][]): Pt[] {
  const pts = cells.map(([c, r]) => centreOf(g, c, r));
  if (pts.length <= 2) return pts;
  const costAt = (p: Pt) => {
    const [c, r] = cellOf(g, p);
    return g.cost[r * g.cols + c]!;
  };
  const out: Pt[] = [pts[0]!];
  let i = 0;
  while (i < pts.length - 1) {
    let limit = Math.max(costAt(pts[i]!), costAt(pts[i + 1]!));
    let j = i + 1;
    while (j + 1 < pts.length) {
      const next = Math.max(limit, costAt(pts[j + 1]!));
      if (!clearLeg(g, pts[i]!, pts[j + 1]!, next)) break;
      limit = next;
      j++;
    }
    out.push(pts[j]!);
    i = j;
  }
  return out;
}

/** Length of a line in metres. */
export function lineLength(line: readonly Pt[]): number {
  let d = 0;
  for (let k = 0; k + 1 < line.length; k++) d += Math.hypot(line[k + 1]![0] - line[k]![0], line[k + 1]![1] - line[k]![1]);
  return d;
}
