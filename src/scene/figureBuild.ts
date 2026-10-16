// Builds the walker's figure. It is loaded with the body when the first walk starts, so that none of
// it weighs on a visit that takes no walk; src/scene/figure.ts poses what is built here. The body is
// Quaternius's "Animated Human" (CC0), made into public/models/walker.glb by
// scripts/walker/make-figure.ts. Once for every figure, its face is made less a man's, its bare feet
// become trainers and its faces are rounded; then each figure is painted, and given hair, a backpack
// and an umbrella fitted to it.
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Ray,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type AnimationClip,
  type InterleavedBufferAttribute,
  type Material,
  type Object3D,
  type SkinnedMesh,
  type TypedArray,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * How every walker looks. The body as modelled reads as a man: short side-parted hair, heavy
 * brows, a square jaw, broad shoulders and bare muscled arms. So the figure gets hair of middling
 * length over its ears with a fringe, lighter brows, a narrower jaw (`reshapeFace`), shoulders a
 * little narrower (figure.ts), and long sleeves. The colours are none of the University's.
 */
const LOOK = {
  skin: "#c98f5e",
  hair: "#33241a",
  brows: "#6e4e36",
  top: "#e2763c",
  bottom: "#2f3a4a",
  shoes: "#4a4f57",
  sole: "#e6e1d6",
  backpack: "#3f7f6f",
  backpackPocket: "#36705f",
  backpackStraps: "#2b4a43",
  umbrella: "#2c6aa8",
  umbrellaFrame: "#3a3d42",
  umbrellaHandle: "#5a4030",
};
/** The bands of the colour strip make-figure.ts pointed the body's faces at, in its order. */
const BANDS = ["skin", "eyes", "hair", "top", "bottom", "shoes", "upperArm", "forearm"] as const;
/** Those bands and two more: the brows, which `reshapeFace` takes from the eyes', and the soles of the shoes. */
const PALETTE = [...BANDS, "brows", "sole"] as const;
const band = (v: number) => Math.round((1 - v) * PALETTE.length - 0.5);
/**
 * The jaw narrows from JAW_FROM under the eyes to JAW_TO (the model's own units, about 0.22 m
 * each), until it is JAW_NARROW of its width narrower; the chin draws back by CHIN_BACK of its
 * reach.
 */
const JAW_FROM = 0.2;
const JAW_TO = 0.6;
const JAW_NARROW = 0.14;
const CHIN_BACK = 0.06;
/**
 * The shoes (`fitShoes`), in the model's units: how far they reach past the foot at the heel and
 * the toe; how thick the sole is and how much wider than the upper; how square the outline and the
 * upper are (2 is round); how many corners round, and rings up; and the half-width and the height
 * along the shoe from the heel (0) to the toe (1).
 */
const SHOE = {
  margin: 0.04,
  sole: 0.09,
  lip: 1.05,
  squareness: 4,
  dome: 4,
  round: 32,
  rings: 6,
  width: [[0, 0.22], [0.15, 0.27], [0.5, 0.285], [0.8, 0.27], [1, 0.26]] as [number, number][],
  height: [[0, 0.4], [0.22, 0.42], [0.42, 0.34], [0.62, 0.26], [0.82, 0.2], [1, 0.16]] as [number, number][],
};
/** Faces of the body that meet at less than this are drawn as one rounded surface. */
const CREASE = (75 * Math.PI) / 180;
/** How much more of the sky's light reaches the figure's edges than its middle. */
const RIM = 0.9;
/** How dark the ground shades the feet: the body's colour is this much of itself at the soles. */
const GROUND_SHADE = 0.78;
/** Metres the hair reaches below the brows, at the sides and the back: past the ears. */
const HAIR_BELOW_BROWS = 0.1;
/** Metres above the brows that the fringe ends, between its locks. */
const FRINGE_ABOVE_BROWS = 0.012;
/** Radians either side of straight ahead that the hair leaves open, for the face. */
const FACE_OPEN = 1.15;
/**
 * The backpack (`backpack`), in metres: how far below the neck its top is; its width, height and
 * depth, how round its edges, and how much narrower at the top; its pocket's depth; how far it and
 * its straps stand clear of the body; the straps' width, thickness and how far out from the middle
 * they cross the shoulders; and how far out from the middle the trunk they lie on reaches.
 */
const PACK = {
  belowNeck: 0.07,
  width: 0.3,
  height: 0.4,
  depth: 0.14,
  round: 0.045,
  taper: 0.1,
  pocket: 0.055,
  clear: 0.012,
  strapClear: 0.006,
  strapWidth: 0.045,
  strapThick: 0.012,
  strapX: 0.085,
  trunk: 0.15,
};
/**
 * The umbrella, in metres: the canopy's radius, how high it domes, its ribs and how much each panel
 * sags between them; and the shaft from the hand to the canopy's edge.
 */
const UMBRELLA = { radius: 0.62, rise: 0.22, ribs: 8, sag: 0.05, shaft: 0.8 };
/** Metres from the middle of the shade under the feet to its edge. */
const BLOT = 0.45;

let body: Promise<{ scene: Object3D; clips: AnimationClip[] }> | undefined;

/** Loads the body once for every figure, and makes it over: the face, the shoes, rounded faces. */
export function loadBody(): Promise<{ scene: Object3D; clips: AnimationClip[] }> {
  body ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/walker.glb`).then((gltf) => {
    gltf.scene.traverse((o) => {
      if (!(o as SkinnedMesh).isSkinnedMesh) return;
      const mesh = o as SkinnedMesh;
      reshapeFace(mesh.geometry);
      const geometry = fitShoes(mesh.geometry);
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      // The model is drawn faceted, every face flat. Rounded where the body turns gently (the
      // limbs, the head, the trunk); the sharp turns (a nose, a sole, a brow) stay edges.
      toCreasedNormals(geometry, CREASE);
      geometry.computeBoundingBox();
    });
    return { scene: gltf.scene, clips: gltf.animations };
  });
  return body;
}

/** What a figure wears: see `makeGear`. */
export interface Gear {
  /** The body's colours, for its own mesh. */
  skin: Material;
  /** To fix to the head. */
  hair: Mesh;
  /** To fix to the chest. */
  backpack: Mesh;
  /** Upright, its handle at its origin, to hold in the right hand. */
  umbrella: Mesh;
  /** A soft shade on the ground under the feet, at the figure's origin. */
  blot: Mesh;
}

/** The shapes and paint every figure's gear is made of, built for the first. */
let made: { skin: Material; parts: Record<"hair" | "backpack" | "umbrella" | "blot", [BufferGeometry, Material]> } | undefined;

/**
 * A figure's paint and gear, fitted to its body as it stands now. `frame` is the figure's own frame
 * (at the feet, x to its right, y up, z behind it); `at` gives where a bone is in it. Every walker
 * looks the same, so the shapes and paint are built once, for the first figure, and shared; they
 * last as long as the page, as the body does.
 */
export function makeGear(frame: Object3D, mesh: SkinnedMesh, at: (bone: string) => Vector3): Gear {
  made ??= (() => {
    const material = (colour: string, corners = false) => shade(new MeshLambertMaterial({ color: colour, vertexColors: corners, side: DoubleSide }));
    const body = surface(frame, mesh);
    const blot = new RingGeometry(0.001, BLOT, 24);
    blot.rotateX(-Math.PI / 2);
    return {
      skin: shade(new MeshLambertMaterial({ map: paint() }), mesh.geometry.boundingBox?.max.y ?? 8),
      parts: {
        hair: [hair(body), material(LOOK.hair)],
        backpack: [backpack(body, at("Spine2"), at("Neck")), material("#ffffff", true)],
        umbrella: [umbrella(), material("#ffffff", true)],
        blot: [blot, new MeshBasicMaterial({ color: 0x000000, map: blotTexture(), transparent: true, depthWrite: false })],
      },
    };
  })();
  const part = (name: keyof NonNullable<typeof made>["parts"]) => {
    const p = new Mesh(...made!.parts[name]);
    p.castShadow = name !== "blot";
    p.userData.noPick = true;
    return p;
  };
  const blot = part("blot");
  blot.position.y = 0.04;
  blot.renderOrder = 1;
  return { skin: made.skin, hair: part("hair"), backpack: part("backpack"), umbrella: part("umbrella"), blot };
}

/**
 * Shades a material of the figure: light from the sky wraps round its edges (`RIM`), so it stands
 * out from what is behind it by day and by night; and when `height` is given (the body's, in the
 * units of its bind pose) it darkens towards the ground, as the ground shades the feet.
 */
function shade(m: MeshLambertMaterial, height?: number): MeshLambertMaterial {
  m.onBeforeCompile = (s) => {
    s.uniforms.rimStrength = { value: RIM };
    s.fragmentShader = s.fragmentShader
      .replace("void main() {", "uniform float rimStrength;\nvoid main() {")
      .replace(
        "#include <lights_fragment_end>",
        "#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse *= 1.0 + rimStrength * pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 3.0);",
      );
    if (height === undefined) return;
    s.uniforms.riseHeight = { value: height };
    s.vertexShader = s.vertexShader
      .replace("void main() {", "uniform float riseHeight;\nvarying float vRise;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vRise = position.y / riseHeight;");
    s.fragmentShader = s.fragmentShader
      .replace("void main() {", "varying float vRise;\nvoid main() {")
      .replace("#include <color_fragment>", `#include <color_fragment>\n  diffuseColor.rgb *= mix(${GROUND_SHADE.toFixed(2)}, 1.0, smoothstep(0.0, 0.4, vRise));`);
  };
  m.customProgramCacheKey = () => (height === undefined ? "walker-gear" : "walker-body");
  return m;
}

/**
 * Makes the body's face less a man's, in the model's own space (y up, the face towards +x, the
 * middle of the face at z = 0).
 *
 * - The brows get a band of their own, so they can be drawn lighter than the eyes they share a
 *   band with. Each brow and each eye is a piece of its own; a brow is wider than it is tall, an
 *   eye is round.
 * - The jaw narrows towards the chin, and the chin draws back a little. Every face's corners are
 *   its own, as make-figure.ts wrote them, so each corner moves by where it is: corners that meet
 *   move together and no seam opens.
 */
function reshapeFace(geometry: BufferGeometry): void {
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const was = (v: number) => BANDS[Math.round((1 - v) * BANDS.length - 0.5)];
  // Faces of the eyes' band joined into pieces where their corners meet.
  const at = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const parent = new Map<string, string>();
  const root = (k: string): string => {
    while (parent.get(k) !== k) k = parent.get(k)!;
    return k;
  };
  const faces: number[] = [];
  for (let f = 0; f < pos.count / 3; f++) {
    if (was(uv.getY(f * 3)) !== "eyes") continue;
    faces.push(f);
    const corners = [at(f * 3), at(f * 3 + 1), at(f * 3 + 2)];
    for (const k of corners) if (!parent.has(k)) parent.set(k, k);
    for (const k of corners.slice(1)) parent.set(root(k), root(corners[0]!));
  }
  const pieces = new Map<string, Box3>();
  const v = new Vector3();
  for (const f of faces) {
    const box = pieces.get(root(at(f * 3))) ?? new Box3();
    for (let k = 0; k < 3; k++) box.expandByPoint(v.fromBufferAttribute(pos, f * 3 + k));
    pieces.set(root(at(f * 3)), box);
  }
  const brow = new Set<string>();
  const eyes = new Box3();
  for (const [k, box] of pieces) {
    const size = box.getSize(v);
    if (Math.max(size.x, size.z) > 2 * size.y) brow.add(k);
    else eyes.union(box);
  }
  const eyeY = eyes.getCenter(v).y;
  const smooth = (from: number, to: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - from) / (to - from)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < pos.count; i++) {
    const name = was(uv.getY(i))!;
    const b = name === "eyes" && brow.has(root(at(i))) ? "brows" : name;
    uv.setY(i, 1 - (PALETTE.indexOf(b) + 0.5) / PALETTE.length);
    // Below the cheekbones and in front of the ears: from nothing at JAW_FROM under the eyes to
    // all of it at JAW_TO.
    const x = pos.getX(i);
    const y = pos.getY(i);
    const w = smooth(eyeY - JAW_FROM, eyeY - JAW_TO, y) * smooth(-0.2, 0.2, x);
    if (w === 0) continue;
    pos.setZ(i, pos.getZ(i) * (1 - JAW_NARROW * w));
    pos.setX(i, x * (1 - CHIN_BACK * w));
  }
  uv.needsUpdate = true;
  pos.needsUpdate = true;
}

/**
 * Trainers in place of the body's feet, in the model's own space (y up, the toes towards +x). The
 * feet as modelled are bare, each toe a piece of its own, so dark paint left them bare feet in dark
 * socks. Each foot's faces give way to a shoe of the same reach: a sole of a colour of its own, and
 * an upper rounded over the foot from the heel, as high as the ankle, down to the toe. Every corner
 * of a shoe is skinned as the nearest corner of the foot was, so the shoe bends at the ball as the
 * foot did.
 */
function fitShoes(geometry: BufferGeometry): BufferGeometry {
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const joints = geometry.getAttribute("skinIndex");
  const weights = geometry.getAttribute("skinWeight");
  const shoes = PALETTE.indexOf("shoes");
  const kept: number[] = [];
  const feet: number[][] = [[], []];
  for (let f = 0; f < pos.count / 3; f++) {
    if (band(uv.getY(f * 3)) !== shoes) kept.push(f * 3, f * 3 + 1, f * 3 + 2);
    else for (let k = 0; k < 3; k++) feet[pos.getZ(f * 3 + k) > 0 ? 0 : 1]!.push(f * 3 + k);
  }
  // Corners of the shoes: where, which band, and which corner of the foot they are skinned as.
  const made: { p: Vector3; band: number; like: number }[] = [];
  const sole = PALETTE.indexOf("sole");
  for (const foot of feet) {
    const box = new Box3();
    for (const i of foot) box.expandByPoint(new Vector3().fromBufferAttribute(pos, i));
    const x0 = box.min.x - SHOE.margin;
    const x1 = box.max.x + SHOE.margin;
    const xc = (x0 + x1) / 2;
    const zc = (box.min.z + box.max.z) / 2;
    const yb = box.min.y - 0.01;
    const ys = yb + SHOE.sole;
    const along = (x: number) => (x - x0) / (x1 - x0);
    const width = (x: number) => profile(SHOE.width, along(x));
    const height = (x: number) => profile(SHOE.height, along(x));
    // The outline seen from above: rounded at the heel and the toe, as wide as the foot between.
    const outline: [number, number][] = [];
    for (let k = 0; k < SHOE.round; k++) {
      const a = (k / SHOE.round) * Math.PI * 2;
      const x = xc + ((x1 - x0) / 2) * Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** (2 / SHOE.squareness);
      outline.push([x, Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** (2 / SHOE.squareness)]);
    }
    const corners = foot.map((i) => new Vector3().fromBufferAttribute(pos, i));
    const nearest = (p: Vector3) => {
      let best = 0;
      corners.forEach((c, k) => {
        if (p.distanceToSquared(c) < p.distanceToSquared(corners[best]!)) best = k;
      });
      return foot[best]!;
    };
    const centre = new Vector3(xc, ys, zc);
    const tri = (a: Vector3, b: Vector3, c: Vector3, which: number) => {
      // Outward, away from the middle of the shoe.
      const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      const out = new Vector3().add(a).add(b).add(c).divideScalar(3).sub(centre);
      for (const p of n.dot(out) < 0 ? [a, c, b] : [a, b, c]) made.push({ p, band: which, like: nearest(p) });
    };
    // The sole: the outline a little wider, stood up from the ground to the top of the sole.
    const ring = (y: number) => outline.map(([x, s]) => new Vector3(x, y, zc + s * width(x) * SHOE.lip));
    const bottom = ring(yb);
    const top = ring(ys);
    const under = new Vector3(xc, yb, zc);
    outline.forEach((_, k) => {
      const j = (k + 1) % outline.length;
      tri(bottom[k]!, bottom[j]!, top[j]!, sole);
      tri(bottom[k]!, top[j]!, top[k]!, sole);
      tri(under, bottom[j]!, bottom[k]!, sole);
    });
    // The upper: rings from the top of the sole drawn in towards the middle and up to the line of
    // the shoe's height, meeting along it; squarer than round, to cover the toes.
    const rings: Vector3[][] = [];
    for (let r = 0; r <= SHOE.rings; r++) {
      const s = (r / SHOE.rings) * (Math.PI / 2);
      const across = Math.cos(s) ** (2 / SHOE.dome);
      const up = Math.sin(s) ** (2 / SHOE.dome);
      rings.push(outline.map(([x, side]) => new Vector3(x, ys + (height(x) - ys) * up, zc + side * width(x) * across)));
    }
    for (let r = 0; r < SHOE.rings; r++) {
      outline.forEach((_, k) => {
        const j = (k + 1) % outline.length;
        tri(rings[r]![k]!, rings[r]![j]!, rings[r + 1]![j]!, shoes);
        tri(rings[r]![k]!, rings[r + 1]![j]!, rings[r + 1]![k]!, shoes);
      });
    }
  }
  // The body's own corners first, then the shoes'.
  const out = new BufferGeometry();
  const copy = (attr: BufferAttribute | InterleavedBufferAttribute, fill: (to: TypedArray, at: number, m: (typeof made)[number]) => void) => {
    const Type = attr.array.constructor as new (n: number) => TypedArray;
    const to = new Type((kept.length + made.length) * attr.itemSize);
    kept.forEach((i, n) => {
      for (let c = 0; c < attr.itemSize; c++) to[n * attr.itemSize + c] = attr.getComponent(i, c);
    });
    made.forEach((m, n) => fill(to, (kept.length + n) * attr.itemSize, m));
    return new BufferAttribute(to, attr.itemSize, attr.normalized);
  };
  out.setAttribute("position", copy(pos, (to, at, m) => to.set(m.p.toArray(), at)));
  out.setAttribute("uv", copy(uv, (to, at, m) => to.set([0.5, 1 - (m.band + 0.5) / PALETTE.length], at)));
  for (const [name, attr] of [["skinIndex", joints], ["skinWeight", weights]] as const) {
    out.setAttribute(name, copy(attr, (to, at, m) => {
      for (let c = 0; c < 4; c++) to[at + c] = attr.getComponent(m.like, c);
    }));
  }
  return out;
}

/** A value along a shoe, from the heel (0) to the toe (1), drawn straight between the points given. */
function profile(points: [number, number][], t: number): number {
  for (let k = 1; k < points.length; k++) {
    const [ta, a] = points[k - 1]!;
    const [tb, b] = points[k]!;
    if (t <= tb) return a + ((b - a) * Math.max(0, t - ta)) / (tb - ta);
  }
  return points[points.length - 1]![1];
}

/** The strip of colours that the body's faces are drawn from. */
function paint(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = PALETTE.length;
  const g = canvas.getContext("2d")!;
  const colours: Record<(typeof PALETTE)[number], string> = {
    skin: LOOK.skin,
    eyes: "#221c1a",
    hair: LOOK.hair,
    top: LOOK.top,
    bottom: LOOK.bottom,
    shoes: LOOK.shoes,
    // Long sleeves, to the wrists.
    upperArm: LOOK.top,
    forearm: LOOK.top,
    brows: LOOK.brows,
    sole: LOOK.sole,
  };
  PALETTE.forEach((band, i) => {
    g.fillStyle = colours[band];
    g.fillRect(0, i, 1, 1);
  });
  const t = new CanvasTexture(canvas);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A round shade, darkest in the middle, for the blot under the feet. */
function blotTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d")!;
  const shade = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  shade.addColorStop(0, "rgba(255,255,255,0.4)");
  shade.addColorStop(0.45, "rgba(255,255,255,0.26)");
  shade.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = shade;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** Corners of the body in the figure's frame, with the band each is coloured from. */
type Surface = { p: Vector3; band: (typeof PALETTE)[number] }[];

/** Every corner of the body where it is now, in `frame`. */
function surface(frame: Object3D, mesh: SkinnedMesh): Surface {
  const pos = mesh.geometry.getAttribute("position");
  const uv = mesh.geometry.getAttribute("uv");
  const into = frame.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const out: Surface = [];
  for (let i = 0; i < pos.count; i++) {
    const p = mesh.applyBoneTransform(i, new Vector3().fromBufferAttribute(pos, i)).applyMatrix4(into);
    out.push({ p, band: PALETTE[band(uv.getY(i))]! });
  }
  return out;
}

/**
 * Hair of middling length over the body's own short hair: a shell round the head from the crown
 * over the ears to the nape, with a fringe down to the brows, open over the face, its edges in
 * soft locks. It is fitted to where the body's hair and brows are.
 */
function hair(body: Surface): BufferGeometry {
  const hair = new Box3();
  const brows = new Box3();
  for (const c of body) {
    if (c.band === "hair") hair.expandByPoint(c.p);
    else if (c.band === "brows") brows.expandByPoint(c.p);
  }
  const pad = 0.015;
  const middle = hair.getCenter(new Vector3());
  const half = hair.getSize(new Vector3()).multiplyScalar(0.5);
  // An ellipsoid centred at the brows' height, its top on the crown.
  const cy = brows.getCenter(new Vector3()).y;
  const r = new Vector3(half.x + pad, hair.max.y + pad - cy, half.z + pad);
  const down = (y: number) => Math.acos(Math.max(-1, Math.min(1, (y - cy) / r.y)));
  const fringe = down(brows.max.y + FRINGE_ABOVE_BROWS);
  const nape = down(cy - HAIR_BELOW_BROWS);
  const parts: BufferGeometry[] = [];
  // A part of the shell whose lower edge hangs `uneven(phi)` metres lower, the row above it a
  // little with it.
  const shell = (phiStart: number, phiLength: number, thetaStart: number, thetaLength: number, across: number, rows: number, uneven: (phi: number) => number) => {
    const geometry = new SphereGeometry(1, across, rows, phiStart, phiLength, thetaStart, thetaLength);
    const p = geometry.getAttribute("position");
    for (let k = 0; k <= across; k++) {
      const drop = uneven(phiStart + (k / across) * phiLength) / r.y;
      p.setY(rows * (across + 1) + k, p.getY(rows * (across + 1) + k) - drop);
      p.setY((rows - 1) * (across + 1) + k, p.getY((rows - 1) * (across + 1) + k) - drop * 0.3);
    }
    geometry.scale(r.x, r.y, r.z);
    geometry.translate(middle.x, cy, middle.z);
    geometry.computeVertexNormals();
    parts.push(geometry);
  };
  // Locks: `count` of them along a part, each hanging `deep` metres at its tip.
  const locks = (from: number, length: number, count: number, deep: number) => (phi: number) => deep * (0.5 - 0.5 * Math.cos(((phi - from) / length) * count * Math.PI * 2));
  // A three.js sphere's front (-z, where the figure faces) is at phi 3π/2. The fringe hangs over
  // the face only, clear of where the sides begin, so no gap opens between them.
  const open = FACE_OPEN - 0.1;
  const fringeLocks = locks(1.5 * Math.PI - open, 2 * open, 4, 0.022);
  shell(0, Math.PI * 2, 0, fringe, 48, 6, (phi) => (Math.abs(phi - 1.5 * Math.PI) < open ? fringeLocks(phi) : 0));
  // The sides and back.
  const from = 1.5 * Math.PI + FACE_OPEN;
  const length = 2 * Math.PI - 2 * FACE_OPEN;
  const sideLocks = locks(from, length, 9, 0.035);
  shell(from, length, fringe, nape - fringe, 54, 4, (phi) => 0.012 + sideLocks(phi));
  return merged(parts);
}

/**
 * A backpack fitted to the back: a rounded pack from below the neck, a pocket on it, a loop to lift
 * it by, and two straps over the shoulders and down the chest to under the arms; coloured by its
 * corners. `spine` is a point inside the chest, `neck` where the neck begins.
 */
function backpack(body: Surface, spine: Vector3, neck: Vector3): BufferGeometry {
  const P = PACK;
  // The faces of the shirt on the trunk, without the arms hanging by it.
  const trunk: Vector3[][] = [];
  for (let i = 0; i + 2 < body.length; i += 3) {
    const face = [body[i]!, body[i + 1]!, body[i + 2]!];
    if (face.every((c) => c.band === "top") && Math.abs((face[0]!.p.x + face[1]!.p.x + face[2]!.p.x) / 3) < P.trunk) trunk.push(face.map((c) => c.p));
  }
  const ray = new Ray();
  const hit = new Vector3();
  /** Where the outside of the trunk is, from `from` inside it going towards `to`; or nothing. */
  const outside = (from: Vector3, to: Vector3) => {
    const dir = to.clone().sub(from).normalize();
    ray.set(from.clone().addScaledVector(dir, 1), dir.clone().negate());
    let met = Infinity;
    for (const [a, b, c] of trunk) {
      if (ray.intersectTriangle(a!, b!, c!, false, hit)) {
        const d = hit.distanceTo(ray.origin);
        if (d < 1 && d < met) met = d;
      }
    }
    return met === Infinity ? undefined : from.clone().addScaledVector(dir, 1 - met);
  };
  const top = neck.y - P.belowNeck;
  const bottom = top - P.height;
  // The pack leans on the back. Where the back is, down the pack: the furthest of its middle and
  // either side, at each height.
  const heights = Array.from({ length: 11 }, (_, i) => bottom + (i / 10) * P.height);
  const backs = heights.map((y) => Math.max(...[-P.width / 2.5, 0, P.width / 2.5].map((x) => outside(new Vector3(x, y, spine.z), new Vector3(x, y, spine.z + 1))?.z ?? spine.z)));
  // The lean that leaves the least room between the back and the pack's panel, which touches the
  // back where it stands out most: the panel is `lean.at` behind the back's top, and leans `lean.by`.
  let lean = { by: 0, at: 0, room: Infinity };
  for (let by = -0.4; by <= 0.4; by += 0.02) {
    const at = Math.max(...heights.map((y, i) => backs[i]! - by * (y - top)));
    const room = heights.reduce((sum, y, i) => sum + at + by * (y - top) - backs[i]!, 0);
    if (room < lean.room) lean = { by, at, room };
  }
  const panel = (y: number) => lean.at + lean.by * (y - top) + P.clear;
  // The pack, its pocket and its loop are made with the panel at z = 0, upright, and then leant.
  const place = new Matrix4().makeTranslation(0, (top + bottom) / 2, panel((top + bottom) / 2)).multiply(new Matrix4().makeRotationX(Math.atan(lean.by)));
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, colour: string, x = 0, y = 0, z = 0) => parts.push(paintCorners(g.translate(x, y, z), colour));
  const onPack = (g: BufferGeometry, colour: string, x: number, y: number, z: number) => add(g.translate(x, y, z).applyMatrix4(place), colour);
  const pack = new RoundedBoxGeometry(P.width, P.height, P.depth, 3, P.round);
  // A little narrower at the top than at the bottom.
  const pp = pack.getAttribute("position");
  for (let i = 0; i < pp.count; i++) pp.setX(i, pp.getX(i) * (1 - P.taper * (pp.getY(i) / P.height + 0.5)));
  pack.computeVertexNormals();
  onPack(pack, LOOK.backpack, 0, 0, P.depth / 2);
  onPack(new RoundedBoxGeometry(P.width * 0.72, P.height * 0.36, P.pocket, 2, P.pocket / 2.5), LOOK.backpackPocket, 0, P.height * (0.27 - 0.5), P.depth + P.pocket / 2 - 0.012);
  const loop = new Vector3(0, P.height / 2 - 0.01, P.depth * 0.3);
  onPack(sweep(arc(loop, 0.035, 0, Math.PI), loop, 0.014, 0.012), LOOK.backpackStraps, 0, 0, 0);
  // The straps: from the top of the pack over each shoulder, down the chest and in under the arm,
  // lying on the body. A line through a few points says which way each runs from inside the chest;
  // every point of it is then moved to just outside the shirt that way. Its ends are in the pack and
  // in the body.
  for (const s of [-1, 1]) {
    const centre = new Vector3(s * P.strapX, top - 0.1, spine.z);
    const guide = through([
      new Vector3(s * 0.08, top - 0.04, panel(top - 0.04) + 0.01),
      new Vector3(s * P.strapX, top + 0.02, spine.z + 0.3),
      new Vector3(s * P.strapX, top + 0.3, spine.z),
      new Vector3(s * 0.1, top - 0.08, spine.z - 0.3),
      new Vector3(s * 0.12, top - 0.22, spine.z - 0.3),
      new Vector3(s * 0.13, top - 0.28, spine.z - 0.06),
    ], 0.04);
    const points = guide.flatMap((p, i) => {
      if (i === 0 || i === guide.length - 1) return [p];
      const on = outside(centre, p);
      return on ? [on.addScaledVector(on.clone().sub(centre).normalize(), P.strapClear + P.strapThick / 2)] : [];
    });
    add(sweep(points, centre, P.strapWidth, P.strapThick), LOOK.backpackStraps);
  }
  return merged(parts);
}

/**
 * An umbrella open over the hand: a canopy of eight panels, each sagging between its ribs, with a
 * tip on top and the ribs' ends round its edge, on a shaft with a crook to hold; upright, the hand at
 * the origin, coloured by its corners.
 */
function umbrella(): BufferGeometry {
  const U = UMBRELLA;
  const length = U.shaft + U.rise + 0.02;
  const crook = new Vector3(0.035, -0.05, 0);
  const parts = [
    paintCorners(canopy(U.radius, U.rise, U.ribs, U.sag).translate(0, U.shaft, 0), LOOK.umbrella),
    paintCorners(new CylinderGeometry(0.008, 0.008, length, 6).translate(0, length / 2 - 0.05, 0), LOOK.umbrellaFrame),
    paintCorners(new ConeGeometry(0.012, 0.07, 6).translate(0, U.shaft + U.rise + 0.05, 0), LOOK.umbrellaFrame),
    paintCorners(sweep(arc(crook, 0.035, Math.PI, 2 * Math.PI), crook, 0.02, 0.02), LOOK.umbrellaHandle),
  ];
  for (let k = 0; k < U.ribs; k++) {
    const a = (k / U.ribs) * Math.PI * 2;
    parts.push(paintCorners(new SphereGeometry(0.013, 6, 4).translate(Math.cos(a) * U.radius, U.shaft, Math.sin(a) * U.radius), LOOK.umbrellaFrame));
  }
  return merged(parts);
}

/** One geometry of `parts`, which are then disposed of. */
function merged(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!g) throw new Error("the walker's gear did not merge");
  return g;
}

/**
 * `shape` with every corner coloured alike, for a mesh coloured by its corners: without its UVs and
 * unindexed, so that any of them merge.
 */
function paintCorners(shape: BufferGeometry, colour: string): BufferGeometry {
  const g = shape.index ? shape.toNonIndexed() : shape;
  if (g !== shape) shape.dispose();
  const c = new Color(colour);
  const n = g.getAttribute("position").count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(rgb, i * 3);
  g.setAttribute("color", new BufferAttribute(rgb, 3));
  g.deleteAttribute("uv");
  return g;
}

/** Points on a circle round `centre` in its x-y plane, from angle `from` to `to`. */
function arc(centre: Vector3, radius: number, from: number, to: number, steps = 12): Vector3[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return centre.clone().add(new Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
  });
}

/** Points along a smooth line through `points` (a Catmull-Rom spline), about `step` metres apart. */
function through(points: Vector3[], step: number): Vector3[] {
  const out = [points[0]!.clone()];
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const n = Math.max(1, Math.ceil(p1.distanceTo(p2) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const a = 2 * t ** 3 - 3 * t ** 2 + 1;
      const b = t ** 3 - 2 * t ** 2 + t;
      const c = -2 * t ** 3 + 3 * t ** 2;
      const d = t ** 3 - t ** 2;
      // The tangent at each point is half the way from the point before it to the one after.
      const m1 = p2.clone().sub(p0).multiplyScalar(0.5);
      const m2 = p3.clone().sub(p1).multiplyScalar(0.5);
      out.push(p1.clone().multiplyScalar(a).addScaledVector(m1, b).addScaledVector(p2, c).addScaledVector(m2, d));
    }
  }
  return out;
}

/**
 * A flat band through `points`: `width` across, `thick` through, its flat side facing away from
 * `centre`. Open at both ends.
 */
function sweep(points: Vector3[], centre: Vector3, width: number, thick: number): BufferGeometry {
  const position: number[] = [];
  const index: number[] = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  points.forEach((p, i) => {
    const along = points[Math.min(points.length - 1, i + 1)]!.clone().sub(points[Math.max(0, i - 1)]!).normalize();
    const out = p.clone().sub(centre);
    out.addScaledVector(along, -out.dot(along)).normalize();
    const across = new Vector3().crossVectors(along, out).normalize();
    for (const [a, b] of corners) {
      const c = p.clone().addScaledVector(across, (a * width) / 2).addScaledVector(out, (b * thick) / 2);
      position.push(c.x, c.y, c.z);
    }
  });
  for (let i = 0; i + 1 < points.length; i++) {
    for (let k = 0; k < 4; k++) {
      const a = i * 4 + k;
      const b = i * 4 + ((k + 1) % 4);
      index.push(a, b, b + 4, a, b + 4, a + 4);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * An umbrella's canopy, its tip at (0, rise, 0) and its edge round the origin: domed, each of its
 * `ribs` panels sagging `sag` metres between ribs, most at the edge.
 */
function canopy(radius: number, rise: number, ribs: number, sag: number): BufferGeometry {
  const around = ribs * 6;
  const rings = 6;
  const position: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      const between = (1 - Math.cos(ribs * a)) / 2;
      const r = radius * u * (1 - 0.05 * between * u);
      position.push(r * Math.cos(a), rise * (1 - u * u) - sag * between * u * u, r * Math.sin(a));
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j;
      const b = a + around + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
