// The look of the walker views, the street seen from a walker's height: a sky with the sun where it
// really stands (or stars and a moon by night), the light it throws, haze in the distance, walls
// with storeys, windows and the grain of what they are made of (facade.ts), and a picture exposed
// and tone-mapped like a camera's. On a renderer that draws in high dynamic range (tier "full",
// tier.ts) the scene is drawn into a half-float target, with ambient occlusion and bloom laid on
// before the tone curve; elsewhere the materials tone-map as they draw.
//
// Everything here is on only while a walker view is: entering it puts the look in place, leaving
// it takes it all away again, and the map is drawn exactly as before (CampusScene.applyPalette
// puts back the map's light and haze).
import {
  ACESFilmicToneMapping,
  Color,
  FogExp2,
  NoToneMapping,
  Vector3,
  type AmbientLight,
  type DirectionalLight,
  type HemisphereLight,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { AMBIENT_COLOUR, acesFilmic, direction, skyRadiance, skylight, streetLighting, type StreetInputs, type StreetLighting } from "./light.ts";
import type { StreetTier } from "./tier.ts";
import type { StreetSky } from "./sky.ts";
import type { NightSky } from "./night.ts";
import type { StreetEffects } from "./effects.ts";
import type { StreetFacades } from "./facade.ts";

export interface StreetLights {
  sun: DirectionalLight;
  hemi: HemisphereLight;
  ambient: AmbientLight;
}

/** What the look is doing now. For tests. */
export interface StreetState {
  active: boolean;
  tier: StreetTier | "off";
  /** What draws a frame, in order. */
  passes: string[];
  /** Whether the sky is in the scene; it arrives a moment after the first walker view opens. */
  sky: boolean;
  exposure: number;
}

/** The tone curve: ACES filmic, the contrast and the soft shoulder of film. */
const TONE_MAPPING = ACESFilmicToneMapping;
/**
 * Pixels per CSS pixel at most in the full tier, whose picture is half-float and multisampled:
 * on an Intel UHD 770 at 1440 by 900 the look takes about 21 ms a frame at 1.25, 31 ms at 1.5.
 */
const PIXEL_RATIO = 1.25;
/**
 * Shadow edges are blurred over this many texels of the shadow map (8 cm each round the walker):
 * the sun is not a point. Wider, the five taps of three's PCF show as grain.
 */
const SHADOW_SOFTNESS = 2;
/** Degrees above the horizon whose sky colour the haze takes, in the direction looked. */
const HAZE_ELEVATION = 2;
/**
 * A walk whose frames come slower than this, ms (the median of the first frames drawn one after
 * another), lets the effects go: a smooth walk is worth more than the shading.
 */
const SLOW_FRAME = 40;
const GOVERNOR_FRAMES = 20;

export class StreetLook {
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: PerspectiveCamera;
  private lights: StreetLights;
  private redraw: () => void;
  private dress: () => void;
  private tier: StreetTier;
  /** Whether the renderer draws into a half-float target before tone-mapping (tier "full" at start). */
  private readonly hdr: boolean;
  private on = false;
  private kit?: { sky: StreetSky; night: NightSky; effects?: StreetEffects; facades: StreetFacades };
  private loading?: Promise<void>;
  private inputs: StreetInputs = { night: 0 };
  private lighting?: StreetLighting;
  private fog = new FogExp2(0xffffff, 0);
  /** What the map had, put back on leaving. */
  private saved = { pixelRatio: 1, shadowRadius: 1, exposure: 1, ambient: new Color() };
  private gaps: number[] = [];
  private lastDrawn = 0;
  private governed = false;
  private look = new Vector3();
  private toLight = new Vector3();

  /** `dress` puts the facades on the buildings when they arrive while a walker view is open. */
  constructor(o: { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; lights: StreetLights; tier: StreetTier; redraw: () => void; dress: () => void }) {
    this.renderer = o.renderer;
    this.scene = o.scene;
    this.camera = o.camera;
    this.lights = o.lights;
    this.tier = o.tier;
    this.hdr = o.tier === "full";
    this.redraw = o.redraw;
    this.dress = o.dress;
  }

  get active(): boolean {
    return this.on;
  }

  /**
   * Whether the buildings' walls go into the depth buffer alone before they are shaded: a graphics
   * card then shades each pixel of a wall once (tier "full"); a software renderer, which has no
   * early depth test to gain from it, only draws them twice.
   */
  get depthFirst(): boolean {
    return this.hdr;
  }

  /** What draws the buildings' walls in a walker view, once it has loaded; none on the map. */
  get facades(): StreetFacades | undefined {
    return this.on ? this.kit?.facades : undefined;
  }

  /** Puts the look in place. The light follows from setLight, which the scene calls after. */
  enter(): void {
    if (this.on) return;
    this.on = true;
    const r = this.renderer;
    this.saved = { pixelRatio: r.getPixelRatio(), shadowRadius: this.lights.sun.shadow.radius, exposure: r.toneMappingExposure, ambient: this.lights.ambient.color.clone() };
    this.lights.ambient.color.setRGB(...AMBIENT_COLOUR);
    if (this.hdr) r.setPixelRatio(Math.min(this.saved.pixelRatio, PIXEL_RATIO));
    // With tone mapping set, a half-float renderer draws the scene into its own target (WebGLOutput).
    r.toneMapping = TONE_MAPPING;
    this.lights.sun.shadow.radius = SHADOW_SOFTNESS;
    this.gaps = [];
    if (this.kit) this.install();
    else this.load();
    this.apply();
  }

  /** Takes the look away; the scene's palette puts back the map's light and haze after it. */
  exit(): void {
    if (!this.on) return;
    this.on = false;
    const r = this.renderer;
    if (this.kit) this.scene.remove(this.kit.sky.dome, this.kit.night.group);
    this.scene.environment = null;
    this.scene.environmentIntensity = 1;
    if (this.scene.fog === this.fog) this.scene.fog = null;
    if (this.hdr) r.setEffects([]);
    r.toneMapping = NoToneMapping;
    r.toneMappingExposure = this.saved.exposure;
    this.lights.sun.shadow.radius = this.saved.shadowRadius;
    this.lights.ambient.color.copy(this.saved.ambient);
    if (this.hdr) r.setPixelRatio(this.saved.pixelRatio);
  }

  /** The sun, the night and the weather the look is lit by; applied while it is on. */
  setLight(inputs: StreetInputs): void {
    this.inputs = inputs;
    if (this.on) this.apply();
  }

  /** Draws a frame of the walker view. */
  render(): void {
    const kit = this.kit;
    if (kit) {
      kit.sky.follow(this.camera);
      kit.night.follow(this.camera);
      kit.effects?.follow(this.camera.position);
      kit.facades.tick(performance.now() / 60000);
      // Made again only when the sky has changed enough to show (sky.ts).
      if (this.hdr) this.scene.environment = kit.sky.environment();
    }
    this.haze();
    this.renderer.render(this.scene, this.camera);
    this.govern();
  }

  state(): StreetState {
    const effects = this.on && this.tier === "full" && !!this.kit?.effects;
    return {
      active: this.on,
      tier: this.on ? this.tier : "off",
      passes: !this.on ? [] : this.hdr ? ["scene", ...(effects ? ["gtao", "bloom"] : []), "output"] : ["scene"],
      sky: !!this.kit?.sky.dome.parent,
      exposure: this.renderer.toneMappingExposure,
    };
  }

  dispose(): void {
    this.exit();
    this.kit?.sky.dispose();
    this.kit?.night.dispose();
    this.kit?.effects?.dispose();
    this.kit?.facades.dispose();
  }

  /** The sky, the stars, the effects and the facades come in a chunk of their own with the first walker view. */
  private load(): void {
    this.loading ??= Promise.all([import("./sky.ts"), import("./night.ts"), this.hdr ? import("./effects.ts") : undefined, import("./facade.ts")])
      .then(([sky, night, effects, facade]) => {
        this.kit = {
          sky: new sky.StreetSky(this.renderer),
          night: new night.NightSky(),
          effects: effects && new effects.StreetEffects(this.scene, this.camera),
          facades: new facade.StreetFacades(this.renderer),
        };
        if (!this.on) return;
        this.install();
        this.apply();
        this.dress();
      })
      .catch((e) => console.error("street look", e));
  }

  private install(): void {
    const kit = this.kit!;
    this.scene.add(kit.sky.dome, kit.night.group);
    if (kit.effects && this.tier === "full") this.renderer.setEffects(kit.effects.list);
  }

  private apply(): void {
    const l = (this.lighting = streetLighting(this.inputs));
    const { sun, hemi, ambient } = this.lights;
    sun.color.setRGB(...l.lightColour);
    sun.intensity = l.lightIntensity;
    ambient.intensity = l.ambient;
    if (this.hdr) {
      // The environment map (sky.ts) is the skylight, coming from where the sky is bright.
      hemi.intensity = 0;
      this.scene.environmentIntensity = l.skylight;
    } else {
      // Without one, the hemisphere light gives the same light from above and from the ground. A
      // hemisphere light's colour is irradiance, π times the radiance it stands for.
      const above = skylight([0, 1, 0], l.sky).map((v) => v * l.skylight * Math.PI) as [number, number, number];
      hemi.color.setRGB(...above);
      hemi.groundColor.setRGB(l.sky.ground[0] * Math.PI, l.sky.ground[1] * Math.PI, l.sky.ground[2] * Math.PI);
      hemi.intensity = 1;
    }
    this.renderer.toneMappingExposure = l.exposure;
    this.fog.density = l.fogDensity;
    this.scene.fog = this.fog;
    this.kit?.sky.set(l.sky, l.skylight);
    this.kit?.night.set(l.stars, l.moon);
    this.kit?.effects?.setBloom(l.bloomThreshold, l.bloomStrength);
    // The facades' recesses are shaded from the scene's directional light, the sun or the moon.
    this.kit?.facades.setLight({ ...l.windows, sun: this.toLight.subVectors(sun.position, sun.target.position), reflect: 1 / l.skylight });
    this.redraw();
  }

  /**
   * The haze takes the colour of the sky just above the horizon where the camera looks, so that the
   * distance meets the sky without a seam. Materials drawn straight to the screen add haze after
   * their tone mapping, so there it is tone-mapped already.
   */
  private haze(): void {
    const l = this.lighting;
    if (!l) return;
    const d = this.camera.getWorldDirection(this.look);
    const sky = skyRadiance(direction((Math.atan2(d.x, -d.z) * 180) / Math.PI, HAZE_ELEVATION), l.sky);
    const c = this.hdr ? sky : acesFilmic(sky, this.renderer.toneMappingExposure);
    this.fog.color.setRGB(c[0], c[1], c[2]);
  }

  /** Lets the effects go if the first frames of a walk come too slowly (see SLOW_FRAME). */
  private govern(): void {
    if (this.governed || this.tier !== "full" || !this.kit?.effects) return;
    const now = performance.now();
    const gap = now - this.lastDrawn;
    this.lastDrawn = now;
    // A gap this long is the view standing still, not a slow frame.
    if (gap > 250) return;
    this.gaps.push(gap);
    if (this.gaps.length < GOVERNOR_FRAMES) return;
    this.governed = true;
    const median = this.gaps.sort((a, b) => a - b)[this.gaps.length >> 1]!;
    if (median <= SLOW_FRAME) return;
    this.tier = "basic";
    this.renderer.setEffects([]);
    this.redraw();
  }
}
