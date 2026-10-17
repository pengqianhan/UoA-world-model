import { describe, expect, it } from "vitest";
import {
  BLOOM_THRESHOLD_DAY,
  FOG_DENSITY,
  SKY_GAIN,
  acesFilmic,
  direction,
  skyRadiance,
  skySun,
  skylight,
  streetLighting,
  type RGB,
} from "../src/scene/street/light.ts";
import { isSoftwareRenderer } from "../src/scene/street/tier.ts";
import { DAY } from "../src/scene/palette.ts";

const luma = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Share of light let through haze of a FogExp2 density at a distance, as three draws it. */
const seen = (density: number, metres: number) => Math.exp(-((density * metres) ** 2));
const afternoon = { sun: { azimuth: 325, elevation: 48 }, night: 0 };

describe("the street look's sky", () => {
  it("repeats three's Preetham sky (Sky.js r186), scaled to the scene's light", () => {
    // Worked out apart from this port, from the shader's sums: turbidity 2, Rayleigh 1, the sun at 60°.
    const l = streetLighting(afternoon);
    const sky = { ...l.sky, sun: direction(0, 60), turbidity: 2, rayleigh: 1, mie: 0.005, mieG: 0.8 };
    const c = skyRadiance(direction(180, 85), sky);
    for (const [k, v] of [0.215, 0.681, 1.962].entries()) expect(c[k]! / SKY_GAIN).toBeCloseTo(v, 2);
  });

  it("is blue overhead and pale towards the horizon by day", () => {
    const { sky } = streetLighting(afternoon);
    const zenith = skyRadiance([0, 1, 0], sky);
    const horizon = skyRadiance(direction(145, 2), sky);
    expect(zenith[2] / zenith[0]).toBeGreaterThan(4);
    expect(horizon[2] / horizon[0]).toBeLessThan(zenith[2] / zenith[0]);
    expect(luma(horizon)).toBeGreaterThan(luma(zenith));
  });

  it("is dark but not black by night, and darker than dusk", () => {
    const night = streetLighting({ sun: { azimuth: 260, elevation: -20 }, night: 1 });
    const dusk = streetLighting({ sun: { azimuth: 260, elevation: -3 }, night: 0.68 });
    const day = streetLighting(afternoon);
    const z = (l: typeof day) => luma(skyRadiance([0, 1, 0], l.sky));
    expect(z(night)).toBeGreaterThan(0);
    expect(z(night)).toBeLessThan(z(day) / 20);
    // The glow of dusk lies low over where the sun went down.
    const low = (l: typeof day, az: number) => luma(skyRadiance(direction(az, 3), l.sky));
    expect(low(dusk, 260)).toBeGreaterThan(low(dusk, 80) * 2);
    expect(low(dusk, 260)).toBeGreaterThan(low(night, 260));
  });

  it("draws the sun where it stands, the palette's when daylight is forced at night, and none by day when night is forced", () => {
    expect(skySun({ azimuth: 100, elevation: 12 }, 0.2)).toEqual({ azimuth: 100, elevation: 12 });
    expect(skySun(undefined, 0)).toEqual({ azimuth: DAY.sunAzimuth, elevation: DAY.sunElevation });
    expect(skySun({ azimuth: 330, elevation: 40 }, 1).elevation).toBeLessThan(-5);
  });

  it("greys under cloud, has no clouds of its own in Preview, and hazes in fog", () => {
    const clear = streetLighting(afternoon);
    const grey = streetLighting({ ...afternoon, weather: { cloud: 1, wet: 1, fog: 0 } });
    const foggy = streetLighting({ ...afternoon, weather: { cloud: 0.9, wet: 0, fog: 1 } });
    expect(clear.sky.cloud).toBe(0);
    const spread = (c: RGB) => Math.max(...c) / Math.min(...c);
    expect(spread(skyRadiance([0, 1, 0], grey.sky))).toBeLessThan(spread(skyRadiance([0, 1, 0], clear.sky)) / 3);
    expect(grey.lightIntensity).toBeLessThan(clear.lightIntensity / 3);
    expect(foggy.fogDensity).toBeGreaterThan(clear.fogDensity * 3);
  });
});

describe("the street look's light", () => {
  it("is led by the sun on a clear day, with shade a quarter or so as bright, and warmer as the sun sinks", () => {
    const noon = streetLighting(afternoon);
    const sunOnGround = (noon.lightIntensity * Math.sin((48 * Math.PI) / 180)) / Math.PI;
    const shade = luma(skylight([0, 1, 0], noon.sky)) * noon.skylight;
    expect(sunOnGround / shade).toBeGreaterThan(2.5);
    expect(sunOnGround / shade).toBeLessThan(6);
    const low = streetLighting({ sun: { azimuth: 280, elevation: 6 }, night: 0 });
    expect(low.lightColour[2]).toBeLessThan(noon.lightColour[2]);
    expect(noon.lightColour[2]).toBeGreaterThan(0.75);
  });

  it("by night is the moon's, weak and cool, opens the exposure, and shows the stars and the moon", () => {
    const day = streetLighting(afternoon);
    const night = streetLighting({ sun: { azimuth: 260, elevation: -30 }, night: 1 });
    expect(night.lightIntensity).toBeLessThan(day.lightIntensity / 5);
    expect(night.lightColour[2]).toBeGreaterThan(night.lightColour[0]);
    expect(night.exposure).toBeGreaterThan(day.exposure * 1.4);
    expect(night.stars).toBe(1);
    expect(night.moon).toBe(1);
    expect(day.stars).toBe(0);
    expect(day.moon).toBe(0);
  });

  it("blooms only what is brighter than a sunlit white wall by day, and lit windows by night", () => {
    const day = streetLighting(afternoon);
    const wall = (day.lightIntensity * Math.cos((48 * Math.PI) / 180)) / Math.PI + luma(skylight([1, 0, 0], day.sky)) * day.skylight;
    expect(day.bloomThreshold).toBeCloseTo(BLOOM_THRESHOLD_DAY, 6);
    expect(day.bloomThreshold).toBeGreaterThan(wall * 3);
    // A window glows at 0.7 of its warm emissive colour after dark (CampusScene.restyle).
    const window = 0.7 * luma([1, 0.77, 0.43]);
    expect(streetLighting({ night: 1 }).bloomThreshold).toBeLessThan(window);
  });

  it("hazes the distance enough to hide the map's edge, and no more by day", () => {
    const { fogDensity } = streetLighting(afternoon);
    expect(fogDensity).toBe(FOG_DENSITY);
    expect(seen(fogDensity, 300)).toBeGreaterThan(0.85);
    expect(seen(fogDensity, 800)).toBeGreaterThan(0.4);
    expect(seen(fogDensity, 2000)).toBeLessThan(0.02);
  });
});

describe("tone mapping in the walker views", () => {
  it("is three's ACES filmic: a mid grey stays mid grey and a white wall in sun stops short of white", () => {
    expect(acesFilmic([0.18, 0.18, 0.18], 1)[1]).toBeCloseTo(0.213, 2);
    expect(acesFilmic([1, 1, 1], 1)[1]).toBeCloseTo(0.763, 2);
    expect(acesFilmic([1, 1, 1], 1)[1]).toBeLessThan(acesFilmic([2, 2, 2], 1)[1]);
  });
});

describe("software renderers", () => {
  it("are told from graphics cards by the name they give", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA Quadro P600 (0x00001CB2) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isSoftwareRenderer("Apple M2")).toBe(false);
  });
});
