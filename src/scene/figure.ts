// A walker's figure: a small made-up person, 1.75 m tall. No real person is drawn. Every walker
// looks the same: a student in a long-sleeved top, trousers and a backpack, with nothing meant to
// mark a sex or a gender (see LOOK). The body is Quaternius's "Animated Human" (CC0), made into
// public/models/walker.glb by scripts/walker/make-figure.ts, with its idle, walk and run; the hair,
// the backpack and the umbrella are built here and ride on its bones. It faces north with no turn
// and stands with its feet at its origin.
import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  GreaterDepth,
  KeepStencilOp,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  NotEqualStencilFunc,
  Quaternion,
  ReplaceStencilOp,
  RingGeometry,
  SkinnedMesh,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Bone,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";

/** Where the eyes are, for the view from the walker. */
export const EYE_HEIGHT = 1.6;
/**
 * How every walker looks. The body as modelled reads as a man: short side-parted hair, heavy
 * brows, a square jaw, broad shoulders and bare muscled arms. So the figure gets hair of middling
 * length over its ears with a fringe, lighter brows, a narrower jaw (`reshapeFace`), shoulders a
 * little narrower, and long sleeves. The colours are none of the University's.
 */
const LOOK = {
  skin: "#c98f5e",
  hair: "#33241a",
  brows: "#6e4e36",
  top: "#e2763c",
  bottom: "#2f3a4a",
  shoes: "#4a4f57",
  backpack: "#3f7f6f",
  umbrella: "#2c6aa8",
};
/** The arms' joints are drawn this much nearer the spine than the body has them. */
const SHOULDERS = 0.88;
/** Metres the hair reaches below the brows, at the sides and the back: past the ears. */
const HAIR_BELOW_BROWS = 0.1;
/** Radians either side of straight ahead that the hair leaves open, for the face. */
const FACE_OPEN = 1.15;
/**
 * The jaw narrows from JAW_FROM under the eyes to JAW_TO (the model's own units, about 0.23 m
 * each), until it is JAW_NARROW of its width narrower; the chin draws back by CHIN_BACK of its
 * reach.
 */
const JAW_FROM = 0.2;
const JAW_TO = 0.6;
const JAW_NARROW = 0.14;
const CHIN_BACK = 0.06;
/** The bands of the colour strip make-figure.ts pointed the body's faces at, in its order. */
const BANDS = ["skin", "eyes", "hair", "top", "bottom", "shoes", "upperArm", "forearm"] as const;
/** Those bands and one more for the brows, which `reshapeFace` takes from the eyes'. */
const PALETTE = [...BANDS, "brows"] as const;
const band = (v: number) => Math.round((1 - v) * PALETTE.length - 0.5);
/** Metres a walk cycle (two steps) covers at the animation's own pace, and a run cycle. */
const WALK_CYCLE = 1.4;
const RUN_CYCLE = 2.4;
/** Metres a second over which the walk turns into a run. */
const RUN_FROM = 3.0;
const RUN_AT = 3.5;
/** The fastest the legs go, metres a second of stride: a walker sped up past it glides a little. */
const WALK_CADENCE_MAX = 3.2;
const RUN_CADENCE_MAX = 7;

interface Model {
  scene: Object3D;
  clips: AnimationClip[];
}

let model: Promise<Model> | undefined;

/** Loads the body once for every figure. */
function loadModel(): Promise<Model> {
  model ??= import("three/examples/jsm/loaders/GLTFLoader.js")
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/walker.glb`))
    .then((gltf) => {
      gltf.scene.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) reshapeFace((o as SkinnedMesh).geometry);
      });
      return { scene: gltf.scene, clips: gltf.animations };
    });
  return model;
}

/**
 * Makes the body's face less a man's, once for every figure, in the model's own space (y up, the
 * face towards +x, the middle of the face at z = 0, a unit about 0.23 m).
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

/** A copy of the body with its own skeleton, sharing the geometry. */
async function cloneBody(source: Object3D): Promise<Object3D> {
  const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
  return clone(source);
}

interface Body {
  root: Object3D;
  mesh: SkinnedMesh;
  mixer: AnimationMixer;
  idle: AnimationAction;
  walk: AnimationAction;
  run: AnimationAction;
  bone: (name: string) => Bone;
}

export class Figure {
  /** At the feet; turn with `setHeading`. */
  readonly root = new Group();
  private body?: Body;
  /** The hair and the backpack, fixed to bones. */
  private gear: Object3D[] = [];
  private umbrella = new Group();
  private ring: Mesh;
  /** The body again, drawn flat only where something stands in front of it: see `xrayMaterial`. */
  private xray?: SkinnedMesh;
  private xrayMaterial: MeshBasicMaterial;
  private owned: (BufferGeometry | Material | CanvasTexture)[] = [];
  private skinMaterial?: MeshLambertMaterial;
  private umbrellaOpen = false;
  private headVisible = true;
  private disposed = false;
  /**
   * Set when the figure changed without moving (its body arrived, the umbrella opened), so the
   * scene draws a frame; read with `takeChanged`.
   */
  private changed = false;
  private last?: number;
  private walkCycles = 0;
  private runCycles = 0;
  private runBlend = 0;
  private stance = { moving: 0, speed: 0, t: 0 };

  constructor(ringColour: number) {
    // A ring on the ground round the feet, so the walker can be found from above.
    const ringGeometry = new RingGeometry(0.75, 1.05, 32);
    ringGeometry.rotateX(-Math.PI / 2);
    this.ring = new Mesh(ringGeometry, new MeshBasicMaterial({ color: ringColour, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.position.y = 0.1;
    this.ring.renderOrder = 2;
    this.root.add(this.ring, this.umbrella);
    // Where a building or a tree hides the walker, its shape shows through in the ring's colour.
    // The figure marks the pixels it is seen at in the stencil; the shape is drawn behind other
    // things (GreaterDepth) and only off those pixels, so it never covers the figure itself.
    this.xrayMaterial = new MeshBasicMaterial({ color: ringColour, transparent: true, opacity: 0.55, depthWrite: false, depthFunc: GreaterDepth });
    this.xrayMaterial.stencilWrite = true;
    this.xrayMaterial.stencilRef = 1;
    this.xrayMaterial.stencilFunc = NotEqualStencilFunc;
    this.xrayMaterial.stencilZPass = KeepStencilOp;
    this.root.userData.noPick = true;
    this.ring.userData.noPick = true;
    void this.load();
  }

  /** Whether the body has arrived and is drawn. */
  get ready(): boolean {
    return !!this.body;
  }

  /** True once after the figure changed without moving: draw a frame. */
  takeChanged(): boolean {
    const c = this.changed;
    this.changed = false;
    return c;
  }

  /** Turns the figure to face a compass bearing, degrees clockwise from north. */
  setHeading(deg: number): void {
    this.root.rotation.y = (-deg * Math.PI) / 180;
  }

  /** Opens or closes the umbrella. */
  setUmbrella(open: boolean): void {
    if (open === this.umbrellaOpen) return;
    this.umbrellaOpen = open;
    this.umbrella.visible = open && this.headVisible;
    this.changed = true;
  }

  /** Hides the head and hat, for the view through the walker's own eyes. */
  setHeadVisible(visible: boolean): void {
    this.headVisible = visible;
    this.umbrella.visible = this.umbrellaOpen && visible;
    this.showHead();
  }

  setRingVisible(visible: boolean): void {
    this.ring.visible = visible;
  }

  /**
   * Poses the figure: `moving` is 0 standing to 1 on the move, `speed` metres a second, `t`
   * seconds, the clock the walk and the breathing of a figure standing still keep to.
   */
  pose(moving: number, speed: number, t: number): void {
    this.stance = { moving, speed, t };
    const b = this.body;
    if (!b) return;
    const dt = this.last === undefined ? 0 : Math.max(0, Math.min(1, t - this.last));
    this.last = t;
    const run = Math.max(0, Math.min(1, (speed - RUN_FROM) / (RUN_AT - RUN_FROM)));
    this.runBlend += (run - this.runBlend) * Math.min(1, dt * 5);
    this.walkCycles = (this.walkCycles + (dt * Math.min(speed, WALK_CADENCE_MAX)) / WALK_CYCLE) % 1;
    this.runCycles = (this.runCycles + (dt * Math.min(speed, RUN_CADENCE_MAX)) / RUN_CYCLE) % 1;
    b.idle.time = t % b.idle.getClip().duration;
    b.walk.time = this.walkCycles * b.walk.getClip().duration;
    b.run.time = this.runCycles * b.run.getClip().duration;
    b.idle.setEffectiveWeight(1 - moving);
    b.walk.setEffectiveWeight(moving * (1 - this.runBlend));
    b.run.setEffectiveWeight(moving * this.runBlend);
    b.mixer.update(0);
    if (this.umbrellaOpen && this.headVisible) this.holdUmbrella(b);
  }

  dispose(): void {
    this.disposed = true;
    this.undress();
    if (this.body) {
      this.body.mixer.stopAllAction();
      this.root.remove(this.body.root);
    }
    (this.ring.geometry as BufferGeometry).dispose();
    (this.ring.material as Material).dispose();
    this.xrayMaterial.dispose();
  }

  private async load(): Promise<void> {
    const m = await loadModel();
    const root = await cloneBody(m.scene);
    if (this.disposed) return;
    let mesh: SkinnedMesh | undefined;
    root.traverse((o) => {
      o.userData.noPick = true;
      if ((o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
    });
    if (!mesh) throw new Error("walker.glb has no skinned mesh");
    mesh.castShadow = true;
    // The bind pose's bounds are not the walk's; the figure is small, so it is never culled.
    mesh.frustumCulled = false;
    const mixer = new AnimationMixer(root);
    const action = (name: string) => {
      const clip = m.clips.find((c) => c.name === name);
      if (!clip) throw new Error(`walker.glb has no ${name} animation`);
      const a = mixer.clipAction(clip);
      a.play();
      return a;
    };
    const bones = new Map<string, Bone>();
    root.traverse((o) => {
      if ((o as Bone).isBone) bones.set(o.name, o as Bone);
    });
    const bone = (name: string) => {
      const b = bones.get(name);
      if (!b) throw new Error(`walker.glb has no bone ${name}`);
      return b;
    };
    // Narrower shoulders. The clips only turn bones, so where a joint sits stays as set here.
    for (const side of ["Left", "Right"]) bone(`${side}Arm`).position.multiplyScalar(SHOULDERS);
    this.body = { root, mesh, mixer, idle: action("idle"), walk: action("walk"), run: action("run"), bone };
    const xray = new SkinnedMesh(mesh.geometry, this.xrayMaterial);
    xray.position.copy(mesh.position);
    xray.quaternion.copy(mesh.quaternion);
    xray.scale.copy(mesh.scale);
    xray.bind(mesh.skeleton, mesh.bindMatrix);
    xray.frustumCulled = false;
    xray.renderOrder = 3;
    xray.userData.noPick = true;
    mesh.parent?.add(xray);
    this.xray = xray;
    this.root.add(root);
    this.dress();
    this.changed = true;
  }

  private material(colour: string, side = false): MeshLambertMaterial {
    const m = new MeshLambertMaterial({ color: colour });
    if (side) m.side = DoubleSide;
    this.owned.push(m);
    return m;
  }

  private mesh(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
    this.owned.push(geometry);
    const m = new Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.userData.noPick = true;
    return m;
  }

  /** The strip of colours that the body's faces are drawn from. */
  private paint(): CanvasTexture {
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
    this.owned.push(t);
    return t;
  }

  private undress(): void {
    for (const g of this.gear) g.removeFromParent();
    this.gear = [];
    this.umbrella.clear();
    for (const x of this.owned) x.dispose();
    this.owned = [];
  }

  /** Paints the body and fixes the hair, the backpack and the umbrella to it. */
  private dress(): void {
    const b = this.body;
    if (!b) return;
    this.undress();
    this.skinMaterial = new MeshLambertMaterial({ map: this.paint() });
    this.owned.push(this.skinMaterial);
    b.mesh.material = this.skinMaterial;

    // Gear is placed on the figure standing at the start of its idle, then fixed to a bone.
    const head = b.bone("Head");
    head.scale.setScalar(1);
    b.idle.time = 0;
    b.idle.setEffectiveWeight(1);
    b.walk.setEffectiveWeight(0);
    b.run.setEffectiveWeight(0);
    b.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const chest = this.root.worldToLocal(b.bone("Spine2").getWorldPosition(new Vector3()));
    const fix = (part: Object3D, to: string) => {
      this.root.add(part);
      part.updateMatrixWorld(true);
      b.bone(to).attach(part);
      this.gear.push(part);
    };

    fix(this.hair(b), "Head");
    const back = new Group();
    back.position.set(chest.x, chest.y, chest.z);
    back.add(this.mesh(new BoxGeometry(0.3, 0.38, 0.15), this.material(LOOK.backpack), 0, -0.08, 0.2));
    fix(back, "Spine2");

    // The umbrella stays upright over the right hand; holdUmbrella moves it there.
    const canopy = this.material(LOOK.umbrella, true);
    this.umbrella.add(this.mesh(new CylinderGeometry(0.012, 0.012, 1.0, 6), this.material("#3a3a3a"), 0, 0.42, 0));
    this.umbrella.add(this.mesh(new ConeGeometry(0.62, 0.26, 10, 1, true), canopy, 0, 0.92, 0));
    this.umbrella.visible = this.umbrellaOpen && this.headVisible;
    this.showHead();
    // Every part of the figure marks where it is seen, so that its x-ray stays off it.
    this.root.traverse((part) => {
      if (!(part instanceof Mesh) || part === this.ring || part === this.xray) return;
      for (const m of [part.material].flat() as Material[]) {
        m.stencilWrite = true;
        m.stencilRef = 1;
        m.stencilZPass = ReplaceStencilOp;
      }
    });
    // Back to the pose it had.
    this.last = undefined;
    this.pose(this.stance.moving, this.stance.speed, this.stance.t);
  }

  /**
   * Hair of middling length over the body's own short hair: a shell round the head from the crown
   * over the ears to the nape, with a fringe down to the brows, open over the face. It is fitted to
   * where the body's hair and brows are, standing at the start of its idle.
   */
  private hair(b: Body): Group {
    const pos = b.mesh.geometry.getAttribute("position");
    const uv = b.mesh.geometry.getAttribute("uv");
    const hair = new Box3();
    const brows = new Box3();
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      const k = PALETTE[band(uv.getY(i))];
      if (k !== "hair" && k !== "brows") continue;
      v.fromBufferAttribute(pos, i);
      b.mesh.applyBoneTransform(i, v);
      (k === "hair" ? hair : brows).expandByPoint(this.root.worldToLocal(v.applyMatrix4(b.mesh.matrixWorld)));
    }
    const pad = 0.015;
    const middle = hair.getCenter(new Vector3());
    const half = hair.getSize(new Vector3()).multiplyScalar(0.5);
    // An ellipsoid centred at the brows' height, its top on the crown.
    const cy = brows.getCenter(v).y;
    const r = new Vector3(half.x + pad, hair.max.y + pad - cy, half.z + pad);
    const down = (y: number) => Math.acos(Math.max(-1, Math.min(1, (y - cy) / r.y)));
    const fringe = down(brows.max.y);
    const nape = down(cy - HAIR_BELOW_BROWS);
    const material = this.material(LOOK.hair, true);
    material.flatShading = true;
    const g = new Group();
    // A part of the shell, its lower edge `uneven`: metres every other point hangs lower.
    const shell = (phiStart: number, phiLength: number, thetaStart: number, thetaLength: number, across: number, rows: number, uneven: (phi: number) => number) => {
      const geometry = new SphereGeometry(1, across, rows, phiStart, phiLength, thetaStart, thetaLength);
      const p = geometry.getAttribute("position");
      for (let k = 1; k < across; k += 2) {
        const i = rows * (across + 1) + k;
        p.setY(i, p.getY(i) - uneven(phiStart + (k / across) * phiLength) / r.y);
      }
      geometry.scale(r.x, r.y, r.z);
      geometry.translate(middle.x, cy, middle.z);
      g.add(this.mesh(geometry, material));
    };
    // A three.js sphere's front (-z, where the figure faces) is at phi 3π/2. The fringe hangs over
    // the face only, clear of where the sides begin, so no gap opens between them.
    const face = (phi: number) => Math.abs(phi - 1.5 * Math.PI) < FACE_OPEN - 0.1;
    shell(0, Math.PI * 2, 0, fringe, 18, 4, (phi) => (face(phi) ? 0.018 : 0));
    // The sides and back.
    shell(1.5 * Math.PI + FACE_OPEN, 2 * Math.PI - 2 * FACE_OPEN, fringe, nape - fringe, 13, 3, () => 0.025);
    return g;
  }

  /** The head shows, or shrinks to nothing, for the view from the eyes. */
  private showHead(): void {
    const b = this.body;
    if (!b) return;
    b.bone("Head").scale.setScalar(this.headVisible ? 1 : 1e-3);
    // Seen through its own eyes, the walker has no shape to show through anything.
    if (this.xray) this.xray.visible = this.headVisible;
  }

  /** Raises the right forearm and puts the umbrella's handle in that hand. */
  private holdUmbrella(b: Body): void {
    this.root.updateMatrixWorld(true);
    aim(b.bone("RightArm"), b.bone("RightForeArm"), this.root, new Vector3(0.3, -0.85, -0.35));
    aim(b.bone("RightForeArm"), b.bone("RightHand"), this.root, new Vector3(0.05, 0.85, -0.45));
    const hand = this.root.worldToLocal(b.bone("RightHand").getWorldPosition(new Vector3()));
    this.umbrella.position.copy(hand);
  }
}

const tmp = { from: new Vector3(), to: new Vector3(), dir: new Vector3(), want: new Vector3(), q: new Quaternion(), world: new Quaternion(), parent: new Quaternion() };

/** Turns `bone` so that the way to `child` points along `dir`, given in `frame`'s axes. */
function aim(bone: Bone, child: Bone, frame: Object3D, dir: Vector3): void {
  const { from, to, want, q, world, parent } = tmp;
  bone.getWorldPosition(from);
  child.getWorldPosition(to);
  tmp.dir.subVectors(to, from).normalize();
  want.copy(dir).transformDirection(frame.matrixWorld);
  q.setFromUnitVectors(tmp.dir, want);
  bone.getWorldQuaternion(world);
  world.premultiply(q);
  if (bone.parent) bone.parent.getWorldQuaternion(parent);
  else parent.identity();
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateMatrixWorld(true);
}
