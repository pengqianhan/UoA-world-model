// The shape of a building seen from outside: its floors stacked, each with its own outline, and
// floors that are alike standing as one block. The outlines are the campus map's; the heights are
// the display convention of one storey per level.
import type { Building, FlatRing } from "./types.ts";

/** A run of floors drawn with one outline, as a block between two heights in metres. */
export interface MassingBlock {
  /** Polygons with holes: [polygon][ring] -> FlatRing. */
  outline: FlatRing[][];
  y0: number;
  y1: number;
}

/**
 * Blocks from the ground up. Floors below entry level are left out, as the ground is drawn flat.
 * A mezzanine sits inside the storey under it and does not cut that storey in two; a mezzanine
 * above the top floor is a half-height block on the roof.
 */
export function massing(b: Building, floorHeight: number): MassingBlock[] {
  const levels: { i: number; outline: FlatRing[][] }[] = [];
  // A floor without its own outline repeats the one below it, basements included. A floor marked
  // as alike to a lower one is drawn with that floor's outline.
  let outline: FlatRing[][] | undefined;
  const drawn = new Map<number, FlatRing[][]>();
  for (const f of b.floors) {
    if (f.outline) outline = f.outline;
    if (f.i < 0) continue;
    const shape = (f.stackWith !== undefined ? drawn.get(f.stackWith) : undefined) ?? outline ?? [b.outline];
    drawn.set(f.i, shape);
    levels.push({ i: f.i, outline: shape });
  }
  const base = levels[0]?.i;
  if (base === undefined) return [{ outline: [b.outline], y0: 0, y1: b.height }];

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
      let twice = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        twice += ring[i * 2]! * ring[j * 2 + 1]! - ring[j * 2]! * ring[i * 2 + 1]!;
      }
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
