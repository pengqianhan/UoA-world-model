import { describe, expect, it } from "vitest";
import { overlap, type Ring } from "../src/shared/geo.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

describe("how much two shapes are the same shape", () => {
  it("is 1 for the same shape, whichever way its ring runs", () => {
    const a = [[rect(0, 0, 40, 20)]];
    expect(overlap(a, a)).toBe(1);
    expect(overlap(a, [[[...rect(0, 0, 40, 20)].reverse()]])).toBe(1);
  });
  it("is 0 for shapes that are apart", () => {
    expect(overlap([[rect(0, 0, 10, 10)]], [[rect(50, 50, 60, 60)]])).toBe(0);
  });
  it("is the shared area over the area either covers", () => {
    // Two 20 by 20 squares, one shifted by half its width: 200 shared of 600 covered.
    expect(overlap([[rect(0, 0, 20, 20)]], [[rect(10, 0, 30, 20)]])).toBeCloseTo(1 / 3, 2);
    // A tower on a podium four times its area.
    expect(overlap([[rect(0, 0, 40, 40)]], [[rect(10, 10, 30, 30)]])).toBeCloseTo(0.25, 2);
  });
  it("counts a courtyard as not covered", () => {
    const solid = [[rect(0, 0, 40, 40)]];
    const withCourt = [[rect(0, 0, 40, 40), rect(10, 10, 30, 30)]];
    expect(overlap(solid, withCourt)).toBeCloseTo(0.75, 2);
    expect(overlap(withCourt, withCourt)).toBe(1);
  });
  it("adds up the polygons of a shape in several pieces", () => {
    const wings = [[rect(0, 0, 10, 20)], [rect(30, 0, 40, 20)]];
    expect(overlap(wings, [[rect(0, 0, 40, 20)]])).toBeCloseTo(0.5, 2);
  });
  it("sees a setback of a metre and a half along one side of a 60 by 20 m floor as a real change", () => {
    expect(overlap([[rect(0, 0, 60, 20)]], [[rect(0, 0, 60, 18.5)]])).toBeLessThan(0.95);
    // A notch of a few square metres is not.
    expect(overlap([[rect(0, 0, 60, 20)]], [[rect(0, 0, 60, 20), rect(0, 0, 3, 3)]])).toBeGreaterThan(0.99);
  });
});
