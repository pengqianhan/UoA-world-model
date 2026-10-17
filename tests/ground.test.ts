import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry } from "three";
import {
  DASH,
  DASH_PERIOD,
  EDGE_LINE_IN,
  GROUND,
  KERB_FACE,
  KERB_TOP,
  LINE_FADE,
  LINE_STOP,
  LINE_WIDTH,
  MARKINGS,
  ROAD_WIDTH,
  SURFACE,
  areaSurface,
  box,
  kerbPart,
  lineCover,
  pulse,
  roadSurface,
  type GroundKind,
} from "../src/scene/street/roads.ts";
import { GROUND_LAYERS, GROUND_TILE, groundLayers, groundVariation, packGround, packSurfaces } from "../src/scene/street/surfaces.ts";
import { MeshBuilder, drape, levelSlope } from "../src/scene/geometry.ts";
import { Terrain } from "../src/scene/terrain.ts";
import { streetLighting } from "../src/scene/street/light.ts";
import { encodeRing } from "../src/shared/geo.ts";
import type { RoadClass, TerrainData } from "../src/shared/types.ts";

/** A grid of heights from a function of metres east and north, as the pipeline publishes one. */
function grid(cols: number, rows: number, step: number, x0: number, y0: number, f: (x: number, y: number) => number): TerrainData {
  const h = new Int16Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = Math.round(f(x0 + c * step, y0 + r * step) * 10);
  return { version: 1, area: "test", x0, y0, step, cols, rows, h: Buffer.from(new Uint8Array(h.buffer)).toString("base64") };
}

/** A straight line east, `length` metres from the origin, as a flat decimetre ring. */
const east = (length: number) => encodeRing([
  [0, 0],
  [length / 2, 0],
  [length, 0],
]);

describe("what the ground is drawn as", () => {
  it("is a surface for every kind, laid in the map's order", () => {
    const kinds = Object.keys(GROUND) as GroundKind[];
    for (const k of kinds) expect(SURFACE[k]).toBeTruthy();
    // Open ground first, then areas, the strips under streets, paths and roads, railways last.
    expect(GROUND.open).toBe(0);
    expect(Math.max(GROUND.park, GROUND.grass, GROUND.wood, GROUND.pitch, GROUND.water)).toBeLessThan(GROUND.edge);
    expect(GROUND.edge).toBeLessThan(Math.min(GROUND.path, GROUND.steps, GROUND.service, GROUND.street, GROUND.major, GROUND.motorway));
    expect(GROUND.rail).toBe(Math.max(...Object.values(GROUND)));
  });

  it("is asphalt for every road, slabs for paths, treads for steps", () => {
    for (const k of ["service", "street", "major", "motorway"] as const) expect(roadSurface(k)).toBe("asphalt");
    expect(roadSurface("path")).toBe("slabs");
    expect(roadSurface("steps")).toBe("treads");
    expect(SURFACE.edge).toBe("kerb");
    expect(SURFACE.rail).toBe("track");
  });

  it("is a lawn in parks, on grass, on pitches and under trees, and water in ponds", () => {
    for (const k of ["park", "grass", "pitch", "wood"] as const) expect(areaSurface(k)).toBe("turf");
    expect(areaSurface("water")).toBe("water");
  });
});

describe("white lines on a road", () => {
  const long = 200;
  const at = (k: RoadClass, along: number, across: number) => lineCover(k, { along, across, length: long });

  it("are a broken line down the middle of a street: 3 m lines with 7 m gaps", () => {
    expect(DASH).toBe(3);
    expect(DASH_PERIOD - DASH).toBe(7);
    expect(at("street", 101, 0)).toBeCloseTo(1, 6);
    expect(at("street", 102.9, 0.04)).toBeCloseTo(1, 6);
    expect(at("street", 104, 0)).toBe(0);
    expect(at("street", 109.9, 0)).toBe(0);
    // 100 mm wide, white only on the line.
    expect(LINE_WIDTH).toBe(0.1);
    expect(at("street", 101, LINE_WIDTH)).toBe(0);
    expect(at("street", 101, 1)).toBe(0);
  });

  it("fade to what they are on average when a pixel spans more than they do", () => {
    // A pixel a whole period long sees the line three-tenths of the time; one as wide as the road, its share of the width.
    expect(lineCover("street", { along: 123.4, across: 0, length: long }, DASH_PERIOD, 0)).toBeCloseTo(DASH / DASH_PERIOD, 9);
    expect(lineCover("street", { along: 101, across: 0, length: long }, 0, 1)).toBeCloseTo(LINE_WIDTH, 9);
    // The box filter is exact for any footprint inside a band and averages over one that is not.
    expect(box(0.5, 0, 1, 0.2)).toBeCloseTo(1, 9);
    expect(box(1, 0, 1, 0.5)).toBeCloseTo(0.5, 9);
    expect(pulse(0.37, 0, 0.3, 1)).toBeCloseTo(0.3, 9);
    expect(pulse(7.37, 0, 0.3, 3)).toBeCloseTo(0.3, 9);
  });

  it("run along the edges of a major road and a motorway, inside the kerb, and not down a motorway's middle", () => {
    for (const k of ["major", "motorway"] as const) {
      const inner = ROAD_WIDTH[k] / 2 - EDGE_LINE_IN[k];
      for (const along of [57, 61, 66.6]) {
        expect(at(k, along, inner - LINE_WIDTH / 2)).toBeCloseTo(1, 6);
        expect(at(k, along, -(inner - LINE_WIDTH / 2))).toBeCloseTo(1, 6);
        expect(at(k, along, inner + 0.1)).toBe(0);
      }
    }
    expect(at("major", 101, 0)).toBeCloseTo(1, 6);
    expect(at("motorway", 101, 0)).toBe(0);
    expect(MARKINGS.street.edges).toBe(false);
  });

  it("are not painted on service lanes, paths or steps", () => {
    for (const k of ["service", "path", "steps"] as const) {
      expect(MARKINGS[k]).toEqual({ centre: false, edges: false });
      for (let along = 0; along < long; along += 0.7) for (const across of [-1, -0.05, 0, 0.05, 1]) expect(at(k, along, across)).toBe(0);
    }
  });

  it("stop short of either end of the road, where it meets another", () => {
    expect(at("street", 1, 0)).toBe(0);
    expect(at("major", 2, ROAD_WIDTH.major / 2 - EDGE_LINE_IN.major - 0.05)).toBe(0);
    expect(lineCover("street", { along: 199, across: 0, length: long })).toBe(0);
    // Fading in over a metre and a half past the stop: seen on an edge line, which has no gaps.
    const edge = ROAD_WIDTH.major / 2 - EDGE_LINE_IN.major - LINE_WIDTH / 2;
    expect(lineCover("major", { along: 1, across: edge, length: 2 * LINE_STOP + 2 })).toBe(0);
    const fading = lineCover("major", { along: LINE_STOP + LINE_FADE / 2, across: edge, length: long });
    expect(fading).toBeGreaterThan(0.4);
    expect(fading).toBeLessThan(0.6);
  });
});

describe("the strip under a street", () => {
  it("is a kerb's face, then its top, then the footpath, going out from the carriageway", () => {
    expect(kerbPart(0)).toBe("face");
    expect(kerbPart(KERB_FACE / 2)).toBe("face");
    expect(kerbPart(KERB_FACE + 0.01)).toBe("top");
    expect(kerbPart(KERB_FACE + KERB_TOP + 0.01)).toBe("footpath");
    expect(KERB_FACE + KERB_TOP).toBeLessThan(0.8);
  });
});

describe("a ribbon's own coordinates", () => {
  it("are metres along the line and across it, left positive, with half its width and its whole length", () => {
    const mb = new MeshBuilder(false, false, false, true);
    // East 12 m, then north 5 m: 17 m in all.
    mb.ribbon(
      encodeRing([
        [0, 0],
        [12, 0],
        [12, 5],
      ]),
      4,
      0.1,
    );
    const g = mb.build();
    const r = g.getAttribute("ribbon");
    const p = g.getAttribute("position");
    expect(r.itemSize).toBe(4);
    expect(r.count).toBe(p.count);
    const along = [0, 0, 12, 12, 17, 17];
    for (let k = 0; k < r.count; k++) {
      expect(r.getX(k)).toBeCloseTo(along[k]!, 5);
      // Left of the way first: north of a line going east is z < 0.
      expect(r.getY(k)).toBe(k % 2 === 0 ? 2 : -2);
      expect(r.getZ(k)).toBe(2);
      expect(r.getW(k)).toBeCloseTo(17, 5);
    }
    expect(p.getZ(0)).toBeLessThan(0);
  });

  it("change nothing the map draws", () => {
    const build = (ribbon: boolean) => {
      const mb = new MeshBuilder(false, false, false, ribbon);
      mb.ribbon(east(40), 7.5, 0.16);
      mb.ribbon(encodeRing([
        [5, 5],
        [9, 30],
        [-4, 44],
      ]), 2.2, 0.16);
      return mb.build();
    };
    const plain = build(false);
    const kept = build(true);
    for (const name of ["position", "normal"]) expect(kept.getAttribute(name).array).toEqual(plain.getAttribute(name).array);
    expect(kept.getIndex()!.array).toEqual(plain.getIndex()!.array);
    expect(plain.getAttribute("ribbon")).toBeUndefined();
  });
});

describe("paint laid over the ground", () => {
  // A slope rising 10% to the east and 5% to the north.
  const plane = new Terrain([grid(12, 12, 10, -20, -20, (x, y) => 20 + 0.1 * x + 0.05 * y)]);
  const ground = (x: number, y: number) => plane.height(x, y);
  const slopeAt = (x: number, y: number, out: number[]) => plane.normal(x, y, out);

  it("is where the map lays it whatever the walker views add", () => {
    const g = (ribbon: boolean) => {
      const mb = new MeshBuilder(false, false, false, ribbon);
      mb.ribbon(east(60), 7.5, 0.3);
      return mb.build();
    };
    const plain = drape(g(false), ground);
    const walker = drape(g(true), ground, 10, slopeAt);
    expect(walker.getAttribute("position").array).toEqual(plain.getAttribute("position").array);
    expect(walker.getAttribute("normal").array).toEqual(plain.getAttribute("normal").array);
  });

  it("keeps where each point lies along its line and across it as its triangles are split", () => {
    const mb = new MeshBuilder(false, false, false, true);
    mb.ribbon(east(60), 7.5, 0.3);
    const d = drape(mb.build(), ground, 10, slopeAt);
    const p = d.getAttribute("position");
    const r = d.getAttribute("ribbon");
    // Split into triangles of 10 m at most, so there are points between the line's own.
    expect(p.count).toBeGreaterThan(30);
    for (let k = 0; k < p.count; k++) {
      // Going east from the origin: along is east, across is north (z is south).
      expect(r.getX(k)).toBeCloseTo(p.getX(k), 4);
      expect(r.getY(k)).toBeCloseTo(-p.getZ(k), 4);
      expect(r.getZ(k)).toBeCloseTo(3.75, 5);
      expect(r.getW(k)).toBeCloseTo(60, 4);
      // Raised by the ground under it.
      expect(p.getY(k)).toBeCloseTo(0.3 + ground(p.getX(k), -p.getZ(k)), 4);
    }
  });

  it("knows the slope under it, which the walker views light it by", () => {
    const len = Math.hypot(0.1, 1, 0.05);
    const expected = [-0.1 / len, 1 / len, 0.05 / len];
    const out = [0, 0, 0];
    for (const [x, y] of [
      [0, 0],
      [33.3, -7.1],
      [-15, 64],
    ]) {
      plane.normal(x!, y!, out);
      for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(expected[c]!, 2);
    }
    const mb = new MeshBuilder();
    mb.flat(encodeRing([
      [0, 0],
      [30, 0],
      [30, 30],
      [0, 30],
    ]), 0.1);
    const slope = drape(mb.build(), ground, 10, slopeAt).getAttribute("slope");
    expect(slope.normalized).toBe(true);
    for (let k = 0; k < slope.count; k++) for (let c = 0; c < 3; c++) expect(slope.getComponent(k, c)).toBeCloseTo(expected[c]!, 1);
    // Off every grid, and on paint laid with no ground under it, straight up.
    plane.normal(1000, 1000, out);
    expect(out).toEqual([0, 1, 0]);
    const level = levelSlope(new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array(9), 3))).getAttribute("slope");
    for (let k = 0; k < 3; k++) expect([level.getX(k), level.getY(k), level.getZ(k)]).toEqual([0, 1, 0]);
  });

  it("is lit by the same normals as the ground's own mesh", () => {
    // A bumpy grid: the normal at each grid point is the one three works out for the mesh.
    const data = grid(9, 7, 10, 0, 0, (x, y) => 30 + 4 * Math.sin(x / 13) * Math.cos(y / 9) + 0.02 * x * y);
    const terrain = new Terrain([data]);
    const mesh = Terrain.mesh(data, (c, r) => Math.round((30 + 4 * Math.sin((c * 10) / 13) * Math.cos((r * 10) / 9) + 0.02 * c * 10 * r * 10) * 10) / 10);
    const n = mesh.getAttribute("normal");
    const out = [0, 0, 0];
    for (let r = 1; r < data.rows - 1; r++) {
      for (let c = 1; c < data.cols - 1; c++) {
        terrain.normal(c * 10, r * 10, out);
        const i = r * data.cols + c;
        expect(out[0]).toBeCloseTo(n.getX(i), 5);
        expect(out[1]).toBeCloseTo(n.getY(i), 5);
        expect(out[2]).toBeCloseTo(n.getZ(i), 5);
      }
    }
  });
});

describe("the ground's grain", () => {
  const n = 32;
  const layers = groundLayers(n);
  const packed = packSurfaces(layers, n, GROUND_TILE);

  it("has a layer for each surface, a tile size for each, and the broad variation last", () => {
    expect(layers.length).toBe(GROUND_LAYERS - 1);
    expect(GROUND_TILE.length).toBe(GROUND_LAYERS);
    expect(packGround(n).length).toBe(n * n * 4 * GROUND_LAYERS);
  });

  it("is drawn the same on every load", () => {
    expect(packGround(n)).toEqual(packGround(n));
  });

  it("is flat on average, so that far-off ground, whose texels average out, is lit as it lies", () => {
    for (let k = 0; k < layers.length; k++) {
      for (const c of [0, 1]) {
        let x = 0;
        for (let i = 0; i < n * n; i++) x += packed[(k * n * n + i) * 4 + c]!;
        expect(Math.abs(x / (n * n) - 127.5)).toBeLessThan(3);
      }
    }
  });

  it("repeats without a seam: the first column follows on from the last", () => {
    for (const s of layers) {
      let step = 0;
      let across = 0;
      for (let y = 0; y < n; y++) {
        across += Math.abs(s.height[y * n]! - s.height[y * n + n - 1]!);
        for (let x = 1; x < n; x++) step = Math.max(step, Math.abs(s.height[y * n + x]! - s.height[y * n + x - 1]!));
      }
      expect(across / n).toBeLessThanOrEqual(step + 1e-9);
    }
  });

  it("varies broadly over the whole range in each of its four fields", () => {
    const v = groundVariation(n);
    for (let c = 0; c < 4; c++) {
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < n * n; i++) {
        lo = Math.min(lo, v[i * 4 + c]!);
        hi = Math.max(hi, v[i * 4 + c]!);
      }
      expect(lo).toBe(0);
      expect(hi).toBe(255);
    }
  });
});

describe("the light on the ground", () => {
  it("is wet only in the rain, and lit by the city only after dark", () => {
    const day = streetLighting({ sun: { azimuth: 325, elevation: 48 }, night: 0 });
    const rain = streetLighting({ sun: { azimuth: 325, elevation: 48 }, night: 0, weather: { cloud: 0.9, wet: 1, fog: 0 } });
    const night = streetLighting({ sun: { azimuth: 260, elevation: -20 }, night: 1 });
    expect(day.wet).toBe(0);
    expect(rain.wet).toBe(1);
    expect(Math.max(...day.groundGlow)).toBe(0);
    expect(Math.min(...night.groundGlow)).toBeGreaterThan(0);
    // Warm, like the lamps it stands for.
    expect(night.groundGlow[0]).toBeGreaterThan(night.groundGlow[2]);
  });
});
