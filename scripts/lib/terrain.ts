// The ground's height under the map, from the AWS Open Data "Terrain Tiles" (terrarium PNGs, no
// key, no account). Over New Zealand they hold the LINZ 8 m Digital Elevation Model (2012), which
// is built from contours: bare ground, smooth, with sharp peaks a few metres low. Zoom 14 is about
// 7.7 m a pixel here and matches it; zoom 15 adds nothing (checked 2026-10-15).
import type { SceneArea } from "./areas.ts";

export const TERRAIN_ZOOM = 14;
export const TERRAIN_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const terrainFile = (z: number, x: number, y: number) => `terrain/${z}/${x}/${y}.png`;

/**
 * How far past an area's box the ground reaches, in metres: far enough that the edge of the
 * ground stays out of the usual view of the campus.
 */
export const TERRAIN_MARGIN = { central: 700, remote: 500 };

/** An area's box widened by a margin in metres: south, west, north, east. */
export function terrainBox(area: SceneArea): [number, number, number, number] {
  const m = area.id === "central" ? TERRAIN_MARGIN.central : TERRAIN_MARGIN.remote;
  const [s, w, n, e] = area.bbox;
  const dLat = m / 111_000;
  const dLon = m / (111_000 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return [s - dLat, w - dLon, n + dLat, e + dLon];
}

/** Web Mercator pixel of a point at a zoom, for 256-pixel tiles. */
export function globalPixel(lon: number, lat: number, z: number): [number, number] {
  const n = 256 * 2 ** z;
  const phi = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n];
}

/** The tiles covering a box at a zoom. */
export function tilesFor(box: [number, number, number, number], z: number): [number, number][] {
  const [s, w, n, e] = box;
  const [x0, y0] = globalPixel(w, n, z).map((v) => Math.floor(v / 256));
  const [x1, y1] = globalPixel(e, s, z).map((v) => Math.floor(v / 256));
  const out: [number, number][] = [];
  for (let x = x0!; x <= x1!; x++) for (let y = y0!; y <= y1!; y++) out.push([x, y]);
  return out;
}

/** Elevation in metres from a terrarium pixel. */
export const terrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;
