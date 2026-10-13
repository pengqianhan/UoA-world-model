// Geometry builders. Data coordinates are [east, north] in decimetres; the scene uses metres with
// x = east, y = up, z = -north (so north is "into" the screen at the default camera angle).
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from "three";
import type { FlatRing } from "../shared/types.ts";

type RGB = readonly [number, number, number];

/** How the walls of an extrusion are textured and closed. */
export interface WallOptions {
  /** Metres. The wall texture repeats once per storey. */
  storey?: number;
  /** Metres. The wall texture repeats about once per bay along each face. */
  bay?: number;
  /** Close the underside, which a block that overhangs the one below needs to cast a whole shadow. */
  bottom?: boolean;
}

/** A turn sharper than this, in radians, ends one face of a building and starts the next. */
const CORNER = 0.5;

/**
 * Texture u at the start and end of each edge of a ring, so that every face carries a whole number
 * of window bays. A face is a run of edges between two corners, so a curve drawn as many short
 * edges is one face. A face too short for a bay keeps u = 0, the plain pier of the texture.
 */
function bayCoords(ring: readonly Vector2[], bay: number): number[] {
  const n = ring.length;
  const len: number[] = [];
  const corner: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n]!;
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    len.push(Math.hypot(b.x - a.x, b.y - a.y));
    const turn = Math.atan2((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x), (a.x - p.x) * (b.x - a.x) + (a.y - p.y) * (b.y - a.y));
    corner.push(Math.abs(turn) > CORNER);
  }
  const out = new Array<number>(n * 2).fill(0);
  // A ring without corners, such as a round tower, is one face.
  let first = Math.max(0, corner.indexOf(true));
  for (let done = 0; done < n; ) {
    let run = 0;
    let count = 0;
    do {
      run += len[(first + count) % n]!;
      count++;
    } while (done + count < n && !corner[(first + count) % n]);
    const bays = Math.round(run / bay);
    let along = 0;
    for (let k = 0; k < count; k++) {
      const e = (first + k) % n;
      if (bays > 0) {
        out[e * 2] = (along / run) * bays;
        out[e * 2 + 1] = ((along + len[e]!) / run) * bays;
      }
      along += len[e]!;
    }
    first = (first + count) % n;
    done += count;
  }
  return out;
}

/** Growable arrays for one merged mesh with per-face normals. */
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];
  private withColor: boolean;
  private withUV: boolean;

  constructor(withColor = false, withUV = false) {
    this.withColor = withColor;
    this.withUV = withUV;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, c?: RGB, v = 0.05, u = 0.5): number {
    const i = this.vertexCount;
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    if (this.withColor) this.colors.push(c?.[0] ?? 1, c?.[1] ?? 1, c?.[2] ?? 1);
    if (this.withUV) this.uvs.push(u, v);
    return i;
  }

  /** Pushes a roof triangle wound so that it faces up (counter-clockwise seen from above). */
  private upFacing(base: number, pts: readonly Vector2[], tri: readonly number[]): void {
    const a = pts[tri[0]!]!;
    const b = pts[tri[1]!]!;
    const c = pts[tri[2]!]!;
    const ccw = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) > 0;
    if (ccw) this.indices.push(base + tri[0]!, base + tri[1]!, base + tri[2]!);
    else this.indices.push(base + tri[0]!, base + tri[2]!, base + tri[1]!);
  }

  /**
   * Extrudes a polygon (outer ring + holes, flat decimetre rings) from y0 to y1.
   * `topColor` tints the roof and `sideColor` the walls when the builder has vertex colours.
   * With UVs enabled, `wall` says how the wall texture repeats; the roof samples its plain part.
   */
  extrude(rings: readonly FlatRing[], y0: number, y1: number, topColor?: RGB, sideColor?: RGB, cap = true, wall: WallOptions = {}): void {
    const { storey = 0, bay = 0, bottom = false } = wall;
    const outer = rings[0];
    if (!outer || outer.length < 6) return;
    const toVec = (flat: FlatRing) => {
      const pts: Vector2[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) pts.push(new Vector2(flat[i]! / 10, flat[i + 1]! / 10));
      return pts;
    };
    // Normalise winding: outer ring counter-clockwise, holes clockwise (in east/north axes).
    const contour = toVec(outer);
    const holes = rings.slice(1).map(toVec).filter((h) => h.length >= 3);
    if (ShapeUtils.isClockWise(contour)) contour.reverse();
    for (const h of holes) if (!ShapeUtils.isClockWise(h)) h.reverse();

    if (cap) {
      const base = this.vertexCount;
      const all = holes.length ? contour.concat(...holes) : contour;
      for (const p of all) this.vertex(p.x, y1, -p.y, 0, 1, 0, topColor);
      for (const tri of ShapeUtils.triangulateShape(contour, holes)) this.upFacing(base, all, tri);
    }
    if (bottom) {
      const base = this.vertexCount;
      const all = holes.length ? contour.concat(...holes) : contour;
      for (const p of all) this.vertex(p.x, y0, -p.y, 0, -1, 0, sideColor);
      const from = this.indices.length;
      for (const tri of ShapeUtils.triangulateShape(contour, holes)) this.upFacing(base, all, tri);
      // Same triangles as a roof, turned over to face down.
      for (let i = from; i < this.indices.length; i += 3) {
        const swap = this.indices[i + 1]!;
        this.indices[i + 1] = this.indices[i + 2]!;
        this.indices[i + 2] = swap;
      }
    }

    const v0 = storey > 0 ? y0 / storey : 0.05;
    const v1 = storey > 0 ? y1 / storey : 0.05;
    const walls = (ring: Vector2[]) => {
      const us = bay > 0 ? bayCoords(ring, bay) : undefined;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-4) continue;
        // Outward normal of a counter-clockwise ring in (east, north), mapped to (x, z = -north).
        const nx = dy / len;
        const nz = dx / len;
        const ua = us?.[i * 2];
        const ub = us?.[i * 2 + 1];
        const i0 = this.vertex(a.x, y0, -a.y, nx, 0, nz, sideColor, v0, ua);
        const i1 = this.vertex(b.x, y0, -b.y, nx, 0, nz, sideColor, v0, ub);
        const i2 = this.vertex(b.x, y1, -b.y, nx, 0, nz, sideColor, v1, ub);
        const i3 = this.vertex(a.x, y1, -a.y, nx, 0, nz, sideColor, v1, ua);
        this.indices.push(i0, i1, i2, i0, i2, i3);
      }
    };
    walls(contour);
    for (const h of holes) walls(h);
  }

  /** A flat polygon at height y (no walls). */
  flat(ring: FlatRing, y: number, color?: RGB): void {
    if (ring.length < 6) return;
    const contour: Vector2[] = [];
    for (let i = 0; i + 1 < ring.length; i += 2) contour.push(new Vector2(ring[i]! / 10, ring[i + 1]! / 10));
    const base = this.vertexCount;
    for (const p of contour) this.vertex(p.x, y, -p.y, 0, 1, 0, color);
    for (const tri of ShapeUtils.triangulateShape(contour, [])) this.upFacing(base, contour, tri);
  }

  /** A flat ribbon of the given width along a polyline. */
  ribbon(line: FlatRing, width: number, y: number, color?: RGB): void {
    const n = line.length / 2;
    if (n < 2) return;
    const half = width / 2;
    const px = (i: number) => line[i * 2]! / 10;
    const py = (i: number) => line[i * 2 + 1]! / 10;
    const base = this.vertexCount;
    for (let i = 0; i < n; i++) {
      const ax = px(Math.max(i - 1, 0));
      const ay = py(Math.max(i - 1, 0));
      const bx = px(Math.min(i + 1, n - 1));
      const by = py(Math.min(i + 1, n - 1));
      let dx = bx - ax;
      let dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      // Left-hand normal in (east, north).
      const nx = -dy;
      const ny = dx;
      this.vertex(px(i) + nx * half, y, -(py(i) + ny * half), 0, 1, 0, color);
      this.vertex(px(i) - nx * half, y, -(py(i) - ny * half), 0, 1, 0, color);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      // Left edge is at even indices, right edge at odd; wind counter-clockwise seen from above.
      this.indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.normals), 3));
    if (this.withColor) g.setAttribute("color", new BufferAttribute(new Float32Array(this.colors), 3));
    if (this.withUV) g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uvs), 2));
    const Index = this.vertexCount > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new BufferAttribute(new Index(this.indices), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Bounding box of flat rings in scene metres: [minX, minZ, maxX, maxZ] where z = -north. */
export function ringsBounds(rings: readonly FlatRing[]): [number, number, number, number] {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      const x = r[i]! / 10;
      const z = -r[i + 1]! / 10;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
  }
  return [x0, z0, x1, z1];
}
