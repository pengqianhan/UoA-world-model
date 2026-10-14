// Colours of the 3D scene. One palette per lighting mood; the scene blends between them.
// Deliberately not the University's brand colours: this is an unofficial project.
import type { AreaClass, RoadClass, RoomKind, SpaceKind } from "../shared/types.ts";

export interface Palette {
  sky: number;
  ground: number;
  fog: number;
  road: Record<RoadClass, number>;
  /** The edge of a street: a strip a little wider than the carriageway, under it. */
  roadEdge: number;
  rail: number;
  area: Record<AreaClass, number>;
  tree: number;
  context: number;
  uni: number;
  /** University buildings that have published learning spaces. */
  uniTeaching: number;
  /** Roofs of University buildings: a hue apart from the walls and from the ground, so that a building reads from above. */
  uniRoof: number;
  uniRoofTeaching: number;
  uniEdge: number;
  accent: number;
  hover: number;
  slab: number;
  slabBelow: number;
  /**
   * Unnamed floor-plan shapes: a floor tinted by the group of its type on the campus map, paler
   * than the rooms that can be selected, inside light walls. "other" is a step darker than the slab.
   */
  space: Record<SpaceKind, number>;
  planWall: number;
  planEdge: number;
  roomEdge: number;
  ambient: number;
  ambientGround: number;
  ambientIntensity: number;
  sun: number;
  sunIntensity: number;
  /** Sun direction: azimuth clockwise from north and elevation above the horizon, degrees. */
  sunAzimuth: number;
  sunElevation: number;
}

export const DAY: Palette = {
  sky: 0xdfe8ec,
  ground: 0xe9e5da,
  fog: 0xdfe8ec,
  road: { motorway: 0xf2e2bf, major: 0xfdfcf8, street: 0xf8f6f0, service: 0xf1eee5, path: 0xd9d1bd, steps: 0xc9bfa8 },
  roadEdge: 0xd3cab6,
  rail: 0xa9a59b,
  area: { park: 0xc9ddb0, grass: 0xd6e2be, wood: 0xb3cf9b, pitch: 0xbcd8a2, water: 0xa6cde0 },
  tree: 0x86ab72,
  context: 0xd3d0c8,
  uni: 0xf3ead9,
  uniTeaching: 0xfaf1dc,
  uniRoof: 0xb1bcbd,
  uniRoofTeaching: 0x9db0b5,
  uniEdge: 0x8b7b62,
  accent: 0xe2592d,
  hover: 0xf2a65a,
  slab: 0xf5f1e6,
  slabBelow: 0xd9d2c2,
  space: {
    office: 0xd9c7a2,
    lab: 0xc2d6bd,
    learning: 0xf2d9a4,
    toilet: 0xbdd3e2,
    stairs: 0xbab4aa,
    amenity: 0xebc5cb,
    other: 0xe2dccd,
  },
  planWall: 0xfbf8f0,
  planEdge: 0x8b7b62,
  roomEdge: 0x4a4334,
  ambient: 0xffffff,
  ambientGround: 0xb9b3a4,
  ambientIntensity: 1.55,
  sun: 0xfff3dc,
  sunIntensity: 2.1,
  sunAzimuth: 35,
  sunElevation: 48,
};

export const NIGHT: Palette = {
  sky: 0x0e1824,
  ground: 0x1a2735,
  fog: 0x0e1824,
  road: { motorway: 0x4a4636, major: 0x34475a, street: 0x2e4052, service: 0x283847, path: 0x33414f, steps: 0x394755 },
  roadEdge: 0x16222f,
  rail: 0x33414f,
  area: { park: 0x1d3f2d, grass: 0x21432f, wood: 0x173524, pitch: 0x244a33, water: 0x16364d },
  tree: 0x2a5c40,
  context: 0x2a3a4c,
  uni: 0x4a6183,
  uniTeaching: 0x5b78a3,
  uniRoof: 0x2f4460,
  uniRoofTeaching: 0x36506f,
  uniEdge: 0x9fb4cf,
  accent: 0xffb454,
  hover: 0xffd08a,
  slab: 0x3b5270,
  slabBelow: 0x2a3d55,
  space: {
    office: 0x66688a,
    lab: 0x4b7570,
    learning: 0x7a7258,
    toilet: 0x4a7898,
    stairs: 0x3c4c62,
    amenity: 0x7a5f78,
    other: 0x4a6384,
  },
  planWall: 0x6d88ad,
  planEdge: 0x9fb4cf,
  roomEdge: 0xdbe6f2,
  ambient: 0xa9c4e6,
  ambientGround: 0x121d29,
  ambientIntensity: 1.9,
  sun: 0xb4c8ee,
  sunIntensity: 1.25,
  sunAzimuth: 300,
  sunElevation: 42,
};

/** Room colours by kind: [day, night]. */
export const ROOM_COLOURS: Record<RoomKind, [number, number]> = {
  lectureTheatre: [0xe27d5a, 0xe9895f],
  teaching: [0xecb45c, 0xe7b05a],
  computerLab: [0x5fa3b8, 0x5fb0c9],
  lab: [0x78b37f, 0x6dba7c],
  studio: [0xb98abc, 0xc08fc6],
  study: [0x8f9de0, 0x93a4ea],
  library: [0xa58a7c, 0xb39a8a],
  studentHub: [0xe58aae, 0xee93b6],
  other: [0xb5bcc4, 0x8696a8],
};

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function lerpColour(a: number, b: number, t: number): number {
  const r = lerpChannel((a >> 16) & 255, (b >> 16) & 255, t);
  const g = lerpChannel((a >> 8) & 255, (b >> 8) & 255, t);
  const bl = lerpChannel(a & 255, b & 255, t);
  return (r << 16) | (g << 8) | bl;
}

function lerpRecord<K extends string>(a: Record<K, number>, b: Record<K, number>, t: number): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of Object.keys(a) as K[]) out[k] = lerpColour(a[k], b[k], t);
  return out;
}

/** Blends two palettes; t = 0 gives `a`, t = 1 gives `b`. */
export function mixPalette(a: Palette, b: Palette, t: number): Palette {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const n = (x: number, y: number) => x + (y - x) * t;
  const c = (x: number, y: number) => lerpColour(x, y, t);
  return {
    sky: c(a.sky, b.sky),
    ground: c(a.ground, b.ground),
    fog: c(a.fog, b.fog),
    road: lerpRecord(a.road, b.road, t),
    roadEdge: c(a.roadEdge, b.roadEdge),
    rail: c(a.rail, b.rail),
    area: lerpRecord(a.area, b.area, t),
    tree: c(a.tree, b.tree),
    context: c(a.context, b.context),
    uni: c(a.uni, b.uni),
    uniTeaching: c(a.uniTeaching, b.uniTeaching),
    uniRoof: c(a.uniRoof, b.uniRoof),
    uniRoofTeaching: c(a.uniRoofTeaching, b.uniRoofTeaching),
    uniEdge: c(a.uniEdge, b.uniEdge),
    accent: c(a.accent, b.accent),
    hover: c(a.hover, b.hover),
    slab: c(a.slab, b.slab),
    slabBelow: c(a.slabBelow, b.slabBelow),
    space: lerpRecord(a.space, b.space, t),
    planWall: c(a.planWall, b.planWall),
    planEdge: c(a.planEdge, b.planEdge),
    roomEdge: c(a.roomEdge, b.roomEdge),
    ambient: c(a.ambient, b.ambient),
    ambientGround: c(a.ambientGround, b.ambientGround),
    ambientIntensity: n(a.ambientIntensity, b.ambientIntensity),
    sun: c(a.sun, b.sun),
    sunIntensity: n(a.sunIntensity, b.sunIntensity),
    sunAzimuth: t < 0.5 ? a.sunAzimuth : b.sunAzimuth,
    sunElevation: n(a.sunElevation, b.sunElevation),
  };
}
