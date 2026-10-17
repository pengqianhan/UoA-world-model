import { describe, expect, it } from "vitest";
import { bearing, compass, describeBuilding, look, relative, towardsAhead } from "../src/shared/walkerLook.ts";

describe("what a walker sees", () => {
  it("names bearings by the compass, clockwise from north", () => {
    expect(bearing([0, 0], [0, 10])).toBe(0);
    expect(bearing([0, 0], [10, 0])).toBe(90);
    expect(bearing([0, 0], [0, -10])).toBe(180);
    expect(bearing([0, 0], [-10, 0])).toBe(270);
    expect(compass(44)).toBe("north-east");
    expect(compass(359)).toBe("north");
    expect(compass(-90)).toBe("west");
  });

  it("says where a bearing lies for someone facing a way", () => {
    expect(relative(0, 10)).toBe("ahead");
    expect(relative(0, 90)).toBe("to the right");
    expect(relative(90, 0)).toBe("to the left");
    expect(relative(0, 180)).toBe("behind");
    expect(relative(350, 40)).toBe("ahead to the right");
    expect(relative(10, 230)).toBe("behind to the left");
  });

  it("brings a look round towards straight ahead the shorter way, and stops there", () => {
    expect(towardsAhead(90, 0.5)).toBe(45);
    // 350° is 10° to the left: it comes back from the left, not the long way round by the right.
    expect(towardsAhead(350, 0.5)).toBe(355);
    expect(towardsAhead(270, 0.1)).toBeCloseTo(351, 6);
    expect(towardsAhead(180, 0.5)).toBe(270);
    expect(towardsAhead(-30, 1)).toBe(330);
    expect(towardsAhead(40, 1)).toBe(40);
    // Close enough is straight ahead, so the view settles instead of creeping for ever.
    expect(towardsAhead(0.08, 0.5)).toBe(0);
    expect(towardsAhead(359.95, 0.9)).toBe(0);
    expect(towardsAhead(0, 0.5)).toBe(0);
  });

  it("lists the nearest buildings first, within range, and what is ahead", () => {
    const seen = look({
      at: [0, 0],
      heading: 90,
      buildings: [
        { id: "B", name: "Far Hall", distance: 300.4, centre: [0, 310], learningSpaces: 0, floors: 2 },
        { id: "A", name: "General Library", distance: 12.2, centre: [20, 0], learningSpaces: 8, floors: 11 },
        { id: "C", name: "Out of range", distance: 900, centre: [-900, 0], learningSpaces: 1, floors: 1 },
      ],
      ahead: { id: "A", distance: 12.2 },
    });
    expect(seen.facing).toEqual({ bearing: 90, compass: "east" });
    expect(seen.nearby.map((b) => b.id)).toEqual(["A", "B"]);
    expect(seen.nearby[0]).toMatchObject({ distance: 12, side: "ahead", compass: "east", learningSpaces: 8 });
    expect(seen.nearby[1]).toMatchObject({ side: "to the left", compass: "north" });
    expect(seen.ahead).toEqual({ id: "A", name: "General Library", distance: 12 });
    expect(describeBuilding(seen.nearby[0]!)).toBe("A General Library, 12 m ahead (east)");
  });
});
