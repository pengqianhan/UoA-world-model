import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../src/scene/geometry.ts";
import { encodeRing } from "../src/shared/geo.ts";

const square = encodeRing([
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]);

describe("an extrusion's roof", () => {
  it("goes to a second material group when asked, after the walls", () => {
    const mb = new MeshBuilder(true, true);
    mb.extrude([square], 0, 3.6, undefined, undefined, true, { roofGroup: true });
    mb.extrude([square], 3.6, 7.2, undefined, undefined, true, { roofGroup: true, bottom: true });
    const g = mb.build();
    // Each block: four walls of two triangles. The second also has an underside, which is not a roof.
    const walls = 2 * 4 * 6 + 6;
    expect(g.groups).toEqual([
      { start: 0, count: walls, materialIndex: 0 },
      { start: walls, count: 2 * 6, materialIndex: 1 },
    ]);
    // Every triangle of the roof group lies flat at the top of a block and faces up.
    const index = g.getIndex()!;
    const position = g.getAttribute("position");
    const normal = g.getAttribute("normal");
    for (let i = walls; i < index.count; i++) {
      const v = index.getX(i);
      expect([3.6, 7.2]).toContain(Math.round(position.getY(v) * 10) / 10);
      expect(normal.getY(v)).toBe(1);
    }
  });

  it("stays in the one group otherwise", () => {
    const mb = new MeshBuilder();
    mb.extrude([square], 0, 3.6);
    const g = mb.build();
    expect(g.groups).toEqual([]);
    expect(g.getIndex()!.count).toBe(4 * 6 + 6);
  });
});

describe("a parapet", () => {
  it("is two faces back to back, one lit from each side, and no roof", () => {
    const mb = new MeshBuilder(true, true);
    mb.fence(0, 0, 10, 0, 3.6, 4.5);
    const g = mb.build();
    expect(g.getIndex()!.count).toBe(12);
    expect(g.groups).toEqual([]);
    const normal = g.getAttribute("normal");
    const position = g.getAttribute("position");
    // Heading east with the roof on the left, which is north: one face looks south (+z), the other north.
    expect([0, 1, 2, 3].map((i) => normal.getZ(i))).toEqual([1, 1, 1, 1]);
    expect([4, 5, 6, 7].map((i) => normal.getZ(i))).toEqual([-1, -1, -1, -1]);
    expect(Math.min(...Array.from({ length: 8 }, (_, i) => position.getY(i)))).toBeCloseTo(3.6, 6);
    expect(Math.max(...Array.from({ length: 8 }, (_, i) => position.getY(i)))).toBeCloseTo(4.5, 6);
    // Each face is wound to be seen from the side its normal points to.
    const index = g.getIndex()!;
    for (const start of [0, 6]) {
      const [a, b, c] = [0, 1, 2].map((k) => index.getX(start + k));
      const ux = position.getX(b!) - position.getX(a!);
      const uy = position.getY(b!) - position.getY(a!);
      const vx = position.getX(c!) - position.getX(a!);
      const vy = position.getY(c!) - position.getY(a!);
      expect(Math.sign(ux * vy - uy * vx)).toBe(normal.getZ(a!));
    }
  });
});
