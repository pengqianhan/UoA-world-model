// Geometry builders. Data coordinates are [east, north] in decimetres; the scene uses metres with
// x = east, y = up, z = -north (so north is "into" the screen at the default camera angle).
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from "three";
import type { FlatRing } from "../shared/types.ts";

type RGB = readonly [number, number, number];

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

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, c?: RGB, v = 0.05): number {
    const i = this.vertexCount;
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    if (this.withColor) this.colors.push(c?.[0] ?? 1, c?.[1] ?? 1, c?.[2] ?? 1);
    if (this.withUV) this.uvs.push(0.5, v);
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
   * With UVs enabled, `storey` (metres) makes the wall texture repeat once per storey while the
   * roof samples the plain part of the texture.
   */
  extrude(rings: readonly FlatRing[], y0: number, y1: number, topColor?: RGB, sideColor?: RGB, cap = true, storey = 0): void {
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

    const v0 = storey > 0 ? y0 / storey : 0.05;
    const v1 = storey > 0 ? y1 / storey : 0.05;
    const wall = (ring: Vector2[]) => {
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
        const i0 = this.vertex(a.x, y0, -a.y, nx, 0, nz, sideColor, v0);
        const i1 = this.vertex(b.x, y0, -b.y, nx, 0, nz, sideColor, v0);
        const i2 = this.vertex(b.x, y1, -b.y, nx, 0, nz, sideColor, v1);
        const i3 = this.vertex(a.x, y1, -a.y, nx, 0, nz, sideColor, v1);
        this.indices.push(i0, i1, i2, i0, i2, i3);
      }
    };
    wall(contour);
    for (const h of holes) wall(h);
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
