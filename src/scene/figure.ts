// A walker's figure: a small made-up person, 1.75 m tall. No real person is drawn. Every walker
// looks the same: a student in a long-sleeved top, trousers, trainers and a backpack, with nothing
// meant to mark a sex or a gender. The body is Quaternius's "Animated Human" (CC0), with its idle,
// walk and run; figureBuild.ts, loaded with it on the first walk, makes it over and builds the
// hair, the backpack and the umbrella that ride on its bones. This poses it. It faces north with no
// turn and stands with its feet at its origin.
import {
  AdditiveAnimationBlendMode,
  AnimationClip,
  AnimationMixer,
  GreaterDepth,
  Group,
  KeepStencilOp,
  Mesh,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  Quaternion,
  QuaternionKeyframeTrack,
  ReplaceStencilOp,
  RingGeometry,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
  type AnimationAction,
  type Bone,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import type { Gear } from "./figureBuild.ts";

/** Where the eyes are, for the view from the walker. */
export const EYE_HEIGHT = 1.6;
/** The arms' joints are drawn this much nearer the spine than the body has them. */
const SHOULDERS = 0.88;
/** The hands are drawn this much of the size the body has them. */
const HANDS = 0.85;
/**
 * The figure standing at ease (`standing`): bones turned so that the way from each to the next
 * points along a direction in the figure's own frame (x to its right, y up, z behind it).
 */
const STAND: [bone: string, child: string, dir: [number, number, number]][] = [
  ["Spine", "Spine1", [0, 1, 0]],
  ["Spine1", "Spine2", [0, 1, 0]],
  ["Spine2", "Neck", [0, 1, 0]],
  ["Neck", "Head", [0, 1, -0.12]],
  ["Head", "HeadTop_End", [0, 1, 0]],
  ["LeftUpLeg", "LeftLeg", [-0.03, -1, 0]],
  ["LeftLeg", "LeftFoot", [0, -1, 0.02]],
  ["RightUpLeg", "RightLeg", [0.03, -1, 0]],
  ["RightLeg", "RightFoot", [0, -1, 0.02]],
  ["LeftArm", "LeftForeArm", [-0.2, -1, 0.04]],
  ["LeftForeArm", "LeftHand", [-0.08, -1, -0.22]],
  ["RightArm", "RightForeArm", [0.2, -1, 0.04]],
  ["RightForeArm", "RightHand", [0.08, -1, -0.22]],
];
/** Radians the feet point out from straight ahead, standing. */
const TOES_OUT = 0.12;
/** Radians each joint of the fingers is curled from the line of the hand, standing; and how far the thumb comes in. */
const CURL = [0.35, 0.8, 1.15];
const THUMB_IN = 0.35;
/**
 * The see-through shape leaves out the body below this, in its own units (about 0.22 m): the
 * shoes. Where the ground is painted over the soles, they would show through it.
 */
const XRAY_ABOVE = 0.45;
/** Metres a walk cycle (two steps) covers at the animation's own pace, and a run cycle. */
const WALK_CYCLE = 1.4;
const RUN_CYCLE = 2.4;
/** Metres a second over which the walk turns into a run. */
const RUN_FROM = 3.0;
const RUN_AT = 3.5;
/** The fastest the legs go, metres a second of stride: a walker sped up past it glides a little. */
const WALK_CADENCE_MAX = 3.2;
const RUN_CADENCE_MAX = 7;

interface Body {
  root: Object3D;
  mesh: SkinnedMesh;
  mixer: AnimationMixer;
  idle: AnimationAction;
  walk: AnimationAction;
  run: AnimationAction;
  bone: (name: string) => Bone;
  /** The figure standing at ease, added to the idle: see `standing`. */
  stand: AnimationAction;
}

export class Figure {
  /** At the feet; turn with `setHeading`. */
  readonly root = new Group();
  private body?: Body;
  private build?: typeof import("./figureBuild.ts");
  /** What it wears, from figureBuild.ts. */
  private gear?: Gear;
  private umbrella = new Group();
  private ring: Mesh;
  /** The body again, drawn flat only where something stands in front of it: see `xrayMaterial`. */
  private xray?: SkinnedMesh;
  private xrayMaterial: MeshBasicMaterial;
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
    this.xrayMaterial.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace("void main() {", "varying float vRise;\nvoid main() {")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vRise = position.y;");
      s.fragmentShader = s.fragmentShader.replace("void main() {", `varying float vRise;\nvoid main() {\n  if (vRise < ${XRAY_ABOVE.toFixed(2)}) discard;`);
    };
    this.xrayMaterial.customProgramCacheKey = () => "walker-xray";
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

  /** Hides the head and the hair, for the view through the walker's own eyes. */
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
    // Standing still, it stands at ease; coming to a stop, it comes into it.
    b.stand.setEffectiveWeight(1 - moving);
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
    const build = await import("./figureBuild.ts");
    const m = await build.loadBody();
    if (this.disposed) return;
    this.build = build;
    // A copy of the body with its own skeleton, sharing the geometry.
    const root = build.clone(m.scene);
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
    // Smaller hands; the clips have no scale either.
    for (const side of ["Left", "Right"]) bone(`${side}Hand`).scale.setScalar(HANDS);
    const body = { root, mesh, mixer, idle: action("idle"), walk: action("walk"), run: action("run"), bone };
    this.root.add(root);
    const stand = mixer.clipAction(this.standing(body));
    stand.play();
    this.body = { ...body, stand };
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
    this.dress();
    this.changed = true;
  }

  /**
   * The figure standing at ease. The idle clip stands as the model was made: knees bent, one foot
   * back, the hips and the shoulders turned, the back bowed, the arms held out and the hands open.
   * This turns the hips and the shoulders to face ahead, the spine upright, the legs straight under
   * the hips and the arms down by the sides (STAND), points the feet ahead, keeps them flat as they
   * were, curls the fingers, and raises the hips so the feet stay on the ground. It is a clip of its
   * own, the turns of each bone from the idle's first frame, which the mixer adds to the idle's
   * breathing as the figure comes to a stop. (Turning the bones after the mixer instead would add
   * the turns up, frame after frame, on any bone the idle holds still: the mixer only sets a bone
   * whose value has changed.)
   */
  private standing(b: Omit<Body, "stand">): AnimationClip {
    b.idle.time = 0;
    b.idle.setEffectiveWeight(1);
    b.walk.setEffectiveWeight(0);
    b.run.setEffectiveWeight(0);
    b.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const sides = ["Left", "Right"] as const;
    const fingers = sides.flatMap((s) => [...CURL.map((_, k) => `${s}HandIndex${k + 1}`), `${s}HandThumb1`]);
    const bones = [...new Set(["Hips", ...STAND.map(([n]) => n), "LeftFoot", "RightFoot", ...fingers])].map(b.bone);
    const idle = bones.map((x) => x.quaternion.clone());
    const local = (name: string) => this.root.worldToLocal(b.bone(name).getWorldPosition(new Vector3()));
    // The feet as flat as they were, pointing ahead and a little out.
    const toes = sides.map((s) => {
      const toe = local(`${s}ToeBase`).sub(local(`${s}Foot`));
      const flat = Math.hypot(toe.x, toe.z);
      const out = (s === "Left" ? -1 : 1) * TOES_OUT;
      return new Vector3(Math.sin(out) * flat, toe.y, -Math.cos(out) * flat);
    });
    const v = new Vector3();
    const ankles = () => sides.reduce((y, s) => y + b.bone(`${s}Foot`).getWorldPosition(v).y / 2, 0);
    const before = ankles();
    // The idle stands a little turned, the hips one way and the shoulders another: both face ahead.
    square(b.bone("Hips"), b.bone("LeftUpLeg"), b.bone("RightUpLeg"), this.root);
    for (const [name, child, dir] of STAND) {
      aim(b.bone(name), b.bone(child), this.root, v.set(...dir));
      if (name === "Spine2") square(b.bone("Spine2"), b.bone("LeftArm"), b.bone("RightArm"), this.root);
    }
    sides.forEach((s, i) => aim(b.bone(`${s}Foot`), b.bone(`${s}ToeBase`), this.root, toes[i]!));
    // The hands relaxed: the fingers curled towards the palm, which faces the thigh, and the thumb in.
    for (const s of sides) {
      const hand = local(`${s}Hand`);
      const down = local(`${s}HandIndex1`).sub(hand).normalize();
      const thumb = local(`${s}HandThumb1`).sub(hand);
      const palm = new Vector3().crossVectors(down, thumb).normalize();
      if (palm.x * (s === "Left" ? 1 : -1) < 0) palm.negate();
      CURL.forEach((angle, k) => {
        const dir = down.clone().multiplyScalar(Math.cos(angle)).addScaledVector(palm, Math.sin(angle));
        aim(b.bone(`${s}HandIndex${k + 1}`), b.bone(`${s}HandIndex${k + 2}`), this.root, dir);
      });
      const tuck = thumb.normalize().lerp(down, THUMB_IN).addScaledVector(palm, 0.25);
      aim(b.bone(`${s}HandThumb1`), b.bone(`${s}HandThumb2`), this.root, tuck);
    }
    const hips = b.bone("Hips");
    const at = hips.getWorldPosition(new Vector3());
    const lift = hips.parent!.worldToLocal(at.clone().setY(at.y + before - ankles())).sub(hips.parent!.worldToLocal(at.clone()));
    const tracks = [
      ...bones.map((x, i) => new QuaternionKeyframeTrack(`${x.name}.quaternion`, [0], idle[i]!.clone().invert().multiply(x.quaternion).toArray())),
      new VectorKeyframeTrack(`${hips.name}.position`, [0], lift.toArray()),
    ];
    return new AnimationClip("stand", -1, tracks, AdditiveAnimationBlendMode);
  }

  /** Takes the gear off. Its shapes and paint are every figure's, and stay. */
  private undress(): void {
    const g = this.gear;
    if (!g) return;
    for (const part of [g.hair, g.backpack, g.umbrella, g.blot]) part.removeFromParent();
    this.gear = undefined;
  }

  /** Paints the body and fixes the hair, the backpack and the umbrella to it. */
  private dress(): void {
    const b = this.body;
    const build = this.build;
    if (!b || !build) return;
    this.undress();
    // Gear is fitted to the figure standing at ease, its head shown and its hands down, then fixed
    // to a bone.
    const stance = this.stance;
    const open = this.umbrellaOpen;
    this.umbrellaOpen = false;
    b.bone("Head").scale.setScalar(1);
    this.last = undefined;
    this.pose(0, 0, 0);
    this.umbrellaOpen = open;
    this.root.updateMatrixWorld(true);
    const gear = build.makeGear(this.root, b.mesh, (name) => this.root.worldToLocal(b.bone(name).getWorldPosition(new Vector3())));
    this.gear = gear;
    b.mesh.material = gear.skin;
    for (const [part, to] of [[gear.hair, "Head"], [gear.backpack, "Spine2"]] as const) {
      this.root.add(part);
      part.updateMatrixWorld(true);
      b.bone(to).attach(part);
    }
    this.root.add(gear.blot);
    // The umbrella stays upright over the right hand; holdUmbrella moves it there.
    this.umbrella.add(gear.umbrella);
    this.umbrella.visible = this.umbrellaOpen && this.headVisible;
    this.showHead();
    // Every part of the figure marks where it is seen, so that its x-ray stays off it.
    this.root.traverse((part) => {
      if (!(part instanceof Mesh) || part === this.ring || part === gear.blot || part === this.xray) return;
      for (const m of [part.material].flat() as Material[]) {
        m.stencilWrite = true;
        m.stencilRef = 1;
        m.stencilZPass = ReplaceStencilOp;
      }
    });
    // Back to the pose it had.
    this.last = undefined;
    this.pose(stance.moving, stance.speed, stance.t);
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
  const { from, to, want, q } = tmp;
  bone.getWorldPosition(from);
  child.getWorldPosition(to);
  tmp.dir.subVectors(to, from).normalize();
  want.copy(dir).transformDirection(frame.matrixWorld);
  turn(bone, q.setFromUnitVectors(tmp.dir, want));
}

/**
 * Turns `bone` about `frame`'s up so that, seen from above, the way from `left` to `right` runs
 * along `frame`'s x axis: a body whose left and right those are faces straight ahead.
 */
function square(bone: Bone, left: Bone, right: Bone, frame: Object3D): void {
  const a = frame.worldToLocal(left.getWorldPosition(new Vector3()));
  const b = frame.worldToLocal(right.getWorldPosition(new Vector3()));
  const up = new Vector3(0, 1, 0).transformDirection(frame.matrixWorld);
  turn(bone, tmp.q.setFromAxisAngle(up, Math.atan2(b.z - a.z, b.x - a.x)));
}

/** Turns `bone` by `q`, a turn in the world. */
function turn(bone: Bone, q: Quaternion): void {
  const { world, parent } = tmp;
  bone.getWorldQuaternion(world);
  world.premultiply(q);
  if (bone.parent) bone.parent.getWorldQuaternion(parent);
  else parent.identity();
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateMatrixWorld(true);
}
