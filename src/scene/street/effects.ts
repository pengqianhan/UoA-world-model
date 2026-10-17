// The effects of the walker views on a renderer that draws in high dynamic range (tier "full"):
// ambient occlusion, which shades where walls meet the ground and each other, and a gentle bloom,
// which lets the sun glare by day and lit windows glow by night. The renderer runs them between
// drawing the scene and tone-mapping it (WebGLRenderer.setEffects). Loaded with the first walker view.
import { Box3, Vector2, Vector3, type Camera, type Object3D, type Scene } from "three";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// Tunables, in metres where they are lengths.
/** How far round a point the occlusion looks, and how thick it takes what it finds to be. */
const AO_RADIUS = 2;
const AO_THICKNESS = 3;
/** Samples nearer the point count for more; the result is raised to this power. */
const AO_DISTANCE_EXPONENT = 1.5;
const AO_SCALE = 1.15;
/**
 * Samples per pixel, and the denoising after them. Fewer leave grain in narrow gaps between
 * buildings; more cost an integrated GPU a few milliseconds a frame for little to see.
 */
const AO_SAMPLES = 12;
const AO_DENOISE = { radius: 12, rings: 2, samples: 24, lumaPhi: 10, depthPhi: 2, normalPhi: 3 };
/** The occlusion darkens sunlit ground as well as shaded, so it is laid on at less than full strength. */
const AO_STRENGTH = 0.7;
/**
 * Metres round the camera the occlusion is worked out within. Further off it covers a pixel or two
 * and is mostly noise from grazing depths, such as the step where paint lies on the ground.
 */
const AO_REACH = 120;
/** Bloom spread, 0-1. Its threshold and strength follow the light (light.ts). */
const BLOOM_RADIUS = 0.5;

/**
 * Occlusion at half the picture's size each way: the denoising smooths what the upscale would show.
 * The pass draws the scene again for its depth and normals, at that size too. (Reading the scene's
 * own depth instead costs more on ANGLE: a multisampled depth resolves slowly there, and normals
 * worked out from depth are worked out again for every sample of the denoising.)
 */
class HalfGTAOPass extends GTAOPass {
  private hidden: Object3D[] = [];

  constructor(scene: Scene, camera: Camera) {
    super(scene, camera);
    const base = GTAOPass.prototype as unknown as Record<string, unknown>;
    if (typeof base._overrideVisibility !== "function" || typeof base._restoreVisibility !== "function") {
      throw new Error("three's GTAOPass has changed: effects.ts cannot leave the paint on the ground out of the occlusion");
    }
  }

  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
  }

  /**
   * What the pass hides while it draws the scene for its depth and normals: points and lines, as
   * three's own does, and the paint on the ground (`userData.noAO`). In a walker view the paint
   * lies on the ground's mesh, which stands for it there, while its own triangles stay where the
   * map lifted them (ground.ts); drawn as they are, they would cast occlusion on the ground round them.
   */
  _overrideVisibility(): void {
    const hidden = this.hidden;
    this.scene.traverse((o: Object3D & { isPoints?: boolean; isLine?: boolean; isLine2?: boolean }) => {
      const line = o.isPoints || o.isLine || o.isLine2;
      if (o.visible && (line || o.userData.noAO === true)) {
        o.visible = false;
        hidden.push(o);
      }
    });
  }

  _restoreVisibility(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden.length = 0;
  }
}

/** Bloom from a quarter of the picture each way instead of a half: it is a blur, and a quarter of the cost. */
class SmallBloomPass extends UnrealBloomPass {
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
  }
}

export class StreetEffects {
  readonly ao: GTAOPass;
  readonly bloom: UnrealBloomPass;

  constructor(scene: Scene, camera: Camera) {
    this.ao = new HalfGTAOPass(scene, camera);
    this.ao.output = GTAOPass.OUTPUT.Default;
    this.ao.blendIntensity = AO_STRENGTH;
    this.ao.updateGtaoMaterial({ radius: AO_RADIUS, thickness: AO_THICKNESS, distanceExponent: AO_DISTANCE_EXPONENT, distanceFallOff: 1, scale: AO_SCALE, samples: AO_SAMPLES });
    this.ao.updatePdMaterial(AO_DENOISE);
    // A box round the camera (follow), its sides moved every frame.
    this.ao.setSceneClipBox(new Box3(new Vector3(-AO_REACH, -AO_REACH, -AO_REACH), new Vector3(AO_REACH, AO_REACH, AO_REACH)));
    this.bloom = new SmallBloomPass(new Vector2(256, 256), 0.3, BLOOM_RADIUS, 4);
  }

  /** In the order the renderer runs them. */
  get list(): [GTAOPass, UnrealBloomPass] {
    return [this.ao, this.bloom];
  }

  /** Keeps the occlusion's box round the camera. */
  follow(at: Vector3): void {
    const u = this.ao.gtaoMaterial.uniforms;
    (u.sceneBoxMin!.value as Vector3).set(at.x - AO_REACH, at.y - AO_REACH, at.z - AO_REACH);
    (u.sceneBoxMax!.value as Vector3).set(at.x + AO_REACH, at.y + AO_REACH, at.z + AO_REACH);
  }

  setBloom(threshold: number, strength: number): void {
    this.bloom.threshold = threshold;
    this.bloom.strength = strength;
  }

  dispose(): void {
    this.ao.dispose();
    this.bloom.dispose();
  }
}
