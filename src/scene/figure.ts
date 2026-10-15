// A walker's figure: a small person built from simple shapes, 1.75 m tall, dressed in an outfit
// (src/shared/outfit.ts). Made up, like the walker; no real person is drawn. It faces north
// with no turn, stands with its feet at its origin, and swings its arms and legs as it walks.
import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RingGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import type { Outfit } from "../shared/outfit.ts";

/** Metres. */
const HIP = 0.9;
const LEG = 0.82;
const SHOULDER = 1.4;
const ARM = 0.5;
const HEAD = 1.61;
/** Where the eyes are, for the view from the walker. */
export const EYE_HEIGHT = 1.62;

export class Figure {
  /** At the feet; turn with `setHeading`. */
  readonly root = new Group();
  private body = new Group();
  private legL = new Group();
  private legR = new Group();
  private armL = new Group();
  private armR = new Group();
  private head = new Group();
  private umbrella = new Group();
  private ring: Mesh;
  private owned: (BufferGeometry | Material)[] = [];
  private outfit: Outfit;
  private umbrellaOpen = false;

  constructor(outfit: Outfit, ringColour: number) {
    this.outfit = outfit;
    this.root.add(this.body);
    this.body.add(this.legL, this.legR, this.armL, this.armR, this.head, this.umbrella);
    // A ring on the ground round the feet, so the walker can be found from above.
    const ringGeometry = new RingGeometry(0.75, 1.05, 32);
    ringGeometry.rotateX(-Math.PI / 2);
    this.ring = new Mesh(ringGeometry, new MeshBasicMaterial({ color: ringColour, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.position.y = 0.1;
    this.ring.renderOrder = 2;
    this.root.add(this.ring);
    this.build();
    this.root.traverse((o) => (o.userData.noPick = true));
  }

  /** Turns the figure to face a compass bearing, degrees clockwise from north. */
  setHeading(deg: number): void {
    this.root.rotation.y = (-deg * Math.PI) / 180;
  }

  setOutfit(outfit: Outfit): void {
    this.outfit = outfit;
    this.build();
  }

  /** Opens or closes the umbrella. */
  setUmbrella(open: boolean): void {
    if (open === this.umbrellaOpen) return;
    this.umbrellaOpen = open;
    this.umbrella.visible = open;
  }

  /** Hides the head and hat, for the view through the walker's own eyes. */
  setHeadVisible(visible: boolean): void {
    this.head.visible = visible;
    this.umbrella.visible = this.umbrellaOpen && visible;
  }

  setRingVisible(visible: boolean): void {
    this.ring.visible = visible;
  }

  /**
   * Poses the figure: `phase` advances one stride cycle per 2π, `moving` is 0 standing to 1
   * walking, `t` is seconds for the breathing of a figure standing still.
   */
  pose(phase: number, moving: number, t: number): void {
    const swing = Math.sin(phase) * moving;
    this.legL.rotation.x = 0.55 * swing;
    this.legR.rotation.x = -0.55 * swing;
    this.armL.rotation.x = -0.45 * swing;
    this.armR.rotation.x = this.umbrellaOpen ? -1.15 : 0.45 * swing;
    this.armR.rotation.z = this.umbrellaOpen ? 0.25 : 0;
    this.body.position.y = 0.035 * Math.abs(Math.sin(phase)) * moving + 0.008 * Math.sin(t * 1.7) * (1 - moving);
  }

  dispose(): void {
    for (const x of this.owned) x.dispose();
    this.owned = [];
    (this.ring.geometry as BufferGeometry).dispose();
    (this.ring.material as Material).dispose();
  }

  private mat(colour: string): MeshLambertMaterial {
    const m = new MeshLambertMaterial({ color: colour });
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

  /** Builds the parts for the current outfit, replacing any built before. */
  private build(): void {
    for (const x of this.owned) x.dispose();
    this.owned = [];
    for (const g of [this.legL, this.legR, this.armL, this.armR, this.head, this.umbrella]) g.clear();
    for (const child of [...this.body.children]) if (child instanceof Mesh) this.body.remove(child);
    const o = this.outfit;
    const skin = this.mat(o.skin);
    const top = this.mat(o.top);
    const bottom = this.mat(o.bottom);
    const shoes = this.mat(o.shoes);

    // Legs hang from the hips; each is a pivot at the hip with the leg and shoe below it.
    for (const [leg, x] of [
      [this.legL, -0.1],
      [this.legR, 0.1],
    ] as const) {
      leg.position.set(x, HIP, 0);
      leg.add(this.mesh(new CapsuleGeometry(0.075, LEG - 0.15, 4, 8), bottom, 0, -LEG / 2, 0));
      leg.add(this.mesh(new BoxGeometry(0.13, 0.08, 0.26), shoes, 0, -LEG - 0.04, -0.05));
    }
    // The body: hips, torso and neck.
    this.body.add(this.mesh(new CapsuleGeometry(0.15, 0.08, 4, 10), bottom, 0, HIP + 0.02, 0));
    const torso = this.mesh(new CapsuleGeometry(0.17, 0.3, 4, 12), top, 0, (HIP + SHOULDER) / 2 + 0.04, 0);
    torso.scale.set(1.2, 1, 0.75);
    this.body.add(torso);
    this.body.add(this.mesh(new CylinderGeometry(0.05, 0.06, 0.1, 8), skin, 0, SHOULDER + 0.06, 0));
    // Arms hang from the shoulders, sleeve and hand.
    for (const [arm, x] of [
      [this.armL, -0.25],
      [this.armR, 0.25],
    ] as const) {
      arm.position.set(x, SHOULDER, 0);
      arm.add(this.mesh(new CapsuleGeometry(0.055, ARM - 0.12, 4, 8), top, 0, -ARM / 2 + 0.02, 0));
      arm.add(this.mesh(new SphereGeometry(0.05, 8, 6), skin, 0, -ARM - 0.02, 0));
    }
    if (o.backpack) {
      const pack = this.mat(o.backpack);
      this.body.add(this.mesh(new BoxGeometry(0.32, 0.38, 0.16), pack, 0, (HIP + SHOULDER) / 2 + 0.08, 0.22));
    }
    if (o.cape) {
      const cape = new MeshLambertMaterial({ color: o.cape, side: DoubleSide });
      this.owned.push(cape);
      const c = this.mesh(new BoxGeometry(0.5, 0.8, 0.02), cape, 0, SHOULDER - 0.38, 0.17);
      c.rotation.x = 0.12;
      this.body.add(c);
    }

    // The head, or a pumpkin in its place.
    this.head.position.set(0, HEAD, 0);
    if (o.hat === "pumpkin") this.buildPumpkin(o);
    else {
      this.head.add(this.mesh(new SphereGeometry(0.13, 16, 12), skin));
      // Two dark eyes on the face, which looks north (-z), so it is clear which way it faces.
      const eye = this.mat("#1d1d22");
      this.head.add(this.mesh(new SphereGeometry(0.018, 6, 4), eye, -0.045, 0.02, -0.122));
      this.head.add(this.mesh(new SphereGeometry(0.018, 6, 4), eye, 0.045, 0.02, -0.122));
      this.buildHair(o);
      this.buildHat(o);
    }

    // The umbrella, held up in the right hand.
    const canopy = new MeshLambertMaterial({ color: o.umbrellaColour, side: DoubleSide });
    this.owned.push(canopy);
    const handle = this.mat("#3a3a3a");
    this.umbrella.add(this.mesh(new CylinderGeometry(0.012, 0.012, 1.0, 6), handle, 0.32, 1.95, -0.25));
    this.umbrella.add(this.mesh(new ConeGeometry(0.62, 0.26, 10, 1, true), canopy, 0.32, 2.45, -0.25));
    this.umbrella.visible = this.umbrellaOpen;
  }

  private buildHair(o: Outfit): void {
    if (o.hairStyle === "none") return;
    const hair = this.mat(o.hair);
    const cap = this.mesh(new SphereGeometry(0.138, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.012, 0.008);
    this.head.add(cap);
    if (o.hairStyle === "long") this.head.add(this.mesh(new BoxGeometry(0.24, 0.26, 0.08), hair, 0, -0.1, 0.09));
    if (o.hairStyle === "bun") this.head.add(this.mesh(new SphereGeometry(0.065, 10, 8), hair, 0, 0.1, 0.11));
  }

  private buildHat(o: Outfit): void {
    const hat = this.mat(o.hatColour);
    if (o.hat === "cap") {
      this.head.add(this.mesh(new SphereGeometry(0.142, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), hat, 0, 0.02, 0));
      const brim = this.mesh(new BoxGeometry(0.2, 0.015, 0.14), hat, 0, 0.06, -0.15);
      this.head.add(brim);
    } else if (o.hat === "beanie") {
      this.head.add(this.mesh(new SphereGeometry(0.148, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hat, 0, 0.02, 0));
      this.head.add(this.mesh(new SphereGeometry(0.04, 8, 6), hat, 0, 0.17, 0));
    } else if (o.hat === "witch") {
      this.head.add(this.mesh(new CylinderGeometry(0.27, 0.27, 0.015, 24), hat, 0, 0.08, 0));
      const cone = this.mesh(new ConeGeometry(0.15, 0.36, 16), hat, 0, 0.26, 0.02);
      cone.rotation.x = 0.12;
      this.head.add(cone);
    }
  }

  private buildPumpkin(o: Outfit): void {
    const orange = this.mat(o.hatColour);
    const ball = this.mesh(new SphereGeometry(0.19, 18, 12), orange, 0, 0.02, 0);
    ball.scale.set(1.1, 0.88, 1.05);
    this.head.add(ball);
    // Ribs: thinner balls turned round the stem give the lobes.
    for (let k = 0; k < 4; k++) {
      const rib = this.mesh(new SphereGeometry(0.19, 14, 10), orange, 0, 0.02, 0);
      rib.scale.set(0.5, 0.9, 1.12);
      rib.rotation.y = (k * Math.PI) / 4;
      this.head.add(rib);
    }
    this.head.add(this.mesh(new CylinderGeometry(0.02, 0.03, 0.09, 6), this.mat("#4d6b2c"), 0, 0.2, 0));
    // A face cut into the north side: two triangle eyes and a grin.
    const dark = new MeshBasicMaterial({ color: 0x2a1404 });
    this.owned.push(dark);
    for (const x of [-0.07, 0.07]) {
      const eye = this.mesh(new ConeGeometry(0.04, 0.05, 3), dark, x, 0.06, -0.19);
      eye.rotation.x = -Math.PI / 2;
      this.head.add(eye);
    }
    this.head.add(this.mesh(new BoxGeometry(0.16, 0.035, 0.03), dark, 0, -0.04, -0.19));
  }
}
