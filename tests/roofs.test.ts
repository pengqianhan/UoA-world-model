import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../src/scene/geometry.ts";
import { boundingRectangle, encodeRing, type Ring } from "../src/shared/geo.ts";
import type { ContextData, ContextRoof } from "../src/shared/types.ts";

/** A rectangle of the given size centred on the origin, turned anticlockwise by `angle` radians. */
function rectangle(length: number, width: number, angle = 0): Ring {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const x = (u! * length) / 2;
    const y = (v! * width) / 2;
    return [x * cos - y * sin, x * sin + y * cos];
  });
}

/** Builds one roof and returns its vertices as [east, height, north] and its normals. */
function build(ring: Ring, roof: ContextRoof, y = 10) {
  const mb = new MeshBuilder();
  mb.roof(encodeRing(ring), y, roof);
  const points: [number, number, number][] = [];
  const normals: [number, number, number][] = [];
  for (let i = 0; i < mb.positions.length; i += 3) {
    points.push([mb.positions[i]!, mb.positions[i + 1]!, -mb.positions[i + 2]!]);
    normals.push([mb.normals[i]!, mb.normals[i + 1]!, mb.normals[i + 2]!]);
  }
  return { points, normals, top: points.filter((p) => Math.abs(p[1] - Math.max(...points.map((q) => q[1]))) < 1e-6) };
}

describe("bounding rectangle", () => {
  it("finds the long side of a turned rectangle", () => {
    const box = boundingRectangle(rectangle(20, 8, 0.6));
    expect(box.length).toBeCloseTo(20, 1);
    expect(box.width).toBeCloseTo(8, 1);
    expect(box.centre[0]).toBeCloseTo(0, 6);
    expect(box.centre[1]).toBeCloseTo(0, 6);
    // The long side points along the turn, either way round.
    expect(Math.abs(Math.cos(box.angle - 0.6))).toBeCloseTo(1, 6);
  });
});

describe("roof shapes", () => {
  it("gabled: a ridge the full length of the building, over its middle", () => {
    const { points, normals, top } = build(rectangle(20, 8), { k: "gabled", h: 3 });
    expect(Math.max(...points.map((p) => p[1]))).toBeCloseTo(13, 6);
    expect(Math.min(...points.map((p) => p[1]))).toBeCloseTo(10, 6);
    expect(Math.min(...top.map((p) => p[0]))).toBeCloseTo(-10, 6);
    expect(Math.max(...top.map((p) => p[0]))).toBeCloseTo(10, 6);
    for (const p of top) expect(p[2]).toBeCloseTo(0, 6);
    // Two slopes and two upright gable ends; nothing faces down.
    for (const n of normals) expect(n[1]).toBeGreaterThanOrEqual(-1e-9);
    expect(normals.some((n) => Math.abs(n[1]) < 1e-9 && Math.abs(n[0]) > 0.99)).toBe(true);
  });
  it("gabled across: the ridge runs along the short side instead", () => {
    const { top } = build(rectangle(20, 8), { k: "gabled", h: 3, across: true });
    for (const p of top) expect(p[0]).toBeCloseTo(0, 6);
    expect(Math.max(...top.map((p) => p[2]))).toBeCloseTo(4, 6);
  });
  it("hipped: the ridge stops short of both ends, and every face leans", () => {
    const { normals, top } = build(rectangle(20, 8), { k: "hipped", h: 3 });
    expect(Math.max(...top.map((p) => p[0]))).toBeCloseTo(6, 6);
    expect(Math.min(...top.map((p) => p[0]))).toBeCloseTo(-6, 6);
    for (const n of normals) expect(n[1]).toBeGreaterThan(0.1);
  });
  it("pyramidal: one point over the centre", () => {
    const { top } = build(rectangle(6, 6, 0.4), { k: "pyramidal", h: 9 });
    for (const p of top) {
      expect(p[0]).toBeCloseTo(0, 6);
      expect(p[2]).toBeCloseTo(0, 6);
    }
  });
  it("dome: rises in steps to one point, steeper at the eaves than at the top", () => {
    const { points } = build(rectangle(10, 10), { k: "dome", h: 5 });
    const heights = [...new Set(points.map((p) => p[1].toFixed(4)))].map(Number).sort((a, z) => a - z);
    expect(heights.length).toBe(6);
    expect(heights[1]! - heights[0]!).toBeGreaterThan(heights[5]! - heights[4]!);
    expect(heights[5]).toBeCloseTo(15, 6);
  });
  it("skillion: one plane, lowest on the side it falls towards", () => {
    // Bearing 90 is east.
    const { points } = build(rectangle(10, 6), { k: "skillion", h: 2, bearing: 90 });
    const east = points.filter((p) => p[0] > 4.9);
    const west = points.filter((p) => p[0] < -4.9);
    expect(Math.max(...east.map((p) => p[1]))).toBeCloseTo(10, 6);
    expect(Math.max(...west.map((p) => p[1]))).toBeCloseTo(12, 6);
  });
});

describe("published surroundings", () => {
  const ctx = JSON.parse(fs.readFileSync("public/data/context.json", "utf8")) as ContextData;

  it("give every building and part walls with a height, and every roof a rise", () => {
    for (const b of ctx.buildings) {
      expect(b.h).toBeGreaterThan(b.b ?? 0);
      if (b.roof) expect(b.roof.h).toBeGreaterThan(0);
    }
  });
  it("carry parts that sit on top of others, and shaped roofs", () => {
    expect(ctx.buildings.filter((b) => b.b).length).toBeGreaterThan(30);
    const shapes = new Set(ctx.buildings.map((b) => b.roof?.k));
    for (const k of ["gabled", "hipped", "pyramidal", "dome", "round", "skillion"] as const) expect(shapes.has(k), k).toBe(true);
    expect(ctx.buildings.filter((b) => b.roof).length).toBeGreaterThan(150);
  });
  it("draw the one tower that is mapped in parts at its full height, and nothing taller", () => {
    const tops = ctx.buildings.map((b) => b.h + (b.roof?.h ?? 0));
    // The Sky Tower is 328 m.
    expect(Math.max(...tops)).toBeGreaterThan(300);
    expect(Math.max(...tops)).toBeLessThanOrEqual(330);
    // A building that is one plain outline is never drawn as a slab that high.
    const plain = ctx.buildings.filter((b) => !b.b && !b.roof);
    expect(plain.filter((b) => b.h > 200).length).toBe(0);
  });
});
