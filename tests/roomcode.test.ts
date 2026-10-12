import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { codeKey, findRoomCode, floorCandidates, inferFloor, matchFloor, parseRoomCode, roomKey } from "../src/shared/roomcode.ts";
import type { CampusData } from "../src/shared/types.ts";

const campus = JSON.parse(fs.readFileSync("public/data/campus.json", "utf8")) as CampusData;
const known = new Set(campus.buildings.map((b) => b.id));

describe("parseRoomCode", () => {
  it("parses the canonical form", () => {
    expect(parseRoomCode("303-G23")).toEqual({ building: "303", room: "G23", code: "303-G23" });
    expect(parseRoomCode("260-098")?.code).toBe("260-098");
    expect(parseRoomCode("105S-039")?.building).toBe("105S");
  });

  it("tolerates case, spaces, dots and typographic dashes", () => {
    expect(parseRoomCode(" 303 g23 ")?.code).toBe("303-G23");
    expect(parseRoomCode("303.G23")?.code).toBe("303-G23");
    expect(parseRoomCode("303–G23")?.code).toBe("303-G23");
    expect(parseRoomCode("405 - 460")?.code).toBe("405-460");
  });

  it("splits unseparated input using the known buildings", () => {
    expect(parseRoomCode("303G23", known)?.code).toBe("303-G23");
    expect(parseRoomCode("421W301", known)?.code).toBe("421W-301");
    expect(parseRoomCode("303S279", known)?.code).toBe("303S-279");
    expect(parseRoomCode("109B10", known)?.code).toBe("109-B10");
    expect(parseRoomCode("260098", known)?.code).toBe("260-098");
  });

  it("rejects things that are not room codes", () => {
    expect(parseRoomCode("COMPSCI 101")).toBeNull();
    expect(parseRoomCode("General Library")).toBeNull();
    expect(parseRoomCode("")).toBeNull();
    expect(parseRoomCode("303")).toBeNull();
  });
});

describe("findRoomCode", () => {
  it("finds a code inside a longer location string", () => {
    expect(findRoomCode("City Campus, 303-G23 (Lecture Theatre)", known)?.code).toBe("303-G23");
    expect(findRoomCode("Room 260-098", known)?.code).toBe("260-098");
  });
  it("returns null when there is no code", () => {
    expect(findRoomCode("Online", known)).toBeNull();
    expect(findRoomCode("To be advised", known)).toBeNull();
  });
});

describe("floor inference", () => {
  it("lists candidates from the room number", () => {
    expect(floorCandidates("G23")).toEqual(["G"]);
    expect(floorCandidates("B11")).toEqual(["B"]);
    expect(floorCandidates("423")).toEqual(["4"]);
    expect(floorCandidates("098")).toEqual(["0"]);
    expect(floorCandidates("39")).toEqual(["0"]);
    expect(floorCandidates("1012")).toEqual(["10", "1"]);
  });

  it("treats G and 0, and B and B1, as the same level", () => {
    const floors = [
      { i: -10, name: "B1" },
      { i: 0, name: "0" },
      { i: 10, name: "1" },
    ];
    expect(matchFloor(floors, "G")?.i).toBe(0);
    expect(matchFloor(floors, "B")?.i).toBe(-10);
    expect(matchFloor(floors, "7")).toBeNull();
  });

  it("agrees with the campus map for the well-known theatres", () => {
    for (const code of ["303-G23", "260-098", "109-B10", "405-460", "401-439", "206-220"]) {
      const room = campus.rooms.find((r) => r.code === code);
      expect(room, code).toBeDefined();
      const building = campus.buildings.find((b) => b.id === room!.b)!;
      expect(inferFloor(building.floors, code.split("-")[1]!)?.i, code).toBe(room!.f);
    }
  });

  it("agrees with the campus map for most published rooms", () => {
    let agree = 0;
    for (const r of campus.rooms) {
      const building = campus.buildings.find((b) => b.id === r.b)!;
      if (inferFloor(building.floors, r.code.slice(r.b.length + 1))?.i === r.f) agree++;
    }
    // The rule is only a fallback; this guards against it silently getting worse.
    expect(agree / campus.rooms.length).toBeGreaterThan(0.85);
  });
});

describe("zero-padding-insensitive keys", () => {
  it("ignores leading zeros in the numeric part", () => {
    expect(roomKey("G010")).toBe("G10");
    expect(roomKey("098")).toBe("98");
    expect(roomKey("000")).toBe("0");
    expect(roomKey("401A")).toBe("401A");
    expect(codeKey("114-G010")).toBe(codeKey("114-g10"));
    expect(codeKey("260-098")).not.toBe(codeKey("260-980"));
  });
});
