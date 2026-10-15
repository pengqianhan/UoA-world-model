import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { groundLevel } from "../src/shared/massing.ts";
import type { CampusData } from "../src/shared/types.ts";

const campus = JSON.parse(fs.readFileSync("public/data/campus.json", "utf8")) as CampusData;
const building = (id: string) => campus.buildings.find((b) => b.id === id)!;

describe("the level a building is entered at from the street", () => {
  it("is floor 0 where there is one, above the floors under the ground", () => {
    expect(groundLevel(building("310"))).toBe(0);
    expect(groundLevel(building("331"))).toBe(0);
  });
  it("is the lowest floor above index 0 where there is no floor 0, and index 0 under a building wholly below ground", () => {
    expect(groundLevel(building("6WC"))).toBe(10);
    expect(groundLevel(building("595"))).toBe(0);
    expect(building("595").floors.every((f) => f.i < 0)).toBe(true);
  });
});
