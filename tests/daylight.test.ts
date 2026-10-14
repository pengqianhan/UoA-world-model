import { describe, expect, it } from "vitest";
import { nightAmount, sunAt } from "../src/shared/daylight.ts";

/** The highest the sun climbs on a day, sampled each minute, and where it stands then. */
function noon(date: string): { minutes: number; azimuth: number; elevation: number } {
  let best = { minutes: 0, azimuth: 0, elevation: -90 };
  for (let m = 0; m < 1440; m++) {
    const s = sunAt(date, m);
    if (s.elevation > best.elevation) best = { minutes: m, ...s };
  }
  return best;
}

describe("the sun over the City Campus", () => {
  it("climbs to 90° less the latitude, plus or minus the tilt of the earth, at the solstices", () => {
    // 90 - 36.85 + 23.44 in December, 90 - 36.85 - 23.44 in June.
    expect(noon("2026-12-21").elevation).toBeCloseTo(76.6, 0);
    expect(noon("2026-06-21").elevation).toBeCloseTo(29.7, 0);
    expect(noon("2026-03-20").elevation).toBeCloseTo(53.2, 0);
  });

  it("stands due north at its highest, near 13:20 in summer time and 12:20 in winter time", () => {
    const summer = noon("2026-12-21");
    expect(Math.min(summer.azimuth, 360 - summer.azimuth)).toBeLessThan(2);
    expect(summer.minutes).toBeGreaterThanOrEqual(13 * 60 + 15);
    expect(summer.minutes).toBeLessThanOrEqual(13 * 60 + 25);
    const winter = noon("2026-06-21");
    expect(Math.min(winter.azimuth, 360 - winter.azimuth)).toBeLessThan(2);
    expect(winter.minutes).toBeGreaterThanOrEqual(12 * 60 + 18);
    expect(winter.minutes).toBeLessThanOrEqual(12 * 60 + 28);
  });

  it("rises and sets at Auckland's published times, within a few minutes", () => {
    // Sunrise and sunset are when the sun's centre is 0.83° below the horizon.
    // Auckland, 2026-12-21: about 05:59 and 20:41 (NZDT). 2026-06-21: about 07:33 and 17:11 (NZST).
    for (const [date, m] of [
      ["2026-12-21", 5 * 60 + 59],
      ["2026-12-21", 20 * 60 + 41],
      ["2026-06-21", 7 * 60 + 33],
      ["2026-06-21", 17 * 60 + 11],
    ] as const) {
      expect(sunAt(date, m).elevation, `${date} ${m}`).toBeGreaterThan(-0.83 - 1);
      expect(sunAt(date, m).elevation, `${date} ${m}`).toBeLessThan(-0.83 + 1);
    }
  });

  it("rises in the east and sets in the west, further south in summer", () => {
    const summerMorning = sunAt("2026-12-21", 7 * 60).azimuth;
    const winterMorning = sunAt("2026-06-21", 8 * 60 + 30).azimuth;
    expect(summerMorning).toBeGreaterThan(90);
    expect(summerMorning).toBeLessThan(130);
    expect(winterMorning).toBeGreaterThan(45);
    expect(winterMorning).toBeLessThan(75);
    expect(sunAt("2026-12-21", 19 * 60).azimuth).toBeGreaterThan(230);
    expect(sunAt("2026-12-21", 19 * 60).azimuth).toBeLessThan(270);
  });

  it("keeps step with the clock across a daylight-saving change", () => {
    // 2026-09-27: clocks go forward at 02:00, so solar noon moves from about 12:2x to 13:2x.
    expect(Math.abs(noon("2026-09-26").minutes - (noon("2026-09-28").minutes - 60))).toBeLessThan(3);
  });
});

describe("night", () => {
  it("is full at midnight, none at noon, and half done at sunrise and sunset", () => {
    expect(nightAmount("2026-06-21", 0)).toBe(1);
    expect(nightAmount("2026-06-21", 12 * 60 + 20)).toBe(0);
    expect(nightAmount("2026-12-21", 13 * 60 + 20)).toBe(0);
    expect(nightAmount("2026-12-21", 5 * 60 + 59)).toBeGreaterThan(0.35);
    expect(nightAmount("2026-12-21", 5 * 60 + 59)).toBeLessThan(0.65);
    expect(nightAmount("2026-06-21", 17 * 60 + 11)).toBeGreaterThan(0.35);
    expect(nightAmount("2026-06-21", 17 * 60 + 11)).toBeLessThan(0.65);
  });

  it("comes later on a summer evening than on a winter one", () => {
    expect(nightAmount("2026-12-21", 19 * 60 + 30)).toBe(0);
    expect(nightAmount("2026-06-21", 19 * 60 + 30)).toBe(1);
  });
});
