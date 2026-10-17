// The rules a building's walls are drawn by in the walker views: how many storeys it has, how wide
// a bay is, what its walls are made of, and which of its rooms are lit after dark. Nothing here is
// known about a real building. The campus map and OpenStreetMap give outlines and heights; the
// storeys, windows and materials are drawn by rule from those, the same way on every load, and
// say nothing about the real walls. Plain numbers, so that tests can check them without a GPU;
// facade.ts draws them, and its shader repeats pcg4d, and so which rooms are lit, exactly.

/** What a wall is drawn as. A building's style comes from its seed (facadeStyle). */
export const STYLE = { plaster: 0, brick: 1, concrete: 2, stone: 3, glass: 4, boards: 5 } as const;
export type FacadeStyle = (typeof STYLE)[keyof typeof STYLE];

/** What a stretch of a building's surface is: walls with windows, plain wall, a flat roof, a pitched one. */
export const PART = { wall: 0, plain: 1, roof: 2, pitched: 3 } as const;
export type FacadePart = (typeof PART)[keyof typeof PART];

/** How a style draws its walls. Lengths in metres; the colours are sRGB. */
export interface StyleSpec {
  /** Layer of the surface texture the walls take their grain from (surfaces.ts LAYER). */
  layer: number;
  /**
   * Metres between window centres on a surrounding building, before each face is stretched to a
   * whole number of bays. The University's buildings keep the map's bay (CampusScene WINDOW_BAY).
   */
  bay: number;
  /** A window as fractions of its bay (left, right) and of its storey (sill, head). */
  window: [number, number, number, number];
  /** Metres the glass stands back from the face of the wall. */
  recess: number;
  /** Panes across a window, and where a transom crosses it as a fraction of its height (0: none). */
  panes: number;
  transom: number;
  /** Whether the window has a sill under it and a lintel over it, a band of stone or concrete. */
  sill: boolean;
  lintel: boolean;
  roughness: number;
  /** How strongly the grain's relief shows, 0-1. */
  relief: number;
  /** Wall colours: University buildings keep the map's pale, warm tones; the city round them is greyer. */
  university: number[];
  city: number[];
  /** Window frames. */
  frames: number[];
}

/**
 * The styles, indexed by STYLE. The University's own colours are in none of them, and the
 * University's buildings stay pale and warm like the map's.
 */
export const STYLES: readonly StyleSpec[] = [
  // Plaster: rendered and painted walls, windows of two lights.
  {
    layer: 0,
    bay: 3,
    window: [0.2, 0.8, 0.28, 0.8],
    recess: 0.14,
    panes: 2,
    transom: 0,
    sill: true,
    lintel: false,
    roughness: 0.88,
    relief: 0.55,
    university: [0xd8cfbf, 0xd3ccc0, 0xdcd4c5, 0xcdc6ba, 0xd6cab4],
    city: [0xc9c5bc, 0xbeb9af, 0xd0cabd, 0xb7b4ad, 0xc5bcac, 0xd3d0c9],
    frames: [0xe9e8e3, 0xc9c9c4, 0x5d5e5c, 0x38393a],
  },
  // Brick: courses of brick, windows with a sill and a lintel.
  {
    layer: 1,
    bay: 2.7,
    window: [0.24, 0.76, 0.27, 0.78],
    recess: 0.11,
    panes: 2,
    transom: 0.68,
    sill: true,
    lintel: true,
    roughness: 0.9,
    relief: 1,
    university: [0xc4ad8e, 0xbaa183, 0xccba9c],
    city: [0x8e604c, 0x815644, 0xa17d5f, 0xb09374, 0x827c77, 0x986e58],
    frames: [0xf0eee8, 0x3a3836, 0x6b5f52],
  },
  // Concrete: precast panels a bay wide and a storey high, wide windows.
  {
    layer: 2,
    bay: 3.6,
    window: [0.12, 0.88, 0.3, 0.82],
    recess: 0.17,
    panes: 3,
    transom: 0,
    sill: false,
    lintel: false,
    roughness: 0.86,
    relief: 0.6,
    university: [0xc2bfb8, 0xbbb8b1, 0xc9c5bb],
    city: [0xa5a29b, 0x989590, 0xadaaa0, 0x8d8b86, 0xb5b1a8],
    frames: [0x4a4c4e, 0x2a2b2d, 0x9a9c9e],
  },
  // Stone: ashlar courses, tall windows deep in the wall.
  {
    layer: 3,
    bay: 2.9,
    window: [0.29, 0.71, 0.24, 0.8],
    recess: 0.22,
    panes: 2,
    transom: 0.72,
    sill: true,
    lintel: true,
    roughness: 0.82,
    relief: 0.9,
    university: [0xd2c7b2, 0xc9bea9, 0xd6cdbb],
    city: [0xbdb099, 0xafa492, 0xc5bba9],
    frames: [0xeeece6, 0x3b3a38],
  },
  // Glass: a curtain wall of glass between aluminium mullions, a dark spandrel at each floor.
  {
    layer: 4,
    bay: 1.5,
    window: [0.03, 0.97, 0.3, 0.97],
    recess: 0.03,
    panes: 1,
    transom: 0,
    sill: false,
    lintel: false,
    roughness: 0.16,
    relief: 0.15,
    university: [0x5a6466, 0x646a68, 0x585f62],
    city: [0x4c5658, 0x546058, 0x5a5c60, 0x5e5a52],
    frames: [0x9fa3a6, 0x5f6366, 0x2e3032],
  },
  // Boards: painted weatherboards on a low building with a pitched roof, sash windows.
  {
    layer: 5,
    bay: 2.6,
    window: [0.3, 0.7, 0.3, 0.8],
    recess: 0.06,
    panes: 1,
    transom: 0.55,
    sill: true,
    lintel: false,
    roughness: 0.7,
    relief: 1,
    university: [0xdedad1],
    city: [0xdedad1, 0xd5ccb6, 0xbec3bd, 0xc8c1ae, 0xacb2a1, 0xd1d3d2],
    frames: [0xf4f2ec, 0xe9e4d6],
  },
];

/** The roofs: flat roofs are membrane or gravel, pitched ones painted corrugated steel. sRGB. */
export const FLAT_ROOFS = [0x5e5f60, 0x6e6c68, 0x4f5153, 0x7a7873];
export const PITCHED_ROOFS = [0x3b3d3f, 0x4b4f52, 0x55504a, 0x5c3f36, 0x46524a, 0x2f3134];

/** Metres a storey of a surrounding building is drawn: what the pipeline takes a level of OpenStreetMap's to be (OSM_LEVEL in scripts/build-data.ts). */
export const CITY_STOREY = 3.3;
/** Metres of parapet over the top storey of a flat roof: the pipeline adds a metre to a height worked out from levels. */
export const PARAPET = 1;
/** On a building of three storeys or more the ground storey is drawn this much taller than the rest. */
export const TALL_GROUND = 1.25;
/** Metres of plinth along the foot of every wall. */
export const PLINTH = 0.45;

/** The storeys of a wall: metres of the ground storey and of each one above it, the top of the last, and how many. */
export interface Storeys {
  ground: number;
  storey: number;
  top: number;
  count: number;
}

/**
 * The storeys of a surrounding building whose walls stand `height` metres: a whole number of
 * them, at least one, of about CITY_STOREY, under a parapet when the roof is flat. A building
 * tagged with its levels in OpenStreetMap gets that many back.
 */
export function cityStoreys(height: number, flatRoof: boolean): Storeys {
  const parapet = flatRoof ? Math.min(PARAPET, height * 0.15) : 0;
  const top = Math.max(0.5, height - parapet);
  const count = Math.max(1, Math.round(top / CITY_STOREY));
  const storey = count >= 3 ? top / (count - 1 + TALL_GROUND) : top / count;
  return { ground: count >= 3 ? storey * TALL_GROUND : storey, storey, top, count };
}

/**
 * Where along each edge of a ring its windows fall: metres from the corner its face starts at,
 * at both ends of the edge, and the width of a bay on that face. A face is a run of edges between
 * two corners, so a curve drawn as many short edges is one face, and it carries a whole number
 * of bays, as near `bay` wide as that allows, so that no window is cut at a corner. A face too
 * short for one has bays of width 0: plain wall. A turn of more than `corner` radians makes a corner.
 */
export function faceRuns(ring: readonly { x: number; y: number }[], bay: number, corner = 0.5): Float64Array {
  const n = ring.length;
  const out = new Float64Array(n * 3);
  if (n < 2) return out;
  const len: number[] = [];
  const isCorner: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n]!;
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    len.push(Math.hypot(b.x - a.x, b.y - a.y));
    const turn = Math.atan2((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x), (a.x - p.x) * (b.x - a.x) + (a.y - p.y) * (b.y - a.y));
    isCorner.push(Math.abs(turn) > corner);
  }
  // A ring without corners, such as a round tower, is one face.
  let first = Math.max(0, isCorner.indexOf(true));
  for (let done = 0; done < n; ) {
    let run = 0;
    let count = 0;
    do {
      run += len[(first + count) % n]!;
      count++;
    } while (done + count < n && !isCorner[(first + count) % n]);
    const bays = bay > 0 ? Math.round(run / bay) : 0;
    const width = bays > 0 ? run / bays : 0;
    let along = 0;
    for (let k = 0; k < count; k++) {
      const e = (first + k) % n;
      out[e * 3] = along;
      out[e * 3 + 1] = along + len[e]!;
      out[e * 3 + 2] = width;
      along += len[e]!;
    }
    first = (first + count) % n;
    done += count;
  }
  return out;
}

/** A 32-bit integer mix, for seeds. */
function mix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Steps a seed is counted in: few enough that a style and a seed added together stay exact in a 32-bit float. */
export const SEED_STEPS = 65536;

/** A building's seed, 0-1, from where it stands (metres east and north): the same on every load. */
export function buildingSeed(east: number, north: number): number {
  const h = mix32(mix32(Math.round(east * 10) | 0) ^ Math.imul(Math.round(north * 10) | 0, 0x9e3779b1));
  return (h >>> 16) / SEED_STEPS;
}

/** Picks from weighted choices with a number 0-1. */
function weighted<T>(x: number, choices: readonly [T, number][]): T {
  const total = choices.reduce((t, [, w]) => t + w, 0);
  let at = x * total;
  for (const [choice, w] of choices) {
    if (at < w) return choice;
    at -= w;
  }
  return choices[choices.length - 1]![0];
}

/**
 * What a building's walls are drawn as. University buildings are plaster, concrete, stone,
 * pale brick or now and then glass; the city round them is more varied, with weatherboards on
 * low pitched-roof houses and glass more likely the taller a building stands.
 */
export function facadeStyle(seed: number, o: { university: boolean; height: number; pitched: boolean }): FacadeStyle {
  const s = STYLE;
  const x = mix32(seedBits(seed) ^ 0x5bd1e995) / 4294967296;
  if (o.university) {
    return weighted<FacadeStyle>(x, [
      [s.plaster, 34],
      [s.concrete, 30],
      [s.stone, 16],
      [s.brick, 10],
      [s.glass, o.height >= 20 ? 12 : 4],
    ]);
  }
  if (o.pitched && o.height <= 9) {
    return weighted<FacadeStyle>(x, [
      [s.boards, 55],
      [s.plaster, 25],
      [s.brick, 20],
    ]);
  }
  if (o.height >= 35) {
    return weighted<FacadeStyle>(x, [
      [s.glass, 45],
      [s.concrete, 35],
      [s.plaster, 12],
      [s.stone, 8],
    ]);
  }
  if (o.height >= 12) {
    return weighted<FacadeStyle>(x, [
      [s.concrete, 32],
      [s.plaster, 28],
      [s.brick, 16],
      [s.glass, 16],
      [s.stone, 8],
    ]);
  }
  return weighted<FacadeStyle>(x, [
    [s.plaster, 40],
    [s.brick, 30],
    [s.concrete, 15],
    [s.boards, 10],
    [s.stone, 5],
  ]);
}

/** A seed and a style in one number, as the shader takes them: the style whole, the seed after the point. */
export function facadeCode(style: FacadeStyle, seed: number): number {
  return style + seedBits(seed) / SEED_STEPS;
}

/**
 * The shader's integer hash (pcg4d, Jarzynski and Olano 2020), in 32-bit arithmetic: four whole
 * numbers to four, the same here as on the GPU.
 */
export function pcg4d(a: number, b: number, c: number, d: number): [number, number, number, number] {
  let x = (Math.imul(a >>> 0, 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(b >>> 0, 1664525) + 1013904223) >>> 0;
  let z = (Math.imul(c >>> 0, 1664525) + 1013904223) >>> 0;
  let w = (Math.imul(d >>> 0, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, w)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  w = (w + Math.imul(y, z)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  w = (w ^ (w >>> 16)) >>> 0;
  x = (x + Math.imul(y, w)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  w = (w + Math.imul(y, z)) >>> 0;
  return [x, y, z, w];
}

/** The seed as the shader turns it into a whole number. */
export function seedBits(seed: number): number {
  return Math.min(SEED_STEPS - 1, Math.max(0, Math.round(seed * SEED_STEPS))) >>> 0;
}

/**
 * Four numbers 0-1 for one window, its bay along the face and its storey: `lane` keeps apart the
 * draws made for it. Lane LANE.window gives when its light may change, its lamp, its blind and how
 * far the blind is down; lane LANE.lit and on, whether its light is on.
 */
export function windowLanes(seed: number, bay: number, storey: number, lane: number): [number, number, number, number] {
  return pcg4d(seedBits(seed), bay >>> 0, storey >>> 0, lane >>> 0).map((v) => v / 4294967296) as [number, number, number, number];
}

/** Minutes a lit room keeps its light on or off before it may change, on average. */
export const LIT_PERIOD = 12;
/** Lanes of windowLanes, as the shader uses them. */
export const LANE = { window: 0, lit: 1024 } as const;

/**
 * Whether a room's light is on after dark: each window draws again every LIT_PERIOD minutes, at
 * a moment of its own, so that a few change while one watches. `share` of them are on.
 */
export function litWindow(seed: number, bay: number, storey: number, minutes: number, share: number): boolean {
  const phase = windowLanes(seed, bay, storey, LANE.window)[0];
  const step = Math.floor(Math.max(0, minutes) / LIT_PERIOD + phase);
  return windowLanes(seed, bay, storey, LANE.lit + step)[0] < share;
}
