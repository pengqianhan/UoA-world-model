import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeRing, overlap, ringArea, type Ring } from "../src/shared/geo.ts";
import { massing, roofRims, type MassingBlock, type RimSegment } from "../src/shared/massing.ts";
import type { Building, CampusData, FlatRing, Floor } from "../src/shared/types.ts";

const campus = JSON.parse(fs.readFileSync("public/data/campus.json", "utf8")) as CampusData;
const H = campus.floorHeight;

const square = (size: number): FlatRing => [0, 0, size, 0, size, size, 0, size];
const building = (floors: Floor[], height: number): Building => ({
  id: "T",
  campus: "test",
  name: { en: "Test" },
  sourceText: "Test",
  outline: [square(400)],
  center: [20, 20],
  floors,
  height,
  heightSource: "floor-count",
  roomCount: 0,
});
const area = (block: MassingBlock) => block.outline.reduce((sum, poly) => sum + ringArea(decodeRing(poly[0]!)), 0);
/** A rectangle in metres as a flat ring in decimetres. */
const rect = (x0: number, y0: number, x1: number, y1: number): FlatRing => [x0, y0, x1, y0, x1, y1, x0, y1].map((v) => v * 10);
const block = (outline: FlatRing[][], y0 = 0, y1 = 3.6): MassingBlock => ({ outline, y0, y1 });
const length = (rims: RimSegment[]) => rims.reduce((sum, [ax, ay, bx, by]) => sum + Math.hypot(bx - ax, by - ay), 0);

describe("building massing from floor outlines", () => {
  it("stacks floors with their own outlines and merges floors that share one", () => {
    const podium = [[square(400)]];
    const tower = [[square(100)]];
    const b = building([{ i: 0, name: "G", outline: podium }, { i: 10, name: "1", outline: tower }, { i: 20, name: "2" }, { i: 30, name: "3" }], 4 * H);
    expect(massing(b, H)).toEqual([
      { outline: podium, y0: 0, y1: H },
      { outline: tower, y0: H, y1: 4 * H },
    ]);
  });
  it("leaves basements out but lets the ground floor inherit a basement's outline", () => {
    const basement = [[square(300)]];
    const b = building([{ i: -10, name: "B", outline: basement }, { i: 0, name: "G" }, { i: 10, name: "1" }], 2 * H);
    expect(massing(b, H)).toEqual([{ outline: basement, y0: 0, y1: 2 * H }]);
  });
  it("keeps a storey whole when a mezzanine sits inside it", () => {
    const ground = [[square(400)]];
    const mezzanine = [[square(50)]];
    const upper = [[square(300)]];
    const b = building([{ i: 0, name: "G", outline: ground }, { i: 5, name: "M", outline: mezzanine }, { i: 10, name: "1", outline: upper }], 2 * H);
    expect(massing(b, H)).toEqual([
      { outline: ground, y0: 0, y1: H },
      { outline: upper, y0: H, y1: 2 * H },
    ]);
  });
  it("puts a mezzanine above the top floor on the roof as a half storey", () => {
    const full = [[square(400)]];
    const plant = [[square(50)]];
    const b = building([{ i: 0, name: "G", outline: full }, { i: 10, name: "1" }, { i: 15, name: "1M", outline: plant }], 2.5 * H);
    expect(massing(b, H)).toEqual([
      { outline: full, y0: 0, y1: 2 * H },
      { outline: plant, y0: 2 * H, y1: 2.5 * H },
    ]);
  });
  it("draws floors marked as alike with the outline of the floor they are stacked with", () => {
    const base = [[square(400)]];
    const nearly = [[square(398)]];
    const tower = [[square(100)]];
    const b = building(
      [
        { i: 0, name: "G", outline: base },
        { i: 10, name: "1", outline: nearly, stackWith: 0 },
        // Repeats the floor below, which is alike to the ground floor, so it is marked too.
        { i: 20, name: "2", stackWith: 0 },
        { i: 30, name: "3", outline: tower },
        { i: 40, name: "4", outline: [[square(99)]], stackWith: 30 },
      ],
      5 * H,
    );
    expect(massing(b, H)).toEqual([
      { outline: base, y0: 0, y1: 3 * H },
      { outline: tower, y0: 3 * H, y1: 5 * H },
    ]);
  });
  it("falls back to the footprint for a building with nothing at or above entry level", () => {
    const b = building([{ i: -10, name: "B", outline: [[square(300)]] }], 1.2);
    expect(massing(b, H)).toEqual([{ outline: [b.outline], y0: 0, y1: 1.2 }]);
  });

  it("gives every published building a gapless stack that ends at its height", () => {
    for (const b of campus.buildings) {
      const blocks = massing(b, H);
      expect(blocks.length, b.id).toBeGreaterThan(0);
      expect(blocks[0]!.y0, b.id).toBe(0);
      blocks.forEach((block, k) => {
        expect(block.y1, b.id).toBeGreaterThan(block.y0);
        if (k > 0) expect(block.y0, b.id).toBeCloseTo(blocks[k - 1]!.y1, 6);
      });
      // Building.height is rounded to a decimetre.
      expect(Math.abs(blocks[blocks.length - 1]!.y1 - b.height), b.id).toBeLessThan(0.06);
    }
  });
  it("shows the podium and tower of the Science Centre and the stepped General Library", () => {
    const blocks = (id: string) => massing(campus.buildings.find((b) => b.id === id)!, H);
    const science = blocks("303");
    expect(science.length).toBeGreaterThan(2);
    expect(area(science[science.length - 1]!)).toBeLessThan(area(science[0]!) / 2);
    const library = blocks("109");
    expect(area(library[library.length - 1]!)).toBeLessThan(area(library[0]!) / 4);
  });
  it("stacks only floors that are alike, and leaves no two alike blocks one on the other", () => {
    const shape = (outline: FlatRing[][]): Ring[][] => outline.map((poly) => poly.map(decodeRing));
    let marked = 0;
    for (const b of campus.buildings) {
      const entry = b.floors.find((f) => f.i >= 0)?.i;
      // The outline each floor has in effect: its own, or the one it repeats from the floor below.
      const effective = new Map<number, FlatRing[][]>();
      let current: FlatRing[][] | undefined;
      for (const f of b.floors) {
        if (f.outline) current = f.outline;
        effective.set(f.i, current ?? [b.outline]);
      }
      for (const f of b.floors) {
        if (f.stackWith === undefined) continue;
        marked++;
        expect(f.stackWith, `${b.id} ${f.name}`).toBeLessThan(f.i);
        expect(f.stackWith, `${b.id} ${f.name}`).toBeGreaterThanOrEqual(entry!);
        expect((f.i - entry!) % 10, `${b.id} ${f.name} is a full level`).toBe(0);
        expect((f.stackWith - entry!) % 10, `${b.id} ${f.name} stacks with a full level`).toBe(0);
        expect(overlap(shape(effective.get(f.stackWith)!), shape(effective.get(f.i)!)), `${b.id} ${f.name}`).toBeGreaterThanOrEqual(0.95);
      }
      const blocks = massing(b, H).filter((block) => block.y1 - block.y0 >= H - 1e-6);
      for (let k = 1; k < blocks.length; k++) {
        if (blocks[k]!.outline === blocks[k - 1]!.outline) continue;
        expect(overlap(shape(blocks[k - 1]!.outline), shape(blocks[k]!.outline)), `${b.id} blocks ${k - 1} and ${k}`).toBeLessThan(0.95);
      }
    }
    expect(marked).toBeGreaterThan(150);
  });
  it("draws University Hall's fourteen alike floors as one block", () => {
    const hall = massing(campus.buildings.find((b) => b.id === "440")!, H);
    expect(hall.length).toBe(3);
    expect((hall[2]!.y1 - hall[2]!.y0) / H).toBeCloseTo(14, 6);
  });
  it("finds real shape in about half of the buildings on the map", () => {
    const onMap = campus.buildings.filter((b) => !b.offMap);
    const stepped = onMap.filter((b) => massing(b, H).length > 1);
    expect(stepped.length / onMap.length).toBeGreaterThan(0.4);
  });
});

describe("the edges of a roof that stand in the open", () => {
  it("are all of them on a block with nothing on it, courtyard included", () => {
    expect(length(roofRims(block([[rect(0, 0, 40, 20)]])))).toBeCloseTo(120, 6);
    expect(length(roofRims(block([[rect(0, 0, 40, 40), rect(10, 10, 30, 30)]])))).toBeCloseTo(160 + 80, 6);
  });
  it("keep the roof on the left of each stretch, whichever way the ring was drawn", () => {
    const clockwise = [0, 0, 0, 200, 400, 200, 400, 0];
    for (const ring of [rect(0, 0, 40, 20), clockwise]) {
      for (const [ax, ay, bx, by] of roofRims(block([[ring]]))) {
        const len = Math.hypot(bx - ax, by - ay);
        // A step to the left of the middle of the stretch lands on the roof.
        const x = (ax + bx) / 2 - ((by - ay) / len) * 1;
        const y = (ay + by) / 2 + ((bx - ax) / len) * 1;
        expect(x > 0 && x < 40 && y > 0 && y < 20, `${ax},${ay} to ${bx},${by}`).toBe(true);
      }
    }
  });
  it("go all the way round a podium whose tower stands back from every edge", () => {
    const podium = block([[rect(0, 0, 40, 40)]]);
    const tower = block([[rect(10, 10, 30, 30)]], 3.6, 7.2);
    expect(length(roofRims(podium, tower))).toBeCloseTo(160, 6);
    expect(length(roofRims(tower))).toBeCloseTo(80, 6);
  });
  it("stop where the block above rises flush from the edge", () => {
    const podium = block([[rect(0, 0, 40, 40)]]);
    // Flush with the west edge between 10 m and 30 m north.
    const tower = block([[rect(0, 10, 20, 30)]], 3.6, 7.2);
    const rims = roofRims(podium, tower);
    expect(length(rims)).toBeCloseTo(160 - 20, 6);
    const west = rims.filter(([ax, , bx]) => ax === 0 && bx === 0).map(([, ay, , by]) => [Math.min(ay, by), Math.max(ay, by)]);
    expect(west.sort((a, b) => a[0]! - b[0]!)).toEqual([
      [0, 10],
      [30, 40],
    ]);
  });
  it("leave out a ledge too narrow to stand on", () => {
    const lower = block([[rect(0, 0, 40, 20)]]);
    const upper = block([[rect(0.3, 0.3, 39.7, 19.7)]], 3.6, 7.2);
    expect(roofRims(lower, upper)).toEqual([]);
  });
  it("are never longer than the outlines they run along, on every published building", () => {
    let total = 0;
    for (const b of campus.buildings) {
      const blocks = massing(b, H);
      blocks.forEach((bl, k) => {
        const rims = roofRims(bl, blocks[k + 1]);
        const around = bl.outline.reduce((sum, poly) => sum + poly.reduce((s, ring) => s + length(decodeRing(ring).map((p, i, all) => [...p, ...all[(i + 1) % all.length]!] as RimSegment)), 0), 0);
        expect(length(rims), `${b.id} block ${k}`).toBeLessThanOrEqual(around + 1e-6);
        for (const seg of rims) for (const v of seg) expect(Number.isFinite(v), b.id).toBe(true);
        // The top block shows its whole edge.
        if (k === blocks.length - 1) expect(length(rims), `${b.id} top`).toBeCloseTo(around, 4);
        total += length(rims);
      });
    }
    expect(total).toBeGreaterThan(10_000);
  });
});
