// What a walker sees from where it stands: the University buildings round it, which way each
// lies, how far its walls are, and what is straight ahead. In plain words and numbers, for a
// person or an agent steering the walker. Pure, so that it can be tested without a browser.
import type { Pt } from "./geo.ts";

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;

/** Compass bearing in degrees, clockwise from north, from one point to another (metres east, north). */
export function bearing(from: Pt, to: Pt): number {
  const deg = (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** The nearest of the eight compass points to a bearing. */
export function compass(deg: number): (typeof COMPASS)[number] {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/** Where a bearing lies for someone facing `heading`: ahead, to the left, behind... */
export function relative(heading: number, deg: number): string {
  const d = ((deg - heading + 540) % 360) - 180;
  const a = Math.abs(d);
  const side = d < 0 ? "left" : "right";
  if (a <= 25) return "ahead";
  if (a <= 70) return `ahead to the ${side}`;
  if (a <= 110) return `to the ${side}`;
  if (a <= 155) return `behind to the ${side}`;
  return "behind";
}

/** A University building as the walker sees it. */
export interface SeenBuilding {
  id: string;
  name: string;
  /** Metres to its nearest wall. */
  distance: number;
  bearing: number;
  compass: string;
  side: string;
  learningSpaces: number;
  floors: number;
}

export interface LookInput {
  at: Pt;
  heading: number;
  /** Every University building near enough to matter, with its distance to the walker. */
  buildings: { id: string; name: string; distance: number; centre: Pt; learningSpaces: number; floors: number }[];
  /** The first building straight ahead, and how far, if any within sight. */
  ahead?: { id: string; distance: number };
}

export interface Look {
  facing: { bearing: number; compass: string };
  nearby: SeenBuilding[];
  ahead?: { id: string; name: string; distance: number };
}

/** The buildings round the walker, nearest first, at most `limit` within `range` metres. */
export function look(input: LookInput, limit = 6, range = 350): Look {
  const nearby = input.buildings
    .filter((b) => b.distance <= range)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((b) => {
      const deg = bearing(input.at, b.centre);
      return {
        id: b.id,
        name: b.name,
        distance: Math.round(b.distance),
        bearing: Math.round(deg),
        compass: compass(deg),
        side: relative(input.heading, deg),
        learningSpaces: b.learningSpaces,
        floors: b.floors,
      };
    });
  const aheadName = input.ahead ? input.buildings.find((b) => b.id === input.ahead!.id)?.name ?? "" : "";
  return {
    facing: { bearing: Math.round(input.heading), compass: compass(input.heading) },
    nearby,
    ahead: input.ahead ? { id: input.ahead.id, name: aheadName, distance: Math.round(input.ahead.distance) } : undefined,
  };
}

/** One building in a sentence: "109 General Library, 12 m to the left (north-west)". */
export function describeBuilding(b: SeenBuilding): string {
  const name = b.name && !/^Building /.test(b.name) ? ` ${b.name}` : "";
  const where = b.distance < 1 ? "here" : `${b.distance} m ${b.side} (${b.compass})`;
  return `${b.id}${name}, ${where}`;
}
