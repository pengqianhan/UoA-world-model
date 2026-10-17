// Stars and the moon over the walker views after dark. Both are drawn by rule: the stars are
// scattered the same way on every load, not charted, and the moon stands where the night's light
// comes from (the palette's), so that what it lights agrees with where it is.
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
} from "three";
import { moonDirection } from "./light.ts";

const STARS = 2600;
/** Metres from the eye: inside the far plane, so buildings and hills stand in front. */
const STAR_DISTANCE = 4800;
const MOON_DISTANCE = 4500;
/** The moon's disc, degrees across: about twice the real moon's, which looks small on a screen. */
const MOON_SIZE = 1.1;
/** Share of the moon's picture its disc takes up; the rest is its glow. */
const MOON_DISC = 0.42;
/** Linear brightness of the brightest stars and of the moon: enough to bloom at night. */
const STAR_PEAK = 1.6;
const MOON_GLOW: [number, number, number] = [2.6, 2.6, 2.5];

/** Deterministic pseudo-random numbers, so the sky is the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A soft round dot, so that a star is not a square. */
function dot(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(255,255,255,0.6)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

/** The moon full, with a soft glow round it: a disc darkened to its edge and mottled a little. */
function moonTexture(): CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const mid = size / 2;
  const disc = (size * MOON_DISC) / 2;
  const glow = g.createRadialGradient(mid, mid, disc * 0.9, mid, mid, mid);
  glow.addColorStop(0, "rgba(200,214,240,0.35)");
  glow.addColorStop(0.3, "rgba(170,190,230,0.08)");
  glow.addColorStop(1, "rgba(150,170,220,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  const face = g.createRadialGradient(mid - disc * 0.15, mid - disc * 0.15, disc * 0.1, mid, mid, disc);
  face.addColorStop(0, "#f4f1e8");
  face.addColorStop(0.75, "#e2dfd6");
  face.addColorStop(1, "#bdbab2");
  g.fillStyle = face;
  g.beginPath();
  g.arc(mid, mid, disc, 0, Math.PI * 2);
  g.fill();
  // Darker patches, as seen with the naked eye; drawn by rule, not mapped.
  const rand = mulberry32(11);
  g.save();
  g.clip();
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * disc * 0.7;
    const r = disc * (0.12 + rand() * 0.22);
    const x = mid + Math.cos(a) * d;
    const y = mid + Math.sin(a) * d;
    const patch = g.createRadialGradient(x, y, 0, x, y, r);
    patch.addColorStop(0, "rgba(120,124,130,0.35)");
    patch.addColorStop(1, "rgba(120,124,130,0)");
    g.fillStyle = patch;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class NightSky {
  /** Follows the camera, like the sky. */
  readonly group = new Group();
  private stars: Points<BufferGeometry, PointsMaterial>;
  private moon: Sprite;

  constructor() {
    const rand = mulberry32(2026);
    const position: number[] = [];
    const colour: number[] = [];
    for (let i = 0; i < STARS; i++) {
      // Even over the sky above the horizon, a little clear of it, where the haze hides them anyway.
      const y = 0.03 + rand() * 0.97;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      position.push(Math.cos(a) * r * STAR_DISTANCE, y * STAR_DISTANCE, Math.sin(a) * r * STAR_DISTANCE);
      // Most stars are faint and a few bright; most are white, some blue and some orange.
      const bright = STAR_PEAK * Math.pow(rand(), 5) + 0.05;
      const hue = rand();
      const tint = hue < 0.15 ? [0.75, 0.85, 1] : hue > 0.88 ? [1, 0.82, 0.62] : [1, 0.97, 0.94];
      colour.push(tint[0]! * bright, tint[1]! * bright, tint[2]! * bright);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colour, 3));
    this.stars = new Points(
      geometry,
      new PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, map: dot(), transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false }),
    );
    this.stars.frustumCulled = false;
    this.moon = new Sprite(new SpriteMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false }));
    this.moon.material.color.setRGB(...MOON_GLOW);
    this.moon.position.copy(new Vector3(...moonDirection()).multiplyScalar(MOON_DISTANCE));
    this.moon.scale.setScalar((2 * MOON_DISTANCE * Math.tan(((MOON_SIZE / MOON_DISC) * Math.PI) / 360)));
    this.group.add(this.stars, this.moon);
    this.group.userData.noPick = true;
    this.group.traverse((o) => (o.userData.noPick = true));
  }

  /** How much of the stars and the moon shows, 0-1 each. */
  set(stars: number, moon: number): void {
    this.stars.material.opacity = stars;
    this.stars.visible = stars > 0.01;
    this.moon.material.opacity = moon;
    this.moon.visible = moon > 0.01;
  }

  follow(camera: Camera): void {
    this.group.position.copy(camera.position);
  }

  dispose(): void {
    this.stars.geometry.dispose();
    this.stars.material.map?.dispose();
    this.stars.material.dispose();
    this.moon.material.map?.dispose();
    this.moon.material.dispose();
  }
}
