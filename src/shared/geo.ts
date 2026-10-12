// Small planar-geometry helpers shared by the data pipeline and the app.
// Points are [x, y] in metres in a local east/north frame.

export type Pt = [number, number];
export type Ring = Pt[];

export interface Origin {
  lat: number;
  lon: number;
}

/** Equirectangular projection around an origin; accurate to centimetres over a few kilometres. */
export function makeProjector(origin: Origin): (lon: number, lat: number) => Pt {
  const phi = (origin.lat * Math.PI) / 180;
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mPerDegLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return (lon, lat) => [(lon - origin.lon) * mPerDegLon, (lat - origin.lat) * mPerDegLat];
}

/** Signed area; positive when the ring is counter-clockwise. */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function ringArea(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

export function ringCentroid(ring: Ring): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    // Degenerate ring: fall back to the vertex average.
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(p: Pt, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function bbox(ring: Ring): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Drops a duplicated closing vertex and consecutive duplicates. */
export function cleanRing(ring: Ring, eps = 1e-3): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > eps || Math.abs(last[1] - p[1]) > eps) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps) out.pop();
  }
  return out;
}

function segDist2(p: Pt, a: Pt, b: Pt): number {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas-Peucker on an open polyline. */
export function simplifyLine(line: Pt[], tolerance: number): Pt[] {
  if (line.length <= 2) return line.slice();
  const tol2 = tolerance * tolerance;
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segDist2(line[i]!, line[first]!, line[last]!);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/** Douglas-Peucker on a closed ring (no repeated closing vertex). Never returns fewer than 3 points. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring.slice();
  // Split at the vertex farthest from the first one so the closure is preserved.
  let far = 0;
  let best = -1;
  for (let i = 1; i < ring.length; i++) {
    const dx = ring[i]![0] - ring[0]![0];
    const dy = ring[i]![1] - ring[0]![1];
    const d = dx * dx + dy * dy;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tolerance);
  const b = simplifyLine([...ring.slice(far), ring[0]!], tolerance);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : ring.slice();
}

/**
 * A point guaranteed to be inside the ring, as central as a coarse grid search can make it.
 * Used for labels in L-shaped rooms where the centroid falls outside.
 */
export function interiorPoint(ring: Ring): Pt {
  const c = ringCentroid(ring);
  if (pointInRing(c, ring)) return c;
  const [x0, y0, x1, y1] = bbox(ring);
  let bestPt: Pt = ring[0]!;
  let bestD = -1;
  const n = 12;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const p: Pt = [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n];
      if (!pointInRing(p, ring)) continue;
      let d = Infinity;
      for (let k = 0; k < ring.length; k++) {
        d = Math.min(d, segDist2(p, ring[k]!, ring[(k + 1) % ring.length]!));
      }
      if (d > bestD) {
        bestD = d;
        bestPt = p;
      }
    }
  }
  return bestPt;
}

/** Flat integer decimetre encoding used in the published JSON: [x0, y0, x1, y1, ...]. */
export function encodeRing(ring: Pt[]): number[] {
  const out: number[] = [];
  for (const [x, y] of ring) out.push(Math.round(x * 10), Math.round(y * 10));
  return out;
}

export function decodeRing(flat: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]! / 10, flat[i + 1]! / 10]);
  return out;
}
