// The shape of a building seen from outside: its floors stacked, each with its own outline, and
// floors that are alike standing as one block. The outlines are the campus map's; the heights are
// the display convention of one storey per level.
import { decodeRing, pointInRing } from "./geo.ts";
import type { Building, FlatRing } from "./types.ts";

/** A run of floors drawn with one outline, as a block between two heights in metres. */
export interface MassingBlock {
  /** Polygons with holes: [polygon][ring] -> FlatRing. */
  outline: FlatRing[][];
  y0: number;
  y1: number;
}

/** Metres. A part of an outline no wider than a wall is thick is not a storey but a join in the drawing. */
const MIN_WIDTH = 0.3;
/** Metres two sides of an outline run alongside each other before the floor between is a strip. */
const MIN_STRIP = 2;
/** Radians from opposite that the two sides of a strip may point. */
const STRIP_ANGLE = 0.35;
/** Square metres under which a piece left at the end of a strip goes with it. */
const MIN_PIECE = 1;

/** Twice the signed area of a flat ring, in square decimetres; positive when counter-clockwise. */
function twiceArea(ring: FlatRing): number {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2]! * ring[j * 2 + 1]! - ring[j * 2]! * ring[i * 2 + 1]!;
  }
  return a;
}

function reversed(ring: FlatRing): FlatRing {
  const out: number[] = [];
  for (let i = ring.length - 2; i >= 0; i -= 2) out.push(ring[i]!, ring[i + 1]!);
  return out;
}

/**
 * Whether sides i and j of a counter-clockwise ring are the two sides of a strip of floor: they
 * run opposite ways alongside each other for MIN_STRIP or more, with side j on the floor's side of
 * side i and nowhere further from it than MIN_WIDTH. Returns how far they run alongside, or 0.
 */
function stripSides(ring: FlatRing, i: number, j: number): number {
  const n = ring.length / 2;
  const x = (k: number) => ring[(k % n) * 2]! / 10;
  const y = (k: number) => ring[(k % n) * 2 + 1]! / 10;
  const ux = x(i + 1) - x(i);
  const uy = y(i + 1) - y(i);
  const vx = x(j + 1) - x(j);
  const vy = y(j + 1) - y(j);
  const len = Math.hypot(ux, uy);
  const other = Math.hypot(vx, vy);
  if (len < MIN_STRIP || other < MIN_STRIP) return 0;
  if ((ux * vx + uy * vy) / (len * other) > -Math.cos(STRIP_ANGLE)) return 0;
  // Side j's ends measured along side i, and out to its left, where the floor is.
  const along = (k: number) => ((x(k) - x(i)) * ux + (y(k) - y(i)) * uy) / len;
  const left = (k: number) => ((y(k) - y(i)) * ux - (x(k) - x(i)) * uy) / len;
  const [tc, td, sc, sd] = [along(j), along(j + 1), left(j), left(j + 1)];
  const t0 = Math.max(0, td);
  const t1 = Math.min(len, tc);
  if (t1 - t0 < MIN_STRIP) return 0;
  const gap = (t: number) => sd + ((sc - sd) * (t - td)) / (tc - td);
  return [gap(t0), gap(t1)].every((g) => g > 0 && g <= MIN_WIDTH) ? t1 - t0 : 0;
}

/**
 * A counter-clockwise ring cut into the pieces left once each strip in it is taken out. The two
 * sides of a strip go, and the floor at either end of it closes on a short new side.
 */
function cutStrips(ring: FlatRing): FlatRing[] {
  const n = ring.length / 2;
  const whole = twiceArea(ring) / 200;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if ((j + 1) % n === i) continue;
      const alongside = stripSides(ring, i, j);
      if (!alongside) continue;
      const pieces = [ring.slice((i + 1) * 2, (j + 1) * 2), [...ring.slice((j + 1) * 2), ...ring.slice(0, (i + 1) * 2)]];
      const areas = pieces.map((p) => twiceArea(p) / 200);
      // A cut that turns a piece inside out, or takes more floor than a strip holds, is not a strip.
      const cut = whole - areas[0]! - areas[1]!;
      if (areas.some((a) => a < -0.01) || cut < 0 || cut > MIN_WIDTH * alongside) continue;
      return pieces.filter((p, k) => p.length >= 6 && areas[k]! >= MIN_PIECE).flatMap(cutStrips);
    }
  }
  return [ring];
}

/**
 * A storey's outline without the strips of floor no wider than MIN_WIDTH in it: the same array
 * when it has none. The campus map draws some floors as pieces joined by such a strip. The ground
 * floor of the Southern Underpass (331) is its two stairways, joined by a strip about 0.1 m wide
 * that runs 40 m along the passage under Symonds Street: drawn as a storey, it stands on the street
 * as a wall.
 */
export function withoutStrips(outline: FlatRing[][]): FlatRing[][] {
  let changed = false;
  const out = outline.flatMap((poly) => {
    const [outer, ...holes] = poly;
    if (!outer) return [poly];
    const ccw = twiceArea(outer) >= 0 ? outer : reversed(outer);
    const pieces = cutStrips(ccw);
    if (pieces.length === 1 && pieces[0] === ccw) return [poly];
    changed = true;
    return pieces.map((piece) => {
      const ring = decodeRing(piece);
      return [piece, ...holes.filter((h) => pointInRing([h[0]! / 10, h[1]! / 10], ring))];
    });
  });
  // An outline that is all strip is left as drawn.
  return changed && out.length ? out : outline;
}

/**
 * Blocks from the ground up. Floors below entry level are left out, as the ground is drawn flat.
 * A mezzanine sits inside the storey under it and does not cut that storey in two; a mezzanine
 * above the top floor is a half-height block on the roof. Strips of floor no thicker than a wall are
 * left out (see withoutStrips).
 */
export function massing(b: Building, floorHeight: number): MassingBlock[] {
  const levels: { i: number; outline: FlatRing[][] }[] = [];
  // A floor without its own outline repeats the one below it, basements included. A floor marked
  // as alike to a lower one is drawn with that floor's outline.
  let outline: FlatRing[][] | undefined;
  const drawn = new Map<number, FlatRing[][]>();
  // Floors that repeat an outline share one array, which is how alike storeys are seen to be one block.
  const cleaned = new Map<FlatRing[][], FlatRing[][]>();
  const clean = (o: FlatRing[][]) => {
    let c = cleaned.get(o);
    if (!c) cleaned.set(o, (c = withoutStrips(o)));
    return c;
  };
  for (const f of b.floors) {
    if (f.outline) outline = f.outline;
    if (f.i < 0) continue;
    const shape = (f.stackWith !== undefined ? drawn.get(f.stackWith) : undefined) ?? clean(outline ?? [b.outline]);
    drawn.set(f.i, shape);
    levels.push({ i: f.i, outline: shape });
  }
  const base = levels[0]?.i;
  if (base === undefined) return [{ outline: withoutStrips([b.outline]), y0: 0, y1: b.height }];

  const y = (i: number) => ((i - base) / 10) * floorHeight;
  const full = levels.filter((l) => (l.i - base) % 10 === 0);
  const blocks: MassingBlock[] = [];
  const add = (block: MassingBlock) => {
    const below = blocks[blocks.length - 1];
    if (below && below.outline === block.outline && below.y1 === block.y0) below.y1 = block.y1;
    else blocks.push(block);
  };
  full.forEach((l, k) => {
    const next = full[k + 1];
    add({ outline: l.outline, y0: y(l.i), y1: next ? y(next.i) : y(l.i) + floorHeight });
  });
  const top = levels[levels.length - 1]!;
  const roof = blocks[blocks.length - 1]!.y1;
  if (y(top.i) + floorHeight > roof) add({ outline: top.outline, y0: roof, y1: y(top.i) + floorHeight });
  return blocks;
}

/** A stretch of roof edge in metres, [x0, y0, x1, y1] east and north, with the roof on its left. */
export type RimSegment = [number, number, number, number];

/** Metres between the points where an edge is tested for a roof behind it. */
const RIM_STEP = 2;
/** Metres in from the edge where the test is made: a ledge narrower than this gets no rim. */
const RIM_INSET = 0.6;

function inside(shape: readonly FlatRing[][], x: number, y: number): boolean {
  for (const poly of shape) {
    let hit = false;
    for (const ring of poly) {
      const n = ring.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = ring[i * 2]! / 10;
        const ay = ring[i * 2 + 1]! / 10;
        const bx = ring[j * 2]! / 10;
        const by = ring[j * 2 + 1]! / 10;
        if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) hit = !hit;
      }
    }
    if (hit) return true;
  }
  return false;
}

/**
 * The edges of a block's roof that stand in the open: every edge of the top block, and for a
 * block with another on it, the stretches where the roof behind the edge is not built over.
 * A parapet is drawn along these. Where the block above rises flush from the edge there is none.
 */
export function roofRims(block: MassingBlock, above?: MassingBlock): RimSegment[] {
  const out: RimSegment[] = [];
  for (const poly of block.outline) {
    poly.forEach((ring, r) => {
      const n = ring.length / 2;
      if (n < 3) return;
      const twice = twiceArea(ring);
      // Walk outer rings counter-clockwise and holes clockwise, which puts the roof on the left.
      const forward = r === 0 ? twice > 0 : twice < 0;
      for (let k = 0; k < n; k++) {
        const i = forward ? k : n - 1 - k;
        const j = forward ? (k + 1) % n : (n - 2 - k + n) % n;
        const ax = ring[i * 2]! / 10;
        const ay = ring[i * 2 + 1]! / 10;
        const bx = ring[j * 2]! / 10;
        const by = ring[j * 2 + 1]! / 10;
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1e-3) continue;
        if (!above) {
          out.push([ax, ay, bx, by]);
          continue;
        }
        // Left of the direction of travel is into the roof.
        const nx = (-(by - ay) / len) * RIM_INSET;
        const ny = ((bx - ax) / len) * RIM_INSET;
        const steps = Math.max(1, Math.round(len / RIM_STEP));
        let from = -1;
        for (let s = 0; s <= steps; s++) {
          const t = (s + 0.5) / steps;
          const open = s < steps && !inside(above.outline, ax + (bx - ax) * t + nx, ay + (by - ay) * t + ny);
          if (open && from < 0) from = s;
          if (!open && from >= 0) {
            out.push([ax + ((bx - ax) * from) / steps, ay + ((by - ay) * from) / steps, ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
            from = -1;
          }
        }
      }
    });
  }
  return out;
}

/**
 * The level a building is entered at from the street, which stands on the ground: its lowest floor
 * at or above index 0, or index 0 itself for a building that lies wholly below ground.
 */
export function groundLevel(b: Building): number {
  return b.floors.find((f) => f.i >= 0)?.i ?? 0;
}
