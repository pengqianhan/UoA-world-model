import { describe, expect, it } from "vitest";
import {
  CROWN_HALF_HEIGHT,
  CROWN_HALF_WIDTH,
  CROWN_MIDDLE,
  LEAF_CUTOFF,
  LEAF_REACH,
  MAX_CARDS,
  MIN_CARDS,
  cardCount,
  crownCards,
  leafAtlas,
  leafState,
  leafVariant,
  treeSeed,
} from "../src/scene/street/crowns.ts";

describe("street trees by rule", () => {
  it("lays the same cards on a tree every time, from where it stands", () => {
    const seed = treeSeed(-190.3, 100.7);
    expect(treeSeed(-190.3, 100.7)).toBe(seed);
    expect(treeSeed(-190.4, 100.7)).not.toBe(seed);
    expect(crownCards(seed, 8, 10)).toEqual(crownCards(seed, 8, 10));
    expect(crownCards(seed, 8, 10)).not.toEqual(crownCards(treeSeed(12, 34), 8, 10));
  });

  it("gives a larger tree more cards, ten to sixteen, as the map's sizes run", () => {
    expect(cardCount(5.5)).toBe(MIN_CARDS);
    expect(cardCount(10.5)).toBe(MAX_CARDS);
    expect(MIN_CARDS).toBe(10);
    expect(MAX_CARDS).toBe(16);
    for (const width of [5.5, 7, 8.5, 10.5]) {
      const cards = crownCards(treeSeed(width, 1), width, width * 1.2);
      expect(cards.length).toBe(cardCount(width));
    }
  });

  it("keeps the cards in the room the map's crown takes, closed from below and above", () => {
    for (let k = 0; k < 200; k++) {
      const seed = treeSeed(k * 7.3, -k * 3.1);
      const width = 5.5 + (k % 11) * 0.5;
      const height = width * (0.95 + (k % 7) * 0.1);
      const cards = crownCards(seed, width, height);
      for (const c of cards) {
        // Inside the map's gem, an ellipsoid round the crown's middle.
        const dx = c.at[0] / (CROWN_HALF_WIDTH * width);
        const dy = (c.at[1] - CROWN_MIDDLE * height) / (CROWN_HALF_HEIGHT * height);
        const dz = c.at[2] / (CROWN_HALF_WIDTH * width);
        expect(Math.hypot(dx, dy, dz)).toBeLessThan(1);
        expect(Math.hypot(...c.facing)).toBeCloseTo(1, 6);
        expect(c.size).toBeGreaterThan(0.25 * width);
        expect(c.size).toBeLessThan(0.75 * width);
        expect(c.tint).toBeGreaterThanOrEqual(0.9);
        expect(c.tint).toBeLessThanOrEqual(1.1);
      }
      // The first hangs under the crown, facing down; the fifth stands on top, facing up.
      expect(cards[0]!.facing[1]).toBeLessThan(-0.5);
      expect(cards[4]!.facing[1]).toBeGreaterThan(0.5);
      // The crown's lowest leaves are above head height on the smallest tree.
      expect(Math.min(...cards.map((c) => c.at[1]))).toBeGreaterThan(0.2 * height);
    }
  });

  it("gives about three trees in five broad leaves and the rest small ones", () => {
    let broad = 0;
    const n = 2000;
    for (let k = 0; k < n; k++) if (leafVariant(treeSeed(k * 1.7, k * -2.9)) === 0) broad++;
    expect(broad / n).toBeGreaterThan(0.55);
    expect(broad / n).toBeLessThan(0.69);
    expect(leafVariant(treeSeed(3, 4))).toBe(leafVariant(treeSeed(3, 4)));
  });

  it("turns deciduous trees through a southern year and keeps the rest evergreen", () => {
    const year = Array.from({ length: 12 }, (_, k) => leafState(k + 1, true));
    expect(year).toEqual(["summer", "summer", "summer", "autumn", "autumn", "bare", "bare", "bare", "spring", "spring", "summer", "summer"]);
    for (let m = 1; m <= 12; m++) expect(leafState(m, false)).toBe("evergreen");
    // Before the month is known, a deciduous tree is in leaf.
    expect(leafState(0, true)).toBe("summer");
  });

  it("draws clusters of leaves that end in clear and stay as full far off", () => {
    const n = 64;
    const atlas = leafAtlas(n);
    expect(atlas.width).toBe(2 * n);
    expect(atlas.height).toBe(n);
    // Every level down to one texel.
    expect(atlas.levels.length).toBe(Math.log2(2 * n) + 1);
    expect(atlas.levels.at(-1)!.length).toBe(4);
    const share = (level: Uint8Array) => {
      let on = 0;
      for (let i = 3; i < level.length; i += 4) if (level[i]! >= LEAF_CUTOFF * 255) on++;
      return on / (level.length / 4);
    };
    const full = share(atlas.levels[0]!);
    expect(full).toBeGreaterThan(0.25);
    expect(full).toBeLessThan(0.75);
    // The mipmaps keep about the same share of texels drawn.
    for (const level of atlas.levels.slice(1, 4)) expect(Math.abs(share(level) - full)).toBeLessThan(0.08);
    // Nothing is drawn outside the circle the octagonal cards are cut to.
    const top = atlas.levels[0]!;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < 2 * n; x++) {
        const cx = (x % n) + 0.5 - n / 2;
        const cy = y + 0.5 - n / 2;
        if (Math.hypot(cx, cy) > LEAF_REACH * n + 2) expect(top[(y * 2 * n + x) * 4 + 3]).toBe(0);
      }
    }
  });
});
