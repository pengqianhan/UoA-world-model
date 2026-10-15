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
    expect(g.groups).toEqual([{ start: 0, count: 4 * 6 + 6, materialIndex: 0 }]);
    expect(g.getIndex()!.count).toBe(4 * 6 + 6);
  });

  it("leaves walls with no roof in a group of their own, which a mesh with a wall and a roof material draws", () => {
    // The open floor's outer walls fall back to fences of no thickness where its outline cannot be inset.
    const mb = new MeshBuilder(true, true);
    mb.fence(0, 0, 10, 0, 0, 1.5);
    const g = mb.build();
    expect(g.groups).toEqual([{ start: 0, count: 2 * 6, materialIndex: 0 }]);
  });
});

describe("a parapet", () => {
  it("is two faces back to back, one lit from each side, and no roof", () => {
    const mb = new MeshBuilder(true, true);
    mb.fence(0, 0, 10, 0, 3.6, 4.5);
    const g = mb.build();
    expect(g.getIndex()!.count).toBe(12);
    expect(g.groups.map((group) => group.materialIndex)).toEqual([0]);
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

describe("the ground storey of an extrusion", () => {
  const wall = [0.96, 0.95, 0.93] as const;
  const plinth = { top: 3.6, color: [0.86, 0.85, 0.83] as const };
  /** Colour and height of every wall vertex: those whose normal is level. */
  const wallVertices = (mb: MeshBuilder) => {
    const out: { y: number; v: number; red: number }[] = [];
    for (let i = 0; i < mb.vertexCount; i++) {
      if (mb.normals[i * 3 + 1] !== 0) continue;
      out.push({ y: mb.positions[i * 3 + 1]!, v: mb.uvs[i * 2 + 1]!, red: mb.colors[i * 3]! });
    }
    return out;
  };

  it("is tinted apart from the storeys above it, with the storeys still counted from the ground", () => {
    const mb = new MeshBuilder(true, true);
    mb.extrude([square], 0, 10.8, undefined, wall, true, { storey: 3.6, bay: 3.2, plinth });
    const vs = wallVertices(mb);
    // Four walls, each in two bands of four vertices.
    expect(vs.length).toBe(4 * 2 * 4);
    for (const { y, v, red } of vs) {
      expect(v).toBeCloseTo(y / 3.6, 6);
      if (y < 3.6 - 1e-6) expect(red).toBeCloseTo(0.86, 6);
      if (y > 3.6 + 1e-6) expect(red).toBeCloseTo(0.96, 6);
    }
    expect(vs.filter((p) => Math.abs(p.y - 3.6) < 1e-6).map((p) => p.red).sort()).toEqual([...Array(8).fill(0.86), ...Array(8).fill(0.96)].map((n) => expect.closeTo(n, 6)));
  });
  it("covers a block that is no taller than the ground storey", () => {
    const mb = new MeshBuilder(true, true);
    mb.extrude([square], 0, 3.6, undefined, wall, true, { storey: 3.6, plinth });
    const vs = wallVertices(mb);
    expect(vs.length).toBe(4 * 4);
    for (const { red } of vs) expect(red).toBeCloseTo(0.86, 6);
  });
  it("leaves a block that starts above it alone", () => {
    const mb = new MeshBuilder(true, true);
    mb.extrude([square], 3.6, 7.2, undefined, wall, true, { storey: 3.6, plinth });
    const vs = wallVertices(mb);
    expect(vs.length).toBe(4 * 4);
    for (const { red } of vs) expect(red).toBeCloseTo(0.96, 6);
  });
});
