import { describe, expect, it } from "vitest";
import {
  CITY_STOREY,
  LIT_PERIOD,
  STYLE,
  STYLES,
  TALL_GROUND,
  buildingSeed,
  cityStoreys,
  facadeCode,
  facadeStyle,
  faceRuns,
  litWindow,
  pcg4d,
  seedBits,
  windowLanes,
  type FacadeStyle,
} from "../src/scene/street/rules.ts";
import { LAYERS, LAYER_TILE, packSurfaces, surfaces } from "../src/scene/street/surfaces.ts";
import { streetLighting } from "../src/scene/street/light.ts";
import { MeshBuilder } from "../src/scene/geometry.ts";
import { encodeRing } from "../src/shared/geo.ts";

/** A seed for each of n buildings in a row. */
const seeds = (n: number) => Array.from({ length: n }, (_, k) => buildingSeed(k * 13.7, 500 - k * 3.1));

describe("storeys of a surrounding building", () => {
  it("are a whole number of storeys of about 3.3 m under a parapet, at least one", () => {
    // The pipeline's heights: OpenStreetMap's levels times 3.3 m and a metre, or its defaults.
    for (let levels = 1; levels <= 20; levels++) expect(cityStoreys(levels * 3.3 + 1, true).count).toBe(levels);
    expect(cityStoreys(6.5, true).count).toBe(2);
    expect(cityStoreys(10, true).count).toBe(3);
    expect(cityStoreys(3, true).count).toBe(1);
    expect(cityStoreys(0.5, true).count).toBe(1);
  });

  it("fill the walls exactly, with a taller ground storey on buildings of three or more", () => {
    for (const h of [3, 6.5, 10, 14.2, 24.1, 56.1, 116]) {
      for (const flat of [true, false]) {
        const s = cityStoreys(h, flat);
        expect(s.ground + (s.count - 1) * s.storey).toBeCloseTo(s.top, 6);
        expect(s.top).toBeLessThanOrEqual(h);
        // A pitched roof starts at the eaves: no parapet.
        if (!flat) expect(s.top).toBeCloseTo(h, 6);
        if (s.count >= 3) expect(s.ground / s.storey).toBeCloseTo(TALL_GROUND, 6);
        else expect(s.ground).toBeCloseTo(s.storey, 6);
        expect(Math.abs(s.storey - CITY_STOREY)).toBeLessThan(1.5);
      }
    }
  });
});

describe("bays along a face", () => {
  const square = (w: number) => [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: w },
    { x: 0, y: w },
  ];

  it("are a whole number on every face, so that no window is cut at a corner", () => {
    const runs = faceRuns(square(10), 3.2);
    for (let e = 0; e < 4; e++) {
      const [from, to, width] = [runs[e * 3]!, runs[e * 3 + 1]!, runs[e * 3 + 2]!];
      expect(from).toBe(0);
      expect(to).toBeCloseTo(10, 9);
      // round(10 / 3.2) = 3 bays, stretched to fill the face.
      expect(width).toBeCloseTo(10 / 3, 9);
      expect(to / width).toBeCloseTo(Math.round(to / width), 9);
    }
  });

  it("run on across edges that do not turn a corner, and start again where one does", () => {
    // A face drawn as two edges in a line, then three more sides.
    const ring = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 8 },
      { x: 0, y: 8 },
    ];
    const runs = faceRuns(ring, 3);
    expect([runs[0], runs[1]]).toEqual([0, 6]);
    expect([runs[3], runs[4]]).toEqual([6, 12]);
    // Both edges of the face share its bays: 12 m, four of 3 m.
    expect(runs[2]).toBeCloseTo(3, 9);
    expect(runs[5]).toBeCloseTo(3, 9);
    // The next face starts at its corner.
    expect(runs[6]).toBe(0);
    expect(runs[8]).toBeCloseTo(8 / 3, 9);
  });

  it("leave a face too short for one window as plain wall", () => {
    const runs = faceRuns(square(1.2), 3.2);
    for (let e = 0; e < 4; e++) expect(runs[e * 3 + 2]).toBe(0);
  });
});

describe("a building's style", () => {
  const share = (list: FacadeStyle[], style: FacadeStyle) => list.filter((s) => s === style).length / list.length;

  it("comes from where it stands, the same on every load", () => {
    expect(buildingSeed(130.4, -52.9)).toBe(buildingSeed(130.4, -52.9));
    expect(buildingSeed(130.4, -52.9)).not.toBe(buildingSeed(130.4, -53.9));
    for (const seed of seeds(200)) {
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(1);
      const o = { university: false, height: 20, pitched: false };
      expect(facadeStyle(seed, o)).toBe(facadeStyle(seed, o));
    }
  });

  it("keeps a style and a seed exact in the one number the shader takes", () => {
    for (const seed of seeds(300)) {
      for (const style of Object.values(STYLE)) {
        const code = Math.fround(facadeCode(style, seed));
        expect(Math.floor(code)).toBe(style);
        expect(Math.round((code - style) * 65536)).toBe(seedBits(seed));
      }
    }
  });

  it("is never weatherboards for the University, and glass more often the taller a city building stands", () => {
    const all = seeds(3000);
    const uni = all.map((s) => facadeStyle(s, { university: true, height: 30, pitched: false }));
    expect(share(uni, STYLE.boards)).toBe(0);
    for (const style of [STYLE.plaster, STYLE.concrete, STYLE.stone, STYLE.brick]) expect(share(uni, style)).toBeGreaterThan(0.05);
    const tall = all.map((s) => facadeStyle(s, { university: false, height: 60, pitched: false }));
    const low = all.map((s) => facadeStyle(s, { university: false, height: 7, pitched: false }));
    expect(share(tall, STYLE.glass)).toBeGreaterThan(0.35);
    expect(share(low, STYLE.glass)).toBe(0);
    // Low houses with pitched roofs are mostly weatherboards.
    const houses = all.map((s) => facadeStyle(s, { university: false, height: 6.5, pitched: true }));
    expect(share(houses, STYLE.boards)).toBeGreaterThan(0.45);
  });

  it("has windows inside their bay and storey, with frames and bars that leave glass", () => {
    for (const s of STYLES) {
      const [x0, x1, y0, y1] = s.window;
      expect(0 <= x0 && x0 < x1 && x1 <= 1).toBe(true);
      expect(0 <= y0 && y0 < y1 && y1 <= 1).toBe(true);
      expect(s.panes).toBeGreaterThanOrEqual(1);
      expect(s.recess).toBeGreaterThan(0);
      expect(s.university.length + s.city.length + s.frames.length).toBeGreaterThan(3);
    }
  });
});

describe("rooms lit after dark", () => {
  it("are drawn by a hash that gives the same answer for the same window and time", () => {
    // The shader's own answers, read back from a Quadro P600, an Intel UHD 770 and SwiftShader.
    expect(pcg4d(0, 0, 0, 0)).toEqual([251852841, 760645481, 850445371, 3542436074]);
    expect(pcg4d(7919, 1, 3, 0)).toEqual([3982812855, 3379190405, 2119140410, 16037373]);
    expect(pcg4d(1, 2, 3, 4)).not.toEqual(pcg4d(1, 2, 3, 5));
    const seed = buildingSeed(40, 120);
    for (let bay = 0; bay < 20; bay++) {
      for (let storey = 0; storey < 10; storey++) {
        expect(litWindow(seed, bay, storey, 75, 0.4)).toBe(litWindow(seed, bay, storey, 75, 0.4));
        for (const v of windowLanes(seed, bay, storey, 0)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }
    }
  });

  it("light about the share asked for", () => {
    let on = 0;
    let all = 0;
    for (const seed of seeds(40)) {
      for (let bay = 0; bay < 12; bay++) {
        for (let storey = 0; storey < 8; storey++) {
          all++;
          if (litWindow(seed, bay, storey, 30, 0.4)) on++;
        }
      }
    }
    expect(on / all).toBeGreaterThan(0.36);
    expect(on / all).toBeLessThan(0.44);
  });

  it("change a few at a time, each window at a moment of its own", () => {
    const seed = buildingSeed(-400, -250);
    const windows: [number, number][] = [];
    for (let bay = 0; bay < 20; bay++) for (let storey = 0; storey < 20; storey++) windows.push([bay, storey]);
    const state = (minutes: number) => windows.map(([b, s]) => litWindow(seed, b, s, minutes, 0.44));
    const changed = (a: boolean[], b: boolean[]) => a.filter((x, k) => x !== b[k]).length / a.length;
    const start = state(100);
    // A minute on, a few; a whole period on, about as many as chance makes differ.
    expect(changed(start, state(101))).toBeGreaterThan(0);
    expect(changed(start, state(101))).toBeLessThan(0.1);
    expect(changed(start, state(100 + LIT_PERIOD * 4))).toBeGreaterThan(0.3);
  });
});

describe("the walls' grain", () => {
  const n = 32;
  const layers = surfaces(n);
  const packed = packSurfaces(layers, n);

  it("has a layer for every surface and a tile size for each", () => {
    expect(layers.length).toBe(LAYERS);
    expect(LAYER_TILE.length).toBe(LAYERS);
    expect(packed.length).toBe(n * n * 4 * LAYERS);
  });

  it("is drawn the same on every load", () => {
    expect(packSurfaces(surfaces(n), n)).toEqual(packed);
  });

  it("is flat on average, so that a far wall, whose texels average out, faces the way it is built", () => {
    for (let k = 0; k < LAYERS; k++) {
      let x = 0;
      for (let i = 0; i < n * n; i++) x += packed[(k * n * n + i) * 4]!;
      expect(Math.abs(x / (n * n) - 127.5)).toBeLessThan(3);
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
      // The wrap is no bigger a step than steps inside the tile.
      expect(across / n).toBeLessThanOrEqual(step + 1e-9);
    }
  });
});

describe("a mesh that keeps facades", () => {
  const square = encodeRing([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]);
  const spec = { code: facadeCode(STYLE.plaster, 0.25), storey: 3.6, ground: 3.6, top: 7.2, base: 0, anchor: [5, 5] as const, bay: 3.2, cap: 0 as const };

  it("adds what the facades need and changes nothing the map draws", () => {
    const build = (facades: boolean) => {
      const mb = new MeshBuilder(true, true, facades);
      if (facades) mb.facade = { ...spec, cap: 2 };
      mb.extrude([square], 0, 7.2, [1, 1, 1], [0.9, 0.9, 0.9], true, { storey: 3.6, bay: 3.2, roofGroup: true, plinth: { top: 3.6, color: [0.8, 0.8, 0.8] } });
      mb.fence(0, 0, 10, 0, 7.2, 8.1);
      return mb.build();
    };
    const plain = build(false);
    const kept = build(true);
    for (const name of ["position", "normal", "color", "uv"]) expect(kept.getAttribute(name).array).toEqual(plain.getAttribute(name).array);
    expect(kept.getIndex()!.array).toEqual(plain.getIndex()!.array);
    expect(kept.groups).toEqual(plain.groups);
    expect(plain.getAttribute("facade")).toBeUndefined();
    expect(kept.getAttribute("facade").count).toBe(kept.getAttribute("position").count);
    expect(kept.getAttribute("facadeStoreys").count).toBe(kept.getAttribute("position").count);
  });

  it("marks each wall vertex with where it is along its face and up from the ground floor, and roofs and parapets as such", () => {
    const mb = new MeshBuilder(false, false, true);
    mb.facade = { ...spec, base: 2, cap: 2 };
    mb.extrude([square], 2, 9.2);
    mb.fence(0, 0, 10, 0, 9.2, 10.1);
    const g = mb.build();
    const a = g.getAttribute("facade");
    const b = g.getAttribute("facadeStoreys");
    const pos = g.getAttribute("position");
    const parts = new Set<number>();
    for (let k = 0; k < a.count; k++) {
      const part = b.getW(k);
      parts.add(part);
      expect(a.getW(k)).toBeCloseTo(spec.code, 6);
      if (part === 0) {
        // Walls: up is metres above the ground floor; along is within its 10 m face; 3 bays of 3.33 m.
        expect(a.getY(k)).toBeCloseTo(pos.getY(k) - 2, 6);
        expect(a.getX(k)).toBeGreaterThanOrEqual(0);
        expect(a.getX(k)).toBeLessThanOrEqual(10 + 1e-9);
        expect(a.getZ(k)).toBeCloseTo(10 / 3, 6);
      }
    }
    // Wall, plain parapet, roof.
    expect([...parts].sort()).toEqual([0, 1, 2]);
  });
});

describe("what the windows show", () => {
  it("is the day's rooms by day and lit rooms after dark", () => {
    const day = streetLighting({ sun: { azimuth: 325, elevation: 48 }, night: 0 });
    const night = streetLighting({ sun: { azimuth: 260, elevation: -20 }, night: 1 });
    expect(day.windows.glow).toBe(0);
    expect(night.windows.glow).toBe(1);
    expect(day.windows.interior[0]).toBeGreaterThan(night.windows.interior[0] * 10);
    // A room by day is far darker than a white wall in the sun outside (before the shader shades
    // its sides by half or less), and a blind against the glass brighter than the room.
    expect(day.windows.interior[1]).toBeLessThan((0.2 * day.lightIntensity) / Math.PI);
    expect(day.windows.blind[1]).toBeGreaterThan(day.windows.interior[1]);
    // The city's glow shows in the panes only after dark.
    expect(Math.max(...day.windows.city)).toBe(0);
    expect(Math.max(...night.windows.city)).toBeGreaterThan(0);
  });
});
