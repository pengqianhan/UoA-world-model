// An illustrative interior for the selected room: low walls on the real outline, and furniture
// laid out by rule. The outline is real; the furniture is decoration (no seating plans or seat
// counts are available), and the interface says so next to the room details.
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, Quaternion, Vector3 } from "three";
import { bbox, decodeRing, pointInRing, signedArea, type Pt, type Ring } from "../shared/geo.ts";
import type { Room, RoomKind } from "../shared/types.ts";
import { MeshBuilder } from "./geometry.ts";
import { lerpColour } from "./palette.ts";

export const WALL_HEIGHT = 1.25;
const WALL_THICKNESS = 0.22;
const MAX_ITEMS = 520;

/** Moves every vertex inwards by `d` along the bisector of its two edges (mitre offset). */
function inset(ring: Ring, d: number): Ring | undefined {
  const ccw = signedArea(ring) > 0;
  const n = ring.length;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n]!;
    const c = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const a = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1;
    const b = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
    // Inward normals of the two edges meeting at c.
    const s = ccw ? 1 : -1;
    const n1: Pt = [(-(c[1] - p[1]) / a) * s, ((c[0] - p[0]) / a) * s];
    const n2: Pt = [(-(q[1] - c[1]) / b) * s, ((q[0] - c[0]) / b) * s];
    let bx = n1[0] + n2[0];
    let by = n1[1] + n2[1];
    const len = Math.hypot(bx, by);
    if (len < 1e-6) {
      bx = n1[0];
      by = n1[1];
    } else {
      bx /= len;
      by /= len;
    }
    // Mitre length, limited so sharp corners do not shoot across the room.
    const cos = Math.max(0.35, bx * n1[0] + by * n1[1]);
    const m = Math.min(d / cos, d * 2.5);
    out.push([c[0] + bx * m, c[1] + by * m]);
  }
  // Reject offsets that collapsed or flipped the polygon.
  const before = Math.abs(signedArea(ring));
  const after = signedArea(out) * (ccw ? 1 : -1);
  if (after < before * 0.3 || out.some((p) => !pointInRing(p, ring))) return undefined;
  return out;
}

function distanceToRing(p: Pt, ring: Ring): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return best;
}

/** The direction of the room's long axis: the edge direction giving the smallest bounding rectangle. */
function longAxis(ring: Ring): { angle: number; length: number; width: number; origin: Pt } {
  let best = { angle: 0, length: 0, width: 0, origin: [0, 0] as Pt, area: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) continue;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const rotated = ring.map(([x, y]): Pt => [x * cos - y * sin, x * sin + y * cos]);
    const [x0, y0, x1, y1] = bbox(rotated);
    const area = (x1 - x0) * (y1 - y0);
    if (area < best.area) {
      // Express the rectangle with u along its longer side.
      const alongX = x1 - x0 >= y1 - y0;
      best = {
        angle: alongX ? angle : angle + Math.PI / 2,
        length: alongX ? x1 - x0 : y1 - y0,
        width: alongX ? y1 - y0 : x1 - x0,
        origin: [0, 0],
        area,
      };
    }
  }
  // Origin: the rectangle corner with the smallest (u, v) in the chosen frame.
  const cu: Pt = [Math.cos(best.angle), Math.sin(best.angle)];
  const cv: Pt = [-cu[1], cu[0]];
  let u0 = Infinity;
  let v0 = Infinity;
  for (const [x, y] of ring) {
    u0 = Math.min(u0, x * cu[0] + y * cu[1]);
    v0 = Math.min(v0, x * cv[0] + y * cv[1]);
  }
  best.origin = [cu[0] * u0 + cv[0] * v0, cu[1] * u0 + cv[1] * v0];
  return best;
}

interface Layout {
  /** Item footprint and height in metres: across the row, along the room, up. */
  size: [number, number, number];
  rowGap: number;
  seatGap: number;
  /** Clear space at the front of the room. */
  front: number;
  /** Rise per row, for raked lecture theatres. */
  rake: number;
  aisle: boolean;
}

const LAYOUTS: Record<RoomKind, Layout> = {
  lectureTheatre: { size: [0.5, 0.5, 0.5], rowGap: 0.95, seatGap: 0.62, front: 3.2, rake: 0.13, aisle: true },
  teaching: { size: [1.3, 0.6, 0.72], rowGap: 1.7, seatGap: 1.75, front: 2.2, rake: 0, aisle: false },
  computerLab: { size: [1.5, 0.7, 0.74], rowGap: 1.8, seatGap: 1.7, front: 1.6, rake: 0, aisle: false },
  lab: { size: [3.2, 1.0, 0.9], rowGap: 2.6, seatGap: 3.9, front: 1.4, rake: 0, aisle: false },
  studio: { size: [1.6, 1.0, 0.75], rowGap: 2.4, seatGap: 2.4, front: 1.2, rake: 0, aisle: false },
  study: { size: [1.2, 0.8, 0.72], rowGap: 2.2, seatGap: 2.0, front: 1.0, rake: 0, aisle: false },
  library: { size: [1.8, 0.5, 1.8], rowGap: 2.0, seatGap: 2.4, front: 1.2, rake: 0, aisle: false },
  studentHub: { size: [1.2, 1.2, 0.72], rowGap: 2.6, seatGap: 2.6, front: 1.2, rake: 0, aisle: false },
  other: { size: [1.3, 0.6, 0.72], rowGap: 1.8, seatGap: 1.8, front: 1.5, rake: 0, aisle: false },
};

/**
 * Builds the interior at scene height `baseY`. `colour` is the room's kind colour and `floorTone`
 * the colour of the slab it stands on.
 */
export function buildInterior(room: Room, baseY: number, colour: number, floorTone: number): Group {
  const group = new Group();
  const ring = decodeRing(room.poly);
  const flat = room.poly;

  // Floor.
  const floor = new MeshBuilder();
  floor.flat(flat, baseY + 0.03);
  const floorMesh = new Mesh(floor.build(), new MeshLambertMaterial({ color: lerpColour(colour, 0xffffff, 0.62) }));
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // Low walls with real thickness where the outline can be offset inwards cleanly.
  const inner = inset(ring, WALL_THICKNESS);
  const walls = new MeshBuilder();
  if (inner) {
    const hole: number[] = [];
    for (const [x, y] of inner) hole.push(Math.round(x * 10), Math.round(y * 10));
    walls.extrude([flat, hole], baseY, baseY + WALL_HEIGHT);
  } else {
    walls.extrude([flat], baseY, baseY + 0.12);
  }
  const wallMesh = new Mesh(walls.build(), new MeshLambertMaterial({ color: lerpColour(colour, floorTone, 0.25) }));
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  group.add(wallMesh);

  // Furniture, on a grid aligned with the room's long axis.
  const layout = LAYOUTS[room.kind];
  const axis = longAxis(ring);
  const u: Pt = [Math.cos(axis.angle), Math.sin(axis.angle)];
  const v: Pt = [-u[1], u[0]];
  const clearance = Math.max(layout.size[0], layout.size[1]) / 2 + 0.35;
  const spots: { p: Pt; row: number }[] = [];
  let row = 0;
  for (let du = layout.front; du < axis.length - 0.6 && spots.length < MAX_ITEMS; du += layout.rowGap, row++) {
    const count = Math.max(1, Math.floor((axis.width - 1.2) / layout.seatGap));
    const start = (axis.width - (count - 1) * layout.seatGap) / 2;
    for (let k = 0; k < count && spots.length < MAX_ITEMS; k++) {
      const dv = start + k * layout.seatGap;
      if (layout.aisle && axis.width > 9 && Math.abs(dv - axis.width / 2) < 0.65) continue;
      const p: Pt = [axis.origin[0] + u[0] * du + v[0] * dv, axis.origin[1] + u[1] * du + v[1] * dv];
      if (pointInRing(p, ring) && distanceToRing(p, ring) > clearance) spots.push({ p, row });
    }
  }
  if (spots.length) {
    const [w, d, h] = layout.size;
    const geom = new BoxGeometry(w, h, d);
    geom.translate(0, h / 2, 0);
    const items = new InstancedMesh(geom, new MeshLambertMaterial({ color: lerpColour(colour, 0x2a2118, 0.42) }), spots.length);
    const m = new Matrix4();
    // Item width runs across the room (v); in scene axes north is -z.
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), axis.angle + Math.PI / 2);
    const one = new Vector3(1, 1, 1);
    spots.forEach((s, i) => {
      const rise = Math.min(s.row * layout.rake, 2.2);
      m.compose(new Vector3(s.p[0], baseY + 0.03 + rise, -s.p[1]), q, one);
      items.setMatrixAt(i, m);
    });
    items.castShadow = true;
    items.receiveShadow = true;
    group.add(items);

    // Raked theatres get steps under the seats so they do not float.
    if (layout.rake > 0) {
      const rows = new Map<number, Pt[]>();
      for (const s of spots) rows.set(s.row, [...(rows.get(s.row) ?? []), s.p]);
      const stepGeom = new BoxGeometry(1, 1, 1);
      stepGeom.translate(0, 0.5, 0);
      const steps = new InstancedMesh(stepGeom, new MeshLambertMaterial({ color: lerpColour(colour, 0xffffff, 0.45) }), rows.size);
      let i = 0;
      for (const [r, pts] of rows) {
        const rise = Math.min(r * layout.rake, 2.2);
        const a = pts[0]!;
        const z = pts[pts.length - 1]!;
        const len = Math.hypot(z[0] - a[0], z[1] - a[1]) + layout.seatGap;
        m.compose(new Vector3((a[0] + z[0]) / 2, baseY + 0.03, -(a[1] + z[1]) / 2), q, new Vector3(len, Math.max(rise, 0.02), layout.rowGap));
        steps.setMatrixAt(i++, m);
      }
      steps.receiveShadow = true;
      group.add(steps);
    }
  }

  // A lectern at the front of lecture theatres and teaching rooms.
  if (room.kind === "lectureTheatre" || room.kind === "teaching") {
    const p: Pt = [axis.origin[0] + u[0] * 1.3 + v[0] * (axis.width / 2), axis.origin[1] + u[1] * 1.3 + v[1] * (axis.width / 2)];
    if (pointInRing(p, ring) && distanceToRing(p, ring) > 0.6) {
      const lectern = new Mesh(new BoxGeometry(1.4, 1.05, 0.6), new MeshLambertMaterial({ color: lerpColour(colour, 0x2a2118, 0.6) }));
      lectern.position.set(p[0], baseY + 0.55, -p[1]);
      lectern.rotation.y = axis.angle + Math.PI / 2;
      lectern.castShadow = true;
      group.add(lectern);
    }
  }

  group.traverse((o) => (o.userData.noPick = true));
  return group;
}

export function disposeGroup(group: Group): void {
  group.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  group.clear();
}
