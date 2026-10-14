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
