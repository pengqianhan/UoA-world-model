// The rules the ground is drawn by in the walker views: what each surface OpenStreetMap maps is
// made of, how wide a street is, and where its kerbs and painted lines run. Nothing here is known
// about a real street. OpenStreetMap gives the line down the middle of a road, path or railway and
// its class, and the outline of a park or a pond; the widths, the asphalt, the kerbs, the white
// lines, the paving slabs, the treads of steps and the sleepers of a railway are all drawn by rule
// from those, the same way on every load. There are no crossings, arrows or signs, since none are
// mapped. Plain numbers, so that tests can check them without a GPU; ground.ts draws them, and its
// shader repeats lineCover.
import type { AreaClass, RoadClass } from "../../shared/types.ts";

/** Metres across the carriageway or path of each class, as the map draws it. */
export const ROAD_WIDTH: Readonly<Record<RoadClass, number>> = { motorway: 15, major: 11, street: 7.5, service: 4.2, path: 2.2, steps: 2.2 };
/** Metres the strip under a street, a major road or a motorway is wider than it: a kerb and the start of the footpath on each side. */
export const ROAD_EDGE_WIDTH = 1.6;
/** Metres across a railway's track bed. */
export const RAIL_WIDTH = 2.6;

/**
 * Every surface on the ground, in the order the map lays its paint (CampusScene.setContext): open
 * ground first, then areas, the strips under streets, paths, roads and railways. A later surface
 * covers an earlier one where both are mapped.
 */
export const GROUND = { open: 0, park: 1, grass: 2, wood: 3, pitch: 4, water: 5, edge: 6, path: 7, steps: 8, service: 9, street: 10, major: 11, motorway: 12, rail: 13 } as const;
export type GroundKind = keyof typeof GROUND;

/** What each surface is drawn as. */
export type Surface = "ground" | "turf" | "water" | "kerb" | "slabs" | "treads" | "asphalt" | "track";

export const SURFACE: Readonly<Record<GroundKind, Surface>> = {
  open: "ground",
  park: "turf",
  grass: "turf",
  // Under trees: the lawn in their shade, darker, with fallen leaves here and there.
  wood: "turf",
  // Grass, with no lines: nothing says which game is played on it.
  pitch: "turf",
  water: "water",
  edge: "kerb",
  path: "slabs",
  steps: "treads",
  service: "asphalt",
  street: "asphalt",
  major: "asphalt",
  motorway: "asphalt",
  rail: "track",
};

/** The surface of an area OpenStreetMap maps, and of a road of each class. */
export function areaSurface(k: AreaClass): Surface {
  return SURFACE[k];
}
export function roadSurface(k: RoadClass): Surface {
  return SURFACE[k];
}

/** White lines on a carriageway: a broken line down the middle, a solid line along each edge. */
export interface Markings {
  centre: boolean;
  edges: boolean;
}

/**
 * Which lines each class of road gets. A street and a major road have a centre line, a major road
 * and a motorway edge lines; a service lane, a path and steps none. One-way streets are not told
 * apart, so every street gets a centre line.
 */
export const MARKINGS: Readonly<Record<RoadClass, Markings>> = {
  motorway: { centre: false, edges: true },
  major: { centre: true, edges: true },
  street: { centre: true, edges: false },
  service: { centre: false, edges: false },
  path: { centre: false, edges: false },
  steps: { centre: false, edges: false },
};

/** New Zealand's lines: white, 100 mm wide; a centre line of 3 m lines with 7 m gaps. */
export const LINE_WIDTH = 0.1;
export const DASH = 3;
export const DASH_PERIOD = 10;
/** Metres in from the edge of the carriageway an edge line runs: inside the channel of a major road, on a motorway's shoulder. */
export const EDGE_LINE_IN: Readonly<Record<"major" | "motorway", number>> = { major: 0.55, motorway: 0.7 };
/** Metres from either end of a road its lines stop, so that none runs through a junction; and over how far they fade in. */
export const LINE_STOP = 5;
export const LINE_FADE = 1.5;
/** The concrete channel along both sides of a street or a major road, metres wide. */
export const CHANNEL = 0.3;
/** A kerb: metres of its upright face, as seen from above, and of its top, before the footpath. */
export const KERB_FACE = 0.12;
export const KERB_TOP = 0.15;
/** Metres between the joints across a footpath's concrete, and across a kerb. */
export const SLAB = 1.5;
export const KERB_UNIT = 1;
/** Metres from one step's nosing to the next. */
export const TREAD = 0.3;
/** A railway: New Zealand's 1067 mm gauge, the head of a rail, and concrete sleepers. */
export const GAUGE = 1.067;
export const RAIL_HEAD = 0.07;
export const SLEEPER_LENGTH = 2.1;
export const SLEEPER_WIDTH = 0.25;
export const SLEEPER_SPACING = 0.65;

/** How far along each band [a, b] of every whole period a stretch w wide round x lies: 0-1. */
function pulseSum(x: number, a: number, b: number): number {
  return Math.floor(x) * (b - a) + Math.min(b, Math.max(a, x - Math.floor(x)));
}
/**
 * The share of a stretch `w` wide round `x` that falls on [a, b] of each whole period: a stripe
 * drawn without stepping, which fades to its average once a pixel is wider than it. The shader's
 * gdPulse is the same.
 */
export function pulse(x: number, a: number, b: number, w: number): number {
  const ww = Math.max(w, 1e-4);
  return Math.min(1, Math.max(0, (pulseSum(x + 0.5 * ww, a, b) - pulseSum(x - 0.5 * ww, a, b)) / ww));
}
/** The same for one band [a, b]. The shader's gdBox. */
export function box(x: number, a: number, b: number, w: number): number {
  const ww = Math.max(w, 1e-4);
  const clamp = (v: number) => Math.min(b, Math.max(a, v));
  return Math.min(1, Math.max(0, (clamp(x + 0.5 * ww) - clamp(x - 0.5 * ww)) / ww));
}

/** Where a point of a carriageway is: metres along the road from its start and across it from the middle (left positive). */
export interface RoadPoint {
  along: number;
  across: number;
  /** Metres of the whole road, end to end. */
  length: number;
}

/**
 * How much of a patch of carriageway is white line, 0-1: `w` and `h` are how many metres the patch
 * spans along the road and across it (a pixel, in the shader). Lines stop short of each end of
 * the road, where it meets another at a junction.
 */
export function lineCover(k: RoadClass, p: RoadPoint, w = 0, h = 0): number {
  const m = MARKINGS[k];
  if (!m.centre && !m.edges) return 0;
  const half = ROAD_WIDTH[k] / 2;
  const fromEnd = Math.min(p.along, p.length - p.along);
  const ends = Math.min(1, Math.max(0, (fromEnd - LINE_STOP) / LINE_FADE));
  let cover = 0;
  if (m.centre) {
    const dash = pulse(p.along / DASH_PERIOD, 0, DASH / DASH_PERIOD, w / DASH_PERIOD);
    cover = Math.max(cover, dash * box(p.across, -LINE_WIDTH / 2, LINE_WIDTH / 2, h));
  }
  if (m.edges) {
    const inner = half - EDGE_LINE_IN[k as "major" | "motorway"];
    cover = Math.max(cover, box(Math.abs(p.across), inner - LINE_WIDTH, inner, h));
  }
  return cover * ends;
}

/** Which part of the strip under a street a point is on, from its distance out from the carriageway's edge. */
export function kerbPart(out: number): "face" | "top" | "footpath" {
  return out < KERB_FACE ? "face" : out < KERB_FACE + KERB_TOP ? "top" : "footpath";
}
