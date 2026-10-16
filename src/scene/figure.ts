// A walker's figure: a small made-up person, 1.75 m tall, dressed in an outfit
// (src/shared/outfit.ts). No real person is drawn. The body is Quaternius's "Animated Human" (CC0),
// made into public/models/walker.glb by scripts/walker/make-figure.ts, with its idle, walk and run;
// the hats, the pumpkin, the backpack, the cape and the umbrella are built here and ride on its
// bones. It faces north with no turn and stands with its feet at its origin.
import {
  AnimationMixer,
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
import type { Outfit } from "../shared/outfit.ts";

/** Where the eyes are, for the view from the walker. */
export const EYE_HEIGHT = 1.6;
/** The bands of the colour strip the body's faces point at; the order make-figure.ts wrote. */
const PALETTE = ["skin", "eyes", "hair", "top", "bottom", "shoes", "upperArm", "forearm"] as const;
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
    .then((gltf) => ({ scene: gltf.scene, clips: gltf.animations }));
  return model;
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
  /** Built for the outfit and fixed to bones; replaced when the outfit changes. */
  private gear: Object3D[] = [];
  private pumpkin?: Group;
  private umbrella = new Group();
  private ring: Mesh;
  /** The body again, drawn flat only where something stands in front of it: see `xrayMaterial`. */
  private xray?: SkinnedMesh;
  private xrayMaterial: MeshBasicMaterial;
  private owned: (BufferGeometry | Material | CanvasTexture)[] = [];
  private skinMaterial?: MeshLambertMaterial;
  private outfit: Outfit;
  private umbrellaOpen = false;
  private headVisible = true;
  private disposed = false;
  /**
   * Set when the figure changed without moving (its body arrived, a new outfit), so the scene
   * draws a frame; read with `takeChanged`.
   */
  private changed = false;
  private last?: number;
  private walkCycles = 0;
  private runCycles = 0;
  private runBlend = 0;
  private stance = { moving: 0, speed: 0, t: 0 };

  constructor(outfit: Outfit, ringColour: number) {
    this.outfit = outfit;
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

  setOutfit(outfit: Outfit): void {
    this.outfit = outfit;
    this.dress();
    this.changed = true;
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

  /** The strip of the outfit's colours that the body's faces are drawn from. */
  private paint(o: Outfit): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = PALETTE.length;
    const g = canvas.getContext("2d")!;
    const long = o.sleeves === "long";
    const colours: Record<(typeof PALETTE)[number], string> = {
      skin: o.skin,
      eyes: "#221c1a",
      hair: o.hairStyle === "none" ? o.skin : o.hair,
      top: o.top,
      bottom: o.bottom,
      shoes: o.shoes,
      upperArm: long ? o.top : o.skin,
      forearm: long ? o.top : o.skin,
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
    this.pumpkin = undefined;
    this.umbrella.clear();
    for (const x of this.owned) x.dispose();
    this.owned = [];
  }

  /** Paints the body and fixes the outfit's gear to its bones. */
  private dress(): void {
    const b = this.body;
    if (!b) return;
    this.undress();
    const o = this.outfit;
    this.skinMaterial = new MeshLambertMaterial({ map: this.paint(o) });
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
    const at = (name: string) => this.root.worldToLocal(b.bone(name).getWorldPosition(new Vector3()));
    const neck = at("Head");
    const top = at("HeadTop_End");
    const chest = at("Spine2");
    // The head: from the neck to the top of the hair, its middle a little in front of the spine.
    const crown = top.y + 0.07;
    const mid = new Vector3(neck.x, (neck.y + crown) / 2, (neck.z + top.z) / 2 - 0.01);
    const fix = (part: Object3D, to: string) => {
      this.root.add(part);
      part.updateMatrixWorld(true);
      b.bone(to).attach(part);
      this.gear.push(part);
    };

    if (o.hat === "pumpkin") {
      const p = new Group();
      p.position.copy(mid);
      this.buildPumpkin(p, o);
      fix(p, "Neck");
      this.pumpkin = p;
    } else {
      const g = new Group();
      g.position.set(mid.x, crown, mid.z);
      this.buildHair(g, o);
      this.buildHat(g, o);
      if (g.children.length) fix(g, "Head");
    }
    const back = new Group();
    back.position.set(chest.x, chest.y, chest.z);
    if (o.backpack) back.add(this.mesh(new BoxGeometry(0.3, 0.38, 0.15), this.material(o.backpack), 0, -0.08, 0.2));
    if (o.cape) {
      const c = this.mesh(new BoxGeometry(0.46, 0.85, 0.02), this.material(o.cape, true), 0, -0.3, 0.16);
      c.rotation.x = 0.12;
      back.add(c);
    }
    if (back.children.length) fix(back, "Spine2");

    // The umbrella stays upright over the right hand; holdUmbrella moves it there.
    const canopy = this.material(o.umbrellaColour, true);
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

  /** The head shows, or shrinks to nothing: for the view from the eyes, and under a pumpkin. */
  private showHead(): void {
    const b = this.body;
    if (!b) return;
    const own = this.headVisible && this.outfit.hat !== "pumpkin";
    b.bone("Head").scale.setScalar(own ? 1 : 1e-3);
    if (this.pumpkin) this.pumpkin.visible = this.headVisible;
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

  private buildHair(g: Group, o: Outfit): void {
    // The body has short hair of its own; these add to it, from the crown down.
    const hair = () => this.material(o.hair);
    if (o.hairStyle === "long") g.add(this.mesh(new BoxGeometry(0.22, 0.3, 0.07), hair(), 0, -0.24, 0.1));
    if (o.hairStyle === "bun") g.add(this.mesh(new SphereGeometry(0.06, 10, 8), hair(), 0, -0.06, 0.1));
  }

  private buildHat(g: Group, o: Outfit): void {
    if (o.hat === "cap") {
      const hat = this.material(o.hatColour);
      g.add(this.mesh(new SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), hat, 0, -0.08, 0));
      g.add(this.mesh(new BoxGeometry(0.19, 0.015, 0.13), hat, 0, -0.04, -0.15));
    } else if (o.hat === "beanie") {
      const hat = this.material(o.hatColour);
      g.add(this.mesh(new SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hat, 0, -0.09, 0));
      g.add(this.mesh(new SphereGeometry(0.04, 8, 6), hat, 0, 0.05, 0));
    } else if (o.hat === "witch") {
      const hat = this.material(o.hatColour);
      g.add(this.mesh(new CylinderGeometry(0.27, 0.27, 0.015, 24), hat, 0, -0.04, 0));
      const cone = this.mesh(new ConeGeometry(0.14, 0.36, 16), hat, 0, 0.14, 0.02);
      cone.rotation.x = 0.12;
      g.add(cone);
    }
  }

  private buildPumpkin(g: Group, o: Outfit): void {
    const orange = this.material(o.hatColour);
    const ball = this.mesh(new SphereGeometry(0.19, 18, 12), orange, 0, 0.02, 0);
    ball.scale.set(1.1, 0.88, 1.05);
    g.add(ball);
    // Ribs: thinner balls turned round the stem give the lobes.
    for (let k = 0; k < 4; k++) {
      const rib = this.mesh(new SphereGeometry(0.19, 14, 10), orange, 0, 0.02, 0);
      rib.scale.set(0.5, 0.9, 1.12);
      rib.rotation.y = (k * Math.PI) / 4;
      g.add(rib);
    }
    g.add(this.mesh(new CylinderGeometry(0.02, 0.03, 0.09, 6), this.material("#4d6b2c"), 0, 0.2, 0));
    // A face cut into the north side: two triangle eyes and a grin.
    const dark = new MeshBasicMaterial({ color: 0x2a1404 });
    this.owned.push(dark);
    for (const x of [-0.07, 0.07]) {
      const eye = this.mesh(new ConeGeometry(0.04, 0.05, 3), dark, x, 0.06, -0.19);
      eye.rotation.x = -Math.PI / 2;
      g.add(eye);
    }
    g.add(this.mesh(new BoxGeometry(0.16, 0.035, 0.03), dark, 0, -0.04, -0.19));
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
