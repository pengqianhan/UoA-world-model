import { describe, expect, it } from "vitest";
import { OUTFITS, parseOutfit } from "../src/shared/outfit.ts";

describe("an outfit, read from untrusted data", () => {
  it("takes a preset by name", () => {
    expect(parseOutfit("Halloween").outfit).toEqual(OUTFITS.halloween);
    expect(parseOutfit("tuxedo").errors[0]).toMatch(/No outfit called "tuxedo"/);
  });

  it("takes changes on top of a preset", () => {
    const { outfit, errors } = parseOutfit({ base: "explorer", top: "#123ABC", backpack: null, hat: "beanie" });
    expect(errors).toEqual([]);
    expect(outfit).toMatchObject({ name: "Explorer", top: "#123abc", backpack: null, hat: "beanie", hatColour: OUTFITS.explorer!.hatColour });
  });

  it("takes sleeves short or long", () => {
    expect(parseOutfit({ base: "student", sleeves: "long" }).outfit!.sleeves).toBe("long");
    expect(parseOutfit("raincoat").outfit!.sleeves).toBe("long");
  });

  it("names an outfit made from scratch Custom unless it is given a name", () => {
    expect(parseOutfit({ top: "#000000" }).outfit!.name).toBe("Custom");
    expect(parseOutfit({ top: "#000000", name: "Night shift" }).outfit!.name).toBe("Night shift");
  });

  it("refuses unknown keys, colours in any other form, and choices off the list", () => {
    const { outfit, errors } = parseOutfit({ top: "red", script: "alert(1)", hat: "crown", cape: "url(x)", sleeves: "rolled", name: "x".repeat(41) });
    expect(outfit).toBeUndefined();
    expect(errors).toEqual(
      expect.arrayContaining([
        'Unknown key "script".',
        "top: a colour as #rrggbb.",
        "hat: one of none, cap, beanie, witch, pumpkin.",
        "cape: a colour as #rrggbb, or null.",
        "sleeves: one of short, long.",
        "name: up to 40 characters.",
      ]),
    );
  });

  it("uses no colour twice for skin across the presets, so the walkers look like different people", () => {
    const skins = Object.values(OUTFITS).map((o) => o.skin);
    expect(new Set(skins).size).toBe(skins.length);
  });
});
