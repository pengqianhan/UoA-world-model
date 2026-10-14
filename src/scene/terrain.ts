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
