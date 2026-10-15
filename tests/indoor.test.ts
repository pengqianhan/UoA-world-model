import { describe, expect, it } from "vitest";
import { IndoorMap, spaceAt, type FloorSpace } from "../src/shared/indoor.ts";
import type { Pt } from "../src/shared/geo.ts";

const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const space = (rings: Pt[][], kind: FloorSpace["kind"], extra: Partial<FloorSpace> = {}): FloorSpace => {
  const a = rings[0]![0]!;
  const b = rings[0]![2]!;
  return { rings, kind, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], area: Math.abs((b[0] - a[0]) * (b[1] - a[1])), ...extra };
};

describe("a way inside a floor", () => {
  // A floor 40 m by 20 m: a corridor along the south side, three rooms along the north.
  const a = space([box(0, 10, 10, 20)], "room", { code: "999-101" });
  const office = space([box(10, 10, 30, 20)], "office");
  const c = space([box(30, 10, 40, 20)], "room", { code: "999-103" });
  const stairs = space([box(36, 0, 40, 4)], "stairs", { icon: "stairs" });
  const floor = new IndoorMap([[box(0, 0, 40, 20)]], [a, office, c, stairs]);

  it("keeps to the corridor rather than crossing a room on the way", () => {
    const plan = floor.planTo([5, 15], [35, 15])!;
    expect(plan).toBeDefined();
    // Every turning point between the two rooms lies in the corridor, south of y = 10.
    for (const [x, y] of plan.points) if (x > 11 && x < 29) expect(y).toBeLessThan(10.5);
    expect(plan.metres).toBeGreaterThan(30);
  });

  it("stays on the floor, finds the room a point is in, and the nearest stairs", () => {
    expect(floor.contains([20, 5])).toBe(true);
    expect(floor.contains([45, 5])).toBe(false);
    const on = floor.nearestOn([45, 5])!;
    expect(floor.contains(on)).toBe(true);
    expect(spaceAt(floor.spaces, [5, 15])?.code).toBe("999-101");
    expect(floor.nearestSign([20, 5], ["stairs", "lift"])).toBe(stairs);
  });
});
