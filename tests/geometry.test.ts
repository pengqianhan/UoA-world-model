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
