import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { has } from "../src/app/i18n.ts";
import { INSPIRED_BY, WORLDS } from "../src/app/links.ts";
import { greatCircleKm } from "../src/shared/geo.ts";
import type { CampusData } from "../src/shared/types.ts";

describe("great-circle distance", () => {
  it("is zero between a point and itself", () => {
    expect(greatCircleKm({ lat: -36.85, lon: 174.77 }, { lat: -36.85, lon: 174.77 })).toBe(0);
  });
  it("is a quarter of a meridian from the equator to the pole", () => {
    expect(greatCircleKm({ lat: 0, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo((Math.PI * 6371.0088) / 2, 6);
  });
  it("crosses the antimeridian the short way", () => {
    expect(greatCircleKm({ lat: 0, lon: 179 }, { lat: 0, lon: -179 })).toBeCloseTo(greatCircleKm({ lat: 0, lon: 0 }, { lat: 0, lon: 2 }), 6);
  });
});

describe("other worlds", () => {
  it("each has a secure address, a name and a place", () => {
    expect(WORLDS.length).toBeGreaterThan(0);
    for (const w of WORLDS) {
      expect(w.url).toMatch(/^https:\/\//);
      expect(has(`travel.worlds.${w.id}.name`), w.id).toBe(true);
      expect(has(`travel.worlds.${w.id}.place`), w.id).toBe(true);
    }
  });
  it("the inspiration is the Tsinghua World Model, at the address its campus view has", () => {
    expect(INSPIRED_BY.url).toBe("https://tsinghua-world-model.pages.dev/?campus=1&classMode=live");
    expect(WORLDS).toContain(INSPIRED_BY);
  });
  it("Beijing is a little over ten thousand kilometres from the City Campus", () => {
    const campus = JSON.parse(fs.readFileSync("public/data/campus.json", "utf8")) as CampusData;
    const km = greatCircleKm(campus.origin, INSPIRED_BY);
    expect(km).toBeGreaterThan(10_380);
    expect(km).toBeLessThan(10_460);
  });
});
