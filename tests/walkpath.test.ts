import { describe, expect, it } from "vitest";
import { encodeRing, pointInRing, type Pt } from "../src/shared/geo.ts";
import { WalkMap, distanceToRing } from "../src/shared/walkmap.ts";
import { WALK_COST, blockPolygon, cellsAround, clearLeg, findCells, lineLength, makeGrid, paintLine, straighten } from "../src/shared/walkpath.ts";
import type { Building, ContextData } from "../src/shared/types.ts";

const square = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** True when a polyline, sampled every 20 cm, never enters the ring. */
function staysOut(line: Pt[], ring: Pt[]): boolean {
  for (let k = 0; k + 1 < line.length; k++) {
    const [a, b] = [line[k]!, line[k + 1]!];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (pointInRing([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ring)) return false;
    }
  }
  return true;
}

function building(id: string, ring: Pt[]): Building {
  return {
    id,
    campus: "city",
    name: { en: `Building ${id}` },
    sourceText: id,
    outline: [encodeRing(ring)],
    center: [(ring[0]![0] + ring[2]![0]) / 2, (ring[0]![1] + ring[2]![1]) / 2],
    floors: [{ i: 0, name: "G" }],
    height: 3.6,
    heightSource: "floor-count",
    roomCount: 0,
  };
}

describe("a way on foot across the grid", () => {
  it("goes round a building, never through it", () => {
    const g = makeGrid([0, 0, 100, 100], 1);
    const block = square(40, 10, 60, 90);
    blockPolygon(g, [block]);
    const cells = findCells(g, [10, 50], { at: [90, 50] })!;
    expect(cells).toBeDefined();
    const line = straighten(g, cells);
    expect(staysOut(line, block)).toBe(true);
    // Round the short way, past one end of the block: no more than the detour needs.
    expect(lineLength(line)).toBeGreaterThan(80);
    expect(lineLength(line)).toBeLessThan(130);
  });

  it("keeps to a footpath where open ground costs more", () => {
    const g = makeGrid([0, 0, 120, 60], 1, WALK_COST.open);
    // A footpath round three sides of a field, and the field itself open ground.
    const path: Pt[] = [
      [5, 5],
      [5, 50],
      [115, 50],
      [115, 5],
    ];
    paintLine(g, path, 3, WALK_COST.path);
    const line = straighten(g, findCells(g, [5, 5], { at: [115, 5] })!);
    // Across the field is 110 m on ground costing 2.1 a metre; the path is 200 m at 1.
    expect(lineLength(line)).toBeGreaterThan(190);
  });

  it("crosses a motorway only where a footbridge does", () => {
    const g = makeGrid([0, 0, 100, 100], 1, WALK_COST.open);
    paintLine(g, [[0, 50], [100, 50]], 16, WALK_COST.motorway);
    // The footbridge is painted after the motorway, as the map paints it, and wins.
    paintLine(g, [[80, 20], [80, 80]], 3, WALK_COST.path);
    const line = straighten(g, findCells(g, [20, 20], { at: [20, 80] })!);
    const crossing = line.find((p) => p[1] > 45 && p[1] < 55);
    const legs = line.map((p, k) => (k ? [line[k - 1]!, p] : null)).filter((x): x is [Pt, Pt] => !!x);
    const xAtMotorway = legs.filter(([a, b]) => (a[1] - 50) * (b[1] - 50) <= 0).map(([a, b]) => a[0] + ((50 - a[1]) / (b[1] - a[1] || 1)) * (b[0] - a[0]));
    expect(crossing ?? xAtMotorway.length).toBeTruthy();
    for (const x of xAtMotorway) expect(Math.abs(x - 80)).toBeLessThan(3);
  });

  it("finds no way into a closed courtyard", () => {
    const g = makeGrid([0, 0, 60, 60], 1);
    blockPolygon(g, [square(10, 10, 50, 50), square(20, 20, 40, 40)]);
    // The ring of building round the courtyard is blocked; the courtyard itself is free.
    expect(findCells(g, [2, 2], { at: [30, 30] })).toBeUndefined();
  });

  it("ends beside a building when the walk is to the building", () => {
    const g = makeGrid([0, 0, 100, 100], 1);
    const block = square(60, 40, 80, 60);
    blockPolygon(g, [block]);
    const cells = cellsAround(g, [block], 2.5);
    const end = straighten(g, findCells(g, [5, 50], { cells, aim: [70, 50] })!).at(-1)!;
    expect(distanceToRing(end, block)).toBeLessThan(2.6);
    // The near side, facing the walker.
    expect(end[0]).toBeLessThan(61);
  });

  it("straight legs never leave free ground", () => {
    const g = makeGrid([0, 0, 50, 50], 1);
    blockPolygon(g, [square(20, 0, 25, 40)]);
    const line = straighten(g, findCells(g, [5, 5], { at: [45, 5] })!);
    for (let k = 0; k + 1 < line.length; k++) expect(clearLeg(g, line[k]!, line[k + 1]!, Infinity)).toBe(true);
  });
});

describe("the walking map", () => {
  const a = square(0, 0, 40, 30);
  const b = square(100, 0, 140, 30);
  const context: ContextData = {
    version: 1,
    origin: { lat: 0, lon: 0 },
    attribution: "",
    buildings: [
      { p: encodeRing(square(60, -20, 80, 50)), h: 10 },
      // A part that starts 6 m up, like a bridge between two buildings, is walked under.
      { p: encodeRing(square(40, 10, 100, 20)), h: 12, b: 6 },
    ],
    roads: [],
    areas: [{ k: "water", p: encodeRing(square(60, 60, 200, 200)) }],
    rails: [],
    trees: [],
    deciduous: [],
  };
  const map = new WalkMap([building("101", a), building("102", b)], 3.6, context);

  it("plans a walk from one building to the side of another, round what stands between", () => {
    const plan = map.planToBuilding([-5, 15], "102")!;
    expect(plan).toBeDefined();
    const end = plan.points.at(-1)!;
    expect(map.distanceTo(end, "102")).toBeLessThan(2.6);
    for (const ring of [a, b, square(60, -20, 80, 50), square(60, 60, 200, 200)]) expect(staysOut(plan.points, ring)).toBe(true);
    expect(plan.metres).toBeGreaterThan(100);
  });

  it("finds the first wall on a line, for the camera behind a walker", () => {
    // From the gap between the two buildings, west into 101's east wall at x = 40.
    expect(map.wallAlong([50, 5], [30, 5])).toBeCloseTo(0.5);
    // The surrounding building at 60-80 is a wall too; the bridge, 6 m up, is not.
    expect(map.wallAlong([50, 15], [70, 15])).toBeCloseTo(0.5);
    // Water and open ground are no wall.
    expect(map.wallAlong([50, 55], [50, 90])).toBeUndefined();
  });

  it("knows which building's ground a point is on", () => {
    expect(map.buildingAt([10, 10])).toBe("101");
    expect(map.buildingAt([50, 15])).toBeUndefined();
  });
});
