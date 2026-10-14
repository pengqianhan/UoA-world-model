// Geometry builders. Data coordinates are [east, north] in decimetres; the scene uses metres with
// x = east, y = up, z = -north (so north is "into" the screen at the default camera angle).
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from "three";
import { boundingRectangle, type Pt } from "../shared/geo.ts";
import type { ContextRoof, FlatRing } from "../shared/types.ts";

type RGB = readonly [number, number, number];

/** How the walls of an extrusion are textured and closed. */
export interface WallOptions {
  /** Metres. The wall texture repeats once per storey. */
  storey?: number;
  /** Metres. The wall texture repeats about once per bay along each face. */
  bay?: number;
  /** Close the underside, which a block that overhangs the one below needs to cast a whole shadow. */
  bottom?: boolean;
  /** Put the roof in the mesh's second material group, so that it can take a colour of its own. */
  roofGroup?: boolean;
  /** Tint the walls below this height, in metres, differently: the ground storey of a building. */
  plinth?: { top: number; color: RGB };
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
  /** Triangles of the second material group: the roofs of an extrusion that asked for one. */
  readonly roofIndices: number[] = [];
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
  private upFacing(base: number, pts: readonly Vector2[], tri: readonly number[], into = this.indices): void {
    const a = pts[tri[0]!]!;
    const b = pts[tri[1]!]!;
    const c = pts[tri[2]!]!;
    const ccw = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) > 0;
    if (ccw) into.push(base + tri[0]!, base + tri[1]!, base + tri[2]!);
    else into.push(base + tri[0]!, base + tri[2]!, base + tri[1]!);
  }

  /**
   * Extrudes a polygon (outer ring + holes, flat decimetre rings) from y0 to y1.
   * `topColor` tints the roof and `sideColor` the walls when the builder has vertex colours.
   * With UVs enabled, `wall` says how the wall texture repeats; the roof samples its plain part.
   */
  extrude(rings: readonly FlatRing[], y0: number, y1: number, topColor?: RGB, sideColor?: RGB, cap = true, wall: WallOptions = {}): void {
    const { storey = 0, bay = 0, bottom = false, roofGroup = false, plinth } = wall;
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
      for (const tri of ShapeUtils.triangulateShape(contour, holes)) this.upFacing(base, all, tri, roofGroup ? this.roofIndices : this.indices);
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

    // One band of wall from the bottom to the top, or two where a plinth ends part of the way up.
    const split = plinth && plinth.top > y0 + 1e-6 && plinth.top < y1 - 1e-6 ? plinth.top : undefined;
    const bands: [number, number, RGB | undefined][] =
      split !== undefined
        ? [
            [y0, split, plinth!.color],
            [split, y1, sideColor],
          ]
        : [[y0, y1, plinth && plinth.top >= y1 - 1e-6 ? plinth.color : sideColor]];
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
        for (const [from, to, color] of bands) {
          const v0 = storey > 0 ? from / storey : 0.05;
          const v1 = storey > 0 ? to / storey : 0.05;
          const i0 = this.vertex(a.x, from, -a.y, nx, 0, nz, color, v0, ua);
          const i1 = this.vertex(b.x, from, -b.y, nx, 0, nz, color, v0, ub);
          const i2 = this.vertex(b.x, to, -b.y, nx, 0, nz, color, v1, ub);
          const i3 = this.vertex(a.x, to, -a.y, nx, 0, nz, color, v1, ua);
          this.indices.push(i0, i1, i2, i0, i2, i3);
        }
      }
    };
    walls(contour);
    for (const h of holes) walls(h);
  }

  /**
   * A wall with no thickness from y0 to y1 along a segment given in metres east and north, drawn
   * to be seen from both sides: a parapet. Its faces sample the plain part of the wall texture.
   */
  fence(ax: number, ay: number, bx: number, by: number, y0: number, y1: number, color?: RGB): void {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-4) return;
    // The right of the direction of travel, in scene axes (x east, z south).
    const nx = (by - ay) / len;
    const nz = (bx - ax) / len;
    for (const side of [1, -1]) {
      const i = this.vertexCount;
      this.vertex(ax, y0, -ay, nx * side, 0, nz * side, color);
      this.vertex(bx, y0, -by, nx * side, 0, nz * side, color);
      this.vertex(bx, y1, -by, nx * side, 0, nz * side, color);
      this.vertex(ax, y1, -ay, nx * side, 0, nz * side, color);
      if (side > 0) this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      else this.indices.push(i, i + 2, i + 1, i, i + 3, i + 2);
    }
  }

  /** One flat-shaded triangle from points given as [east, height, north], wound to face out and up. */
  private face(a: readonly number[], b: readonly number[], c: readonly number[], color?: RGB): void {
    // Scene axes: x is east, y is up, z is south.
    const ux = b[0]! - a[0]!;
    const uy = b[1]! - a[1]!;
    const uz = a[2]! - b[2]!;
    const vx = c[0]! - a[0]!;
    const vy = c[1]! - a[1]!;
    const vz = a[2]! - c[2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) return;
    const i = this.vertexCount;
    for (const p of [a, b, c]) this.vertex(p[0]!, p[1]!, -p[2]!, nx / len, ny / len, nz / len, color);
    this.indices.push(i, i + 1, i + 2);
  }

  /**
   * A roof over a ring whose walls end at height y. Every shape but the skillion is a skirt from
   * the eaves up to a ridge: a full-length ridge makes a gable, a shortened one a hip, a single
   * point a pyramid; a round profile turns those into a barrel and a dome. Exact on a rectangle,
   * an approximation on anything else.
   */
  roof(ring: FlatRing, y: number, roof: ContextRoof, color?: RGB): void {
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i]! / 10, ring[i + 1]! / 10]);
    if (pts.length < 3) return;
    // Counter-clockwise in (east, north), so that faces come out wound upwards.
    let twice = 0;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      twice += p[0] * q[1] - q[0] * p[1];
    });
    if (twice < 0) pts.reverse();
    const box = boundingRectangle(pts);

    if (roof.k === "skillion") {
      // One plane, falling towards the bearing, or across the short side when none is given.
      const rad = roof.bearing !== undefined ? (roof.bearing * Math.PI) / 180 : undefined;
      const fall: Pt = rad !== undefined ? [Math.sin(rad), Math.cos(rad)] : [-Math.sin(box.angle), Math.cos(box.angle)];
      const along = pts.map((p) => p[0] * fall[0] + p[1] * fall[1]);
      const lo = Math.min(...along);
      const span = Math.max(...along) - lo || 1;
      const top = pts.map((p, i): number[] => [p[0], y + roof.h * (1 - (along[i]! - lo) / span), p[1]]);
      const flat = pts.map((p) => new Vector2(p[0], p[1]));
      for (const [i, j, k] of ShapeUtils.triangulateShape(flat, []) as [number, number, number][]) {
        const ccw = (flat[j]!.x - flat[i]!.x) * (flat[k]!.y - flat[i]!.y) - (flat[k]!.x - flat[i]!.x) * (flat[j]!.y - flat[i]!.y) > 0;
        this.face(top[i]!, top[ccw ? j : k]!, top[ccw ? k : j]!, color);
      }
      pts.forEach((p, i) => {
        const j = (i + 1) % pts.length;
        const q = pts[j]!;
        this.face([p[0], y, p[1]], [q[0], y, q[1]], top[j]!, color);
        this.face([p[0], y, p[1]], top[j]!, top[i]!, color);
      });
      return;
    }

    const angle = box.angle + (roof.across ? Math.PI / 2 : 0);
    const dir: Pt = [Math.cos(angle), Math.sin(angle)];
    const run = roof.across ? box.width : box.length;
    const span = roof.across ? box.length : box.width;
    const half = roof.k === "gabled" || roof.k === "round" ? run / 2 : roof.k === "hipped" ? Math.max(0, (run - span) / 2) : 0;
    const steps = roof.k === "dome" || roof.k === "round" ? 5 : 1;
    // The point of the ridge that a point of the eaves rises to.
    const ridge = (p: Pt): Pt => {
      const t = Math.max(-half, Math.min(half, (p[0] - box.centre[0]) * dir[0] + (p[1] - box.centre[1]) * dir[1]));
      return [box.centre[0] + dir[0] * t, box.centre[1] + dir[1] * t];
    };
    const at = (p: Pt, k: number): number[] => {
      const turn = ((k / steps) * Math.PI) / 2;
      const inward = steps === 1 ? k : 1 - Math.cos(turn);
      const up = steps === 1 ? k : Math.sin(turn);
      const r = ridge(p);
      return [p[0] + (r[0] - p[0]) * inward, y + roof.h * up, p[1] + (r[1] - p[1]) * inward];
    };
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      for (let k = 0; k < steps; k++) {
        this.face(at(p, k), at(q, k), at(q, k + 1), color);
        this.face(at(p, k), at(q, k + 1), at(p, k + 1), color);
      }
    });
  }

  /** A flat polygon at height y (no walls), in the second material group when `second` is set. */
  flat(ring: FlatRing, y: number, color?: RGB, second = false): void {
    if (ring.length < 6) return;
    const contour: Vector2[] = [];
    for (let i = 0; i + 1 < ring.length; i += 2) contour.push(new Vector2(ring[i]! / 10, ring[i + 1]! / 10));
    const base = this.vertexCount;
    for (const p of contour) this.vertex(p.x, y, -p.y, 0, 1, 0, color);
    for (const tri of ShapeUtils.triangulateShape(contour, [])) this.upFacing(base, contour, tri, second ? this.roofIndices : this.indices);
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
    g.setIndex(new BufferAttribute(new Index(this.roofIndices.length ? this.indices.concat(this.roofIndices) : this.indices), 1));
    if (this.roofIndices.length) {
      g.addGroup(0, this.indices.length, 0);
      g.addGroup(this.indices.length, this.roofIndices.length, 1);
    }
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

/**
 * A flat geometry laid over the ground: its triangles split until no edge is longer than
 * `maxEdge` metres, then each vertex raised by the ground under it. Normals stay straight up,
 * which suits paint on the ground. Only positions are kept.
 */
export function drape(g: BufferGeometry, ground: (east: number, north: number) => number, maxEdge = 10): BufferGeometry {
  const pos = g.getAttribute("position");
  const index = g.getIndex();
  const out: number[] = [];
  const limit = maxEdge * maxEdge;
  type V = [number, number, number];
  const d2 = (a: V, b: V) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;
  const mid = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  // Split the longest edge at its middle; both halves keep the triangle's winding.
  const tri = (a: V, b: V, c: V): void => {
    const ab = d2(a, b);
    const bc = d2(b, c);
    const ca = d2(c, a);
    const m = Math.max(ab, bc, ca);
    if (m <= limit) {
      out.push(...a, ...b, ...c);
      return;
    }
    if (m === ab) {
      const d = mid(a, b);
      tri(a, d, c);
      tri(d, b, c);
    } else if (m === bc) {
      const d = mid(b, c);
      tri(a, b, d);
      tri(a, d, c);
    } else {
      const d = mid(c, a);
      tri(a, b, d);
      tri(d, b, c);
    }
  };
  const v = (i: number): V => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  const count = index ? index.count : pos.count;
  for (let k = 0; k + 2 < count; k += 3) {
    const [i, j, l] = index ? [index.getX(k), index.getX(k + 1), index.getX(k + 2)] : [k, k + 1, k + 2];
    tri(v(i), v(j), v(l));
  }
  for (let k = 0; k < out.length; k += 3) out[k + 1] = out[k + 1]! + ground(out[k]!, -out[k + 2]!);
  const normals = new Float32Array(out.length);
  for (let k = 1; k < normals.length; k += 3) normals[k] = 1;
  const draped = new BufferGeometry();
  draped.setAttribute("position", new BufferAttribute(new Float32Array(out), 3));
  draped.setAttribute("normal", new BufferAttribute(normals, 3));
  return draped;
}
