// The light of the street-level views, worked out from the sun, the night and the weather: how the
// sky is drawn, how strong and what colour the sun or the moon is, how the picture is exposed, how
// thick the haze lies. Plain numbers, so that tests can check them without a GPU.
//
// The sky is three's Preetham model (Sky.js, sky.ts draws it); skyRadiance repeats its sums here,
// so that the haze can take the colour of the sky behind it and a phone can light the scene from
// the same sky without an environment map. Nothing here is data: the sky is the one for the time
// and the weather shown, as the rest of the light is.
import { DAY, NIGHT } from "../palette.ts";

export type RGB = [number, number, number];
export type Vec3 = [number, number, number];

export interface StreetInputs {
  /** The sun's real direction for the time shown, degrees; none when daylight is forced at night. */
  sun?: { azimuth: number; elevation: number };
  /** 0 = day, 1 = night. */
  night: number;
  /** The weather, each 0-1; none in Preview, which draws a clear sky. */
  weather?: { cloud: number; wet: number; fog: number };
}

/** What the sky shader takes (sky.ts), and what skyRadiance needs to repeat it. */
export interface SkySettings {
  /** Towards the sun as the sky draws it: below the horizon by night, unlike the light. */
  sun: Vec3;
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  /** Share of the sky the shader's clouds cover. */
  cloud: number;
  /** An even grey that cloud and fog bring the sky to, and how far. */
  overcast: RGB;
  overcastAmount: number;
  hazeAmount: number;
  /** The night sky under the model's: 0-1, and the glow of dusk after the sun has set. */
  night: number;
  twilight: number;
  /** The ground's radiance: light thrown back up into walls and the underside of things. */
  ground: RGB;
}

export interface StreetLighting {
  sky: SkySettings;
  /** The scene's directional light: the sun by day, the moon by night (CampusScene.placeSun). */
  lightColour: RGB;
  lightIntensity: number;
  /** How much of the sky's radiance lights the scene (SKYLIGHT); the ground's is already in scene units. */
  skylight: number;
  ambient: number;
  exposure: number;
  /** FogExp2 density, per metre. */
  fogDensity: number;
  bloomThreshold: number;
  bloomStrength: number;
  /** How much of the stars and of the moon shows, 0-1. */
  stars: number;
  moon: number;
  /** What the windows show (facade.ts). */
  windows: WindowLight;
  /** How wet the ground is, 0-1: rain darkens it and makes it shine (ground.ts). */
  wet: number;
  /** Light on the ground after dark from the city round it (ground.ts), irradiance in the scene's units. */
  groundGlow: RGB;
}

/** What is seen in and on a window: the rooms behind it, their blinds, and the sky it reflects. */
export interface WindowLight {
  /** How much the rooms whose lights are on show, 0 by day to 1 after dark. */
  glow: number;
  /** A room's back wall and a blind, lit by the day through the window, in the scene's units. */
  interior: RGB;
  blind: RGB;
  /** The sky overhead and low down, and the ground, as a pane reflects them where there is no environment map. */
  skyUp: RGB;
  skyLow: RGB;
  ground: RGB;
  /** The glow of the city after dark, which a pane reflects: street lights and lit windows the scene does not draw. */
  city: RGB;
}

// Tunables. Radiance is in the scene's own units: a white wall in full sun comes to about 1.

/** Clear air over a city by the sea: little haze, a deep blue overhead. */
const TURBIDITY = 3.2;
const RAYLEIGH = 1.2;
const MIE = 0.005;
const MIE_G = 0.8;
/** Brings the model's radiance to the scene's: the blue overhead a little darker than a sunlit wall. */
export const SKY_GAIN = 0.25;
/** The brightest the sun's disc is drawn: enough to glare through the bloom, not to flood it. */
export const SUN_PEAK = 40;
/**
 * The skylight is less blue than the sky looks straight up (the haze and the ground whiten it),
 * and weaker beside the sun than the model's bright sky would make it: a clear day's shade is about
 * a quarter as bright as its sunshine.
 */
export const SKYLIGHT_SATURATION = 0.3;
const SKYLIGHT = 0.6;
/** The sun high in a clear sky, and the moon. */
const SUN_INTENSITY = 3.4;
const MOON_INTENSITY = 0.22;
const MOON_COLOUR: RGB = [0.62, 0.72, 1];
/** What the ground throws back, a mix of paving, road and grass. */
const GROUND_ALBEDO: RGB = [0.24, 0.21, 0.17];
/** Exposure by day, by night, and the most the picture opens up for a low sun. */
const EXPOSURE_DAY = 1;
const EXPOSURE_NIGHT = 1.7;
const LOW_SUN_OPENING = 1.9;
/** Some light in every shadow after dark, cool like the moon's: the city's glow and the eye's adapting. */
const AMBIENT_NIGHT = 0.1;
export const AMBIENT_COLOUR: RGB = [0.55, 0.66, 1];
/**
 * Haze per metre: by day 500 m away is a quarter hidden, 1.2 km mostly, and the map's edge, 2 km
 * out, is lost in it. Fog thickens it to a few hundred metres.
 */
export const FOG_DENSITY = 0.0011;
const FOG_THICK = 0.0045;
/** Bloom: by day only the sun's disc and the sky just round it; by night the lit windows, softly. */
export const BLOOM_THRESHOLD_DAY = 8;
const BLOOM_THRESHOLD_NIGHT = 0.55;
const BLOOM_STRENGTH_DAY = 0.08;
const BLOOM_STRENGTH_NIGHT = 0.16;
/**
 * A room seen through its window by day: lit by the window alone, its back wall is a twentieth or so
 * as bright as a sunlit wall outside (facade.ts shades its sides), a blind against the glass a few
 * times that.
 */
const INTERIOR = 0.24;
const BLIND = 0.32;
/** The city's glow in a pane after dark. */
const CITY_GLOW: RGB = [0.05, 0.045, 0.04];
/**
 * The light that falls on the ground after dark from what the scene does not draw: street lamps,
 * which are not mapped, lit rooms and shop fronts, and the glow of the clouds over the city. It is
 * warm, and enough for a street to be made out by: dark asphalt reads, pale kerbs and lines show.
 */
const GROUND_GLOW: RGB = [0.29, 0.26, 0.21];
/** Rooms light up from dusk: night 0-1, as the sun goes from just above the horizon to well below it. */
const GLOW_FROM = 0.3;
const GLOW_FULL = 0.8;
/** Where the sky is drawn when the light is forced to night while the sun is up, degrees. */
const NIGHT_SUN = -8;

const RAD = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixLog = (a: number, b: number, t: number) => Math.exp(mix(Math.log(a), Math.log(b), t));

/** A direction from a compass bearing and an elevation, degrees, in scene axes (x east, y up, z south). */
export function direction(azimuth: number, elevation: number): Vec3 {
  const az = azimuth * RAD;
  const el = elevation * RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/**
 * Where the sky draws the sun: the real sun, also below the horizon; the palette's afternoon sun
 * when daylight is forced at night; and under the horizon when night is forced by day.
 */
export function skySun(sun: StreetInputs["sun"], night: number): { azimuth: number; elevation: number } {
  if (!sun) return { azimuth: DAY.sunAzimuth, elevation: DAY.sunElevation };
  return { azimuth: sun.azimuth, elevation: night >= 1 ? Math.min(sun.elevation, NIGHT_SUN) : sun.elevation };
}

/** The moon, drawn where the night's light comes from (the palette's), so its shadows agree. */
export function moonDirection(): Vec3 {
  return direction(NIGHT.sunAzimuth, NIGHT.sunElevation);
}

// The Preetham model as three's Sky.js has it (r186), for directions above the horizon.
const TOTAL_RAYLEIGH: RGB = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST: RGB = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];

function sunIntensity(zenithCos: number): number {
  return 1000 * Math.max(0, 1 - Math.exp(-(1.6110731556870734 - Math.acos(clamp(zenithCos, -1, 1))) / 1.5));
}

/** How much of the light from a direction gets through the air, per channel. */
function extinction(dirY: number, s: Pick<SkySettings, "turbidity" | "rayleigh" | "mie">): RGB {
  const zenith = Math.acos(Math.max(0, dirY));
  const inverse = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - zenith / RAD, -1.253));
  const c = 0.2 * s.turbidity * 10e-18;
  return [0, 1, 2].map((i) => Math.exp(-(TOTAL_RAYLEIGH[i]! * s.rayleigh * 8.4e3 * inverse + 0.434 * c * MIE_CONST[i]! * s.mie * 1.25e3 * inverse))) as RGB;
}

/**
 * The sky's radiance towards a direction above the horizon, linear, as sky.ts draws it without its
 * clouds and the sun's disc. `saturation` below 1 greys it, as the skylight is.
 */
export function skyRadiance(dir: Vec3, s: SkySettings, saturation = 1): RGB {
  const sun = s.sun;
  const sunE = sunIntensity(sun[1]);
  // Below the horizon the model thins the air's scattering a little (sky.ts passes the sun far off).
  const rayleigh = s.rayleigh - (1 - Math.min(1, Math.exp(sun[1])));
  const betaR = TOTAL_RAYLEIGH.map((v) => v * rayleigh);
  const c = 0.2 * s.turbidity * 10e-18;
  const betaM = MIE_CONST.map((v) => 0.434 * c * v * s.mie);
  const fex = extinction(dir[1], { ...s, rayleigh });
  const cosTheta = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2];
  const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g2 = s.mieG * s.mieG;
  const mPhase = (1 / (4 * Math.PI)) * ((1 - g2) / Math.pow(1 - 2 * s.mieG * cosTheta + g2, 1.5));
  const low = clamp(Math.pow(1 - sun[1], 5), 0, 1);
  const out = [0, 1, 2].map((i) => {
    const ratio = (betaR[i]! * rPhase + betaM[i]! * mPhase) / (betaR[i]! + betaM[i]!);
    let lin = Math.pow(sunE * ratio * (1 - fex[i]!), 1.5);
    lin *= mix(1, Math.pow(sunE * ratio * fex[i]!, 0.5), low);
    return ((lin + 0.1 * fex[i]!) * 0.04 + [0, 0.0003, 0.00075][i]!) * SKY_GAIN;
  }) as RGB;
  return finishSky(out, dir, s, saturation);
}

/** The colours sky.ts adds to the model's: night, dusk, overcast and haze. Kept in step with FINISH there. */
export const NIGHT_ZENITH: RGB = [0.0016, 0.0032, 0.009];
export const NIGHT_HORIZON: RGB = [0.007, 0.008, 0.012];
export const DUSK: RGB = [0.5, 0.2, 0.07];
export const BLUE_HOUR: RGB = [0.012, 0.024, 0.07];

function finishSky(c: RGB, dir: Vec3, s: SkySettings, saturation: number): RGB {
  const up = Math.max(dir[1], 0);
  const sunFlat = Math.hypot(s.sun[0], s.sun[2]) || 1;
  const dirFlat = Math.hypot(dir[0], dir[2]) || 1;
  const towards = Math.max(0, (dir[0] * s.sun[0] + dir[2] * s.sun[2]) / (sunFlat * dirFlat));
  const glow = Math.pow(towards, 3) * Math.exp(-up * 6) * s.twilight;
  const dome = Math.sqrt(up);
  const out = c.map((v, i) => {
    let x = v;
    x += mix(NIGHT_HORIZON[i]!, NIGHT_ZENITH[i]!, dome) * s.night;
    x += DUSK[i]! * glow + BLUE_HOUR[i]! * dome * s.twilight;
    x = mix(x, s.overcast[i]! * (0.82 + 0.18 * up), s.overcastAmount);
    x = mix(x, s.overcast[i]! * 1.08, s.hazeAmount * (1 - 0.6 * up));
    return x;
  }) as RGB;
  if (saturation === 1) return out;
  const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  return out.map((v) => mix(luma, v, saturation)) as RGB;
}

/** ACES filmic as three applies it (tonemapping_pars_fragment), for colours that skip tone mapping. */
export function acesFilmic(rgb: RGB, exposure: number): RGB {
  const [r, g, b] = rgb.map((x) => (x * exposure) / 0.6) as RGB;
  const v = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.076 * r + 0.90834 * g + 0.01566 * b, 0.0284 * r + 0.13383 * g + 0.83777 * b];
  const f = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return [
    1.60475 * f[0]! - 0.53108 * f[1]! - 0.07367 * f[2]!,
    -0.10208 * f[0]! + 1.10813 * f[1]! - 0.00605 * f[2]!,
    -0.00327 * f[0]! - 0.07276 * f[1]! + 1.07602 * f[2]!,
  ].map((x) => clamp(x, 0, 1)) as RGB;
}

/**
 * The mean radiance of the sky and the ground round a normal, weighted by how squarely each part
 * faces it: what a white surface facing that way reflects of the skylight (the irradiance over π).
 */
export function skylight(normal: Vec3, s: SkySettings, steps = 12): RGB {
  let [r, g, b, weight] = [0, 0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const el = Math.asin(-1 + (2 * (i + 0.5)) / steps) / RAD;
    for (let j = 0; j < steps * 2; j++) {
      const d = direction((360 * (j + 0.5)) / (steps * 2), el);
      const facing = d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2];
      if (facing <= 0) continue;
      const l = d[1] > 0 ? skyRadiance(d, s, SKYLIGHT_SATURATION) : s.ground;
      r += l[0] * facing;
      g += l[1] * facing;
      b += l[2] * facing;
      weight += facing;
    }
  }
  return [r / weight, g / weight, b / weight];
}

/** Everything the street look needs for a sun, a night and a weather. */
export function streetLighting(input: StreetInputs): StreetLighting {
  const night = clamp(input.night, 0, 1);
  const cloud = input.weather?.cloud ?? 0;
  const fog = input.weather?.fog ?? 0;
  const at = skySun(input.sun, night);
  const el = at.elevation;
  const thick = Math.max(cloud, fog);
  const air = { turbidity: TURBIDITY + 5 * thick, rayleigh: RAYLEIGH * (1 - 0.25 * thick), mie: MIE };

  // The sun's colour is the light that gets through the air at its height; less saturated than the
  // model's, which is a little too yellow at noon. Lower, it reddens and weakens.
  const through = extinction(Math.sin(Math.max(el, 1) * RAD), air);
  const top = Math.max(...through);
  const sunColour = through.map((v) => Math.pow(v / top, 0.6)) as RGB;
  const day = 1 - smoothstep(0.2, 0.5, night);
  const sunStrength = SUN_INTENSITY * Math.min(1, Math.pow(top / 0.94, 0.6)) * (1 - 0.85 * cloud) * (1 - 0.7 * fog) * day;
  const moonStrength = MOON_INTENSITY * (1 - 0.75 * cloud) * (1 - 0.7 * fog) * smoothstep(0.5, 0.85, night);
  const byNight = night >= 0.5;

  // An overcast sky is brighter with the sun higher; by night it is lit from below by the city.
  const dayGrey = 0.12 + 0.55 * Math.sin(clamp(el, 0, 90) * RAD);
  const grey = mix(dayGrey, 0.012, night);
  const overcast: RGB = [0.92 * grey, 0.96 * grey, grey];

  const twilight = smoothstep(6, -1, el) * smoothstep(-14, -4, el);
  const sky: SkySettings = {
    sun: direction(at.azimuth, el),
    ...air,
    mieG: MIE_G,
    cloud: input.weather ? cloud * 0.9 : 0,
    overcast,
    overcastAmount: 0.85 * smoothstep(0.45, 1, cloud),
    hazeAmount: 0.85 * fog,
    night,
    twilight,
    ground: [0, 0, 0],
  };
  // The ground, lit by the sun and the sky, as the walls and the sky see it.
  const fromSky = skylight([0, 1, 0], sky, 8);
  const sunOnGround = byNight ? (moonStrength * Math.sin(NIGHT.sunElevation * RAD)) / Math.PI : (sunStrength * Math.max(0, Math.sin(el * RAD))) / Math.PI;
  const lightColour = byNight ? MOON_COLOUR : sunColour;
  sky.ground = GROUND_ALBEDO.map((a, i) => a * (sunOnGround * lightColour[i]! + SKYLIGHT * fromSky[i]!)) as RGB;

  // The picture opens up as the light falls, as an eye or a camera does: for a low sun a little,
  // for the night a lot, and for a grey sky a touch.
  const lowSun = clamp(Math.pow(Math.sin(45 * RAD) / Math.sin(Math.max(el, 4) * RAD), 0.3), 1, LOW_SUN_OPENING);
  const exposureDay = EXPOSURE_DAY * lowSun * (1 + 0.3 * cloud);

  // What the windows show. A room by day takes the light that falls on the ground outside it.
  const daylight = (byNight ? 0 : sunOnGround) * 0.5 + luma(fromSky) * SKYLIGHT;
  const warm: RGB = [1, 0.96, 0.9];
  const windows: WindowLight = {
    glow: smoothstep(GLOW_FROM, GLOW_FULL, night),
    interior: warm.map((c) => c * INTERIOR * daylight) as RGB,
    blind: warm.map((c) => c * BLIND * daylight) as RGB,
    skyUp: skyRadiance([0, 1, 0], sky),
    skyLow: skyRadiance(direction(at.azimuth + 180, 6), sky),
    ground: sky.ground,
    city: CITY_GLOW.map((c) => c * night) as RGB,
  };

  return {
    sky,
    lightColour,
    lightIntensity: byNight ? moonStrength : sunStrength,
    skylight: SKYLIGHT,
    ambient: AMBIENT_NIGHT * night,
    exposure: mixLog(exposureDay, EXPOSURE_NIGHT, night),
    fogDensity: FOG_DENSITY * (1 + 0.4 * cloud) + FOG_THICK * fog,
    bloomThreshold: mixLog(BLOOM_THRESHOLD_DAY, BLOOM_THRESHOLD_NIGHT, night),
    bloomStrength: mix(BLOOM_STRENGTH_DAY, BLOOM_STRENGTH_NIGHT, night),
    stars: smoothstep(0.55, 0.95, night) * (1 - cloud) * (1 - fog),
    moon: smoothstep(0.35, 0.8, night) * (1 - 0.85 * cloud) * (1 - fog),
    windows,
    wet: clamp(input.weather?.wet ?? 0, 0, 1),
    groundGlow: GROUND_GLOW.map((c) => c * smoothstep(GLOW_FROM, GLOW_FULL, night) * (1 - 0.5 * fog)) as RGB,
  };
}

function luma(c: RGB): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
