// The ground under the map: heights from the published grids (public/data/terrain/<area>.json),
// sampled between grid points, and a mesh for each grid with skirts down to the sea plane.
import { BufferAttribute, BufferGeometry } from "three";
import type { FlatRing, TerrainData } from "../shared/types.ts";

/** Height of the flat plane under and around the grids, metres: just below the lowest ground kept. */
export const SEA_PLANE = -2.5;
/** The most a building's floor stands above its lowest corner, metres; a footing fills the rest. */
const FOOTING = 4;

interface Field {
  data: TerrainData;
  heights: Int16Array;
  /** The mesh's normal at each grid point, worked out when first asked for (see `normal`). */
  normals?: Float32Array;
}

export class Terrain {
  private fields: Field[];

  constructor(grids: TerrainData[]) {
    this.fields = grids.map((data) => {
      const bytes = Uint8Array.from(atob(data.h), (c) => c.charCodeAt(0));
      return { data, heights: new Int16Array(bytes.buffer, 0, data.cols * data.rows) };
    });
  }

  get grids(): TerrainData[] {
    return this.fields.map((f) => f.data);
  }

  /** Ground height in metres at a point, metres east and north of the origin; 0 outside every grid. */
  height(x: number, y: number): number {
    for (const f of this.fields) {
      const { x0, y0, step, cols, rows } = f.data;
      const gx = (x - x0) / step;
      const gy = (y - y0) / step;
      if (gx < 0 || gy < 0 || gx > cols - 1 || gy > rows - 1) continue;
      const c = Math.min(cols - 2, Math.floor(gx));
      const r = Math.min(rows - 2, Math.floor(gy));
      const fx = gx - c;
      const fy = gy - r;
      const h = (cc: number, rr: number) => f.heights[rr * cols + cc]! / 10;
      return (h(c, r) * (1 - fx) + h(c + 1, r) * fx) * (1 - fy) + (h(c, r + 1) * (1 - fx) + h(c + 1, r + 1) * fx) * fy;
    }
    return 0;
  }

  /**
   * The normal of the ground's mesh at a point, metres east and north, in scene axes (x east, y up,
   * z south), written to `out`: the normals of the corners of the mesh's triangle there, weighted
   * as the mesh shades between them. Straight up outside every grid. The walker views shade paint
   * on the ground with it, so that a road on a slope is lit as the slope round it is.
   */
  normal(x: number, y: number, out: number[]): void {
    for (const f of this.fields) {
      const { x0, y0, step, cols, rows } = f.data;
      const gx = (x - x0) / step;
      const gy = (y - y0) / step;
      if (gx < 0 || gy < 0 || gx > cols - 1 || gy > rows - 1) continue;
      const n = (f.normals ??= Terrain.gridNormals(f.data, f.heights));
      const c = Math.min(cols - 2, Math.floor(gx));
      const r = Math.min(rows - 2, Math.floor(gy));
      const fx = gx - c;
      const fy = gy - r;
      const a = (r * cols + c) * 3;
      // The triangles of each cell are (a, b, e) below its diagonal and (a, e, d) above (Terrain.mesh).
      const below = fx >= fy;
      const q = below ? a + 3 : a + (cols + 1) * 3;
      const s = below ? a + (cols + 1) * 3 : a + cols * 3;
      const wp = below ? 1 - fx : 1 - fy;
      const wq = below ? fx - fy : fx;
      const ws = below ? fy : fy - fx;
      const nx = n[a]! * wp + n[q]! * wq + n[s]! * ws;
      const ny = n[a + 1]! * wp + n[q + 1]! * wq + n[s + 1]! * ws;
      const nz = n[a + 2]! * wp + n[q + 2]! * wq + n[s + 2]! * ws;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      out[0] = nx / len;
      out[1] = ny / len;
      out[2] = nz / len;
      return;
    }
    out[0] = 0;
    out[1] = 1;
    out[2] = 0;
  }

  /**
   * The normal at every point of a grid as its mesh has it (BufferGeometry.computeVertexNormals):
   * the sum of the normals of the triangles round the point, each as large as its triangle.
   */
  static gridNormals(f: TerrainData, heights: Int16Array): Float32Array {
    const { step, cols, rows } = f;
    const out = new Float32Array(cols * rows * 3);
    const h = (i: number) => heights[i]! / 10;
    const add = (i: number, x: number, y: number, z: number) => {
      out[i * 3]! += x;
      out[i * 3 + 1]! += y;
      out[i * 3 + 2]! += z;
    };
    // One triangle (A, B, C) of the mesh: (C - B) x (A - B), added to each corner.
    const face = (A: number, B: number, C: number, pa: number[], pb: number[], pc: number[]) => {
      const cb = [pc[0]! - pb[0]!, pc[1]! - pb[1]!, pc[2]! - pb[2]!];
      const ab = [pa[0]! - pb[0]!, pa[1]! - pb[1]!, pa[2]! - pb[2]!];
      const x = cb[1]! * ab[2]! - cb[2]! * ab[1]!;
      const y = cb[2]! * ab[0]! - cb[0]! * ab[2]!;
      const z = cb[0]! * ab[1]! - cb[1]! * ab[0]!;
      add(A, x, y, z);
      add(B, x, y, z);
      add(C, x, y, z);
    };
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c + 1 < cols; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        // Scene positions relative to the cell's corner a: x east, z = -north.
        const pa = [0, h(a), 0];
        const pb = [step, h(b), 0];
        const pd = [0, h(d), -step];
        const pe = [step, h(e), -step];
        face(a, b, e, pa, pb, pe);
        face(a, e, d, pa, pe, pd);
      }
    }
    for (let i = 0; i < cols * rows; i++) {
      const len = Math.hypot(out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!) || 1;
      out[i * 3]! /= len;
      out[i * 3 + 1]! /= len;
      out[i * 3 + 2]! /= len;
    }
    return out;
  }

  /**
   * Where a building stands on the ground. `base` is the ground at its middle, but never more
   * than FOOTING above its lowest corner: on a slope the uphill side goes into the hill, as real
   * buildings do, and a footing fills the gap down to `low` on the other side, so nothing floats.
   * Near a cliff or the shore the source's smooth ground would otherwise bury a building or hang
   * it in the air.
   */
  footing(ring: FlatRing): { base: number; low: number } {
    let low = Infinity;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i + 1 < ring.length; i += 2) {
      const x = ring[i]! / 10;
      const y = ring[i + 1]! / 10;
      low = Math.min(low, this.height(x, y));
      sx += x;
      sy += y;
    }
    const n = ring.length / 2;
    if (!n) return { base: 0, low: 0 };
    const middle = this.height(sx / n, sy / n);
    low = Math.min(low, middle);
    return { base: Math.min(middle, low + FOOTING), low };
  }

  /** One grid as a mesh, with a skirt down to the sea plane round its edge. */
  static mesh(f: TerrainData, heights: (c: number, r: number) => number): BufferGeometry {
    const { x0, y0, step, cols, rows } = f;
    const positions: number[] = [];
    const index: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) positions.push(x0 + c * step, heights(c, r), -(y0 + r * step));
    }
    for (let r = 0; r + 1 < rows; r++) {
      for (let c = 0; c + 1 < cols; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        // Counter-clockwise seen from above (y up, z = -north).
        index.push(a, b, e, a, e, d);
      }
    }
    // The skirt: round the edge, anticlockwise from above, each edge point once at the ground and
    // once at the sea plane. Its own copies, so the wall's normals do not bend the ground's.
    const edge: number[] = [];
    for (let c = 0; c < cols; c++) edge.push(c);
    for (let r = 1; r < rows; r++) edge.push(r * cols + cols - 1);
    for (let c = cols - 2; c >= 0; c--) edge.push((rows - 1) * cols + c);
    for (let r = rows - 2; r > 0; r--) edge.push(r * cols);
    const base = positions.length / 3;
    for (const v of edge) {
      positions.push(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
      positions.push(positions[v * 3]!, SEA_PLANE, positions[v * 3 + 2]!);
    }
    for (let k = 0; k < edge.length; k++) {
      const top = base + 2 * k;
      const next = base + 2 * ((k + 1) % edge.length);
      index.push(top, top + 1, next + 1, top, next + 1, next);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }

  /** The meshes of every grid. */
  meshes(): BufferGeometry[] {
    return this.fields.map((f) => Terrain.mesh(f.data, (c, r) => f.heights[r * f.data.cols + c]! / 10));
  }
}
