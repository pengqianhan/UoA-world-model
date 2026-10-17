// The sky over the walker views: three's Preetham sky (Sky.js) brought to the scene's light, with
// the night, dusk, cloud and haze it leaves out (light.ts works out how much of each). A second,
// greyer copy of it over a ground lights the scene: an environment map that every material takes
// its skylight from. Loaded with the first walker view.
import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  UniformsUtils,
  Vector3,
  type IUniform,
  type Camera,
  type Texture,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { BLUE_HOUR, DUSK, NIGHT_HORIZON, NIGHT_ZENITH, SKY_GAIN, SKYLIGHT_SATURATION, SUN_PEAK, type SkySettings } from "./light.ts";

/** Sky.js's shader. Its typing is a bare object. */
const SKY = Sky.SkyShader as { uniforms: Record<string, IUniform>; vertexShader: string; fragmentShader: string };

/** Where the model's colour is final, and the sums light.ts repeats (finishSky) go in. */
const FINAL = "gl_FragColor = vec4( texColor, 1.0 );";
const FINISH = /* glsl */ `
  // Street look (sky.ts): the model's radiance in the scene's units, the sun's disc kept within
  // reach of the bloom, then the night, dusk, overcast and haze; light.ts repeats these sums.
  texColor *= skyGain;
  texColor *= min( 1.0, sunPeak / max( max( max( texColor.r, texColor.g ), texColor.b ), 1e-4 ) );
  float up = max( direction.y, 0.0 );
  float towards = max( dot( normalize( direction.xz + vec2( 1e-5 ) ), normalize( vSunDirection.xz + vec2( 1e-5 ) ) ), 0.0 );
  float glow = pow( towards, 3.0 ) * exp( - up * 6.0 ) * twilight;
  float dome = sqrt( up );
  texColor += mix( nightHorizon, nightZenith, dome ) * night;
  texColor += dusk * glow + blueHour * dome * twilight;
  texColor = mix( texColor, overcast * ( 0.82 + 0.18 * up ), overcastAmount );
  texColor = mix( texColor, overcast * 1.08, hazeAmount * ( 1.0 - 0.6 * up ) );
  texColor = mix( vec3( dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ), texColor, saturation );
  ${FINAL}`;

/** The added uniforms, declared ahead of Sky.js's own. */
const DECLARE = /* glsl */ `uniform float skyGain;
uniform float sunPeak;
uniform vec3 overcast;
uniform float overcastAmount;
uniform float hazeAmount;
uniform float night;
uniform float twilight;
uniform vec3 nightZenith;
uniform vec3 nightHorizon;
uniform vec3 dusk;
uniform vec3 blueHour;
uniform float saturation;
`;

function skyMaterial(seen: boolean): ShaderMaterial {
  if (!SKY.fragmentShader.includes(FINAL)) throw new Error("Sky.js has changed: its final colour line is not where sky.ts expects it");
  const v = (c: readonly number[]) => ({ value: new Vector3(...c) });
  const material = new ShaderMaterial({
    name: seen ? "StreetSky" : "StreetSkylight",
    uniforms: {
      ...UniformsUtils.clone(SKY.uniforms),
      skyGain: { value: SKY_GAIN },
      sunPeak: { value: SUN_PEAK },
      overcast: v([0, 0, 0]),
      overcastAmount: { value: 0 },
      hazeAmount: { value: 0 },
      night: { value: 0 },
      twilight: { value: 0 },
      nightZenith: v(NIGHT_ZENITH),
      nightHorizon: v(NIGHT_HORIZON),
      dusk: v(DUSK),
      blueHour: v(BLUE_HOUR),
      // The skylight is greyer than the sky looks, and has no sun's disc in it: the sun is a light of its own.
      saturation: { value: seen ? 1 : SKYLIGHT_SATURATION },
    },
    vertexShader: SKY.vertexShader,
    fragmentShader: DECLARE + SKY.fragmentShader.replace(FINAL, FINISH),
    side: BackSide,
    depthWrite: false,
  });
  material.uniforms.showSunDisc!.value = seen ? 1 : 0;
  // The clouds are drawn still: a sky that drifted would need a frame drawn every frame.
  material.uniforms.time!.value = 0;
  return material;
}

/** Edge of the environment's scene, metres: inside the cube camera's far plane. */
const ENV_FAR = 1000;
/** The environment map's cube face, pixels: it carries diffuse light only, which is smooth. */
const ENV_SIZE = 128;
/** The sun moving this far, degrees, or the night or the weather by this much, makes a new environment. */
const ENV_TURN = 1;
const ENV_STEP = 0.02;

export class StreetSky {
  /** The sky seen: a box round the camera, drawn at the far plane after everything opaque. */
  readonly dome: Mesh<BoxGeometry, ShaderMaterial>;
  private skylight: Mesh<BoxGeometry, ShaderMaterial>;
  private ground: Mesh<SphereGeometry, MeshBasicMaterial>;
  private envScene = new Scene();
  private pmrem: PMREMGenerator;
  private env?: WebGLRenderTarget;
  private captured?: SkySettings;
  private settings?: SkySettings;

  constructor(renderer: WebGLRenderer) {
    this.dome = new Mesh(new BoxGeometry(1, 1, 1), skyMaterial(true));
    this.dome.scale.setScalar(1000);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 1;
    this.dome.userData.noPick = true;
    this.skylight = new Mesh(this.dome.geometry, skyMaterial(false));
    this.skylight.scale.setScalar(ENV_FAR);
    // The lower half of the environment is the ground, lit by the sun and the sky (light.ts).
    this.ground = new Mesh(new SphereGeometry(ENV_FAR / 2, 32, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new MeshBasicMaterial({ side: BackSide }));
    this.envScene.add(this.skylight, this.ground);
    this.pmrem = new PMREMGenerator(renderer);
  }

  /** `skylight` is the share of the environment the scene takes (scene.environmentIntensity). */
  set(s: SkySettings, skylight: number): void {
    this.settings = s;
    for (const [m, clouds] of [
      [this.dome.material, s.cloud],
      [this.skylight.material, 0],
    ] as const) {
      const u = m.uniforms;
      // Sky.js fades the sun below the horizon by its height at this distance.
      (u.sunPosition!.value as Vector3).set(...s.sun).multiplyScalar(450000);
      u.turbidity!.value = s.turbidity;
      u.rayleigh!.value = s.rayleigh;
      u.mieCoefficient!.value = s.mie;
      u.mieDirectionalG!.value = s.mieG;
      // The environment is taken without the shader's clouds, whose noise would only blotch the light.
      u.cloudCoverage!.value = clouds;
      (u.overcast!.value as Vector3).set(...s.overcast);
      u.overcastAmount!.value = s.overcastAmount;
      u.hazeAmount!.value = s.hazeAmount;
      u.night!.value = s.night;
      u.twilight!.value = s.twilight;
    }
    // The ground's radiance is the scene's already; the environment as a whole is scaled down.
    this.ground.material.color.setRGB(s.ground[0] / skylight, s.ground[1] / skylight, s.ground[2] / skylight);
  }

  /** Keeps the sky round the camera. */
  follow(camera: Camera): void {
    this.dome.position.copy(camera.position);
  }

  /** The environment map for the sky as set, made again only when the sky changed enough to show. */
  environment(): Texture | null {
    const s = this.settings;
    if (!s) return null;
    const c = this.captured;
    const turned = c ? (Math.acos(Math.min(1, s.sun[0] * c.sun[0] + s.sun[1] * c.sun[1] + s.sun[2] * c.sun[2])) * 180) / Math.PI : Infinity;
    const changed =
      !c ||
      turned > ENV_TURN ||
      [
        [s.night, c.night],
        [s.twilight, c.twilight],
        [s.overcastAmount, c.overcastAmount],
        [s.hazeAmount, c.hazeAmount],
      ].some(([a, b]) => Math.abs(a! - b!) > ENV_STEP) ||
      s.ground.some((g, i) => Math.abs(g - c.ground[i]!) > ENV_STEP * Math.max(0.05, c.ground[i]!));
    if (changed || !this.env) {
      this.env?.dispose();
      this.env = this.pmrem.fromScene(this.envScene, 0, 0.1, ENV_FAR * 2, { size: ENV_SIZE });
      this.captured = s;
    }
    return this.env.texture;
  }

  dispose(): void {
    this.env?.dispose();
    this.pmrem.dispose();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.skylight.material.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
  }
}
