// The grain of the walls and roofs in the walker views: plaster, brick, concrete, stone, glass,
// weatherboards, a flat roof and corrugated steel, each a small tile that repeats without a seam.
// They are drawn here by rule, from noise and from the sizes of bricks, blocks and boards, when
// the first walker view opens: there are no pictures to fetch. facade.ts lays them on the walls.
//
// Each layer packs four things per texel: the tilt of the surface across and up (red, green; the
// shader works out the third part, so that a far wall, whose tilts average out, comes out flat),
// the joints (blue: mortar, the gaps between blocks, the grooves between boards), and a tone
// (alpha) the wall's colour is lightened or darkened by.

/** Layers, in the order they are packed. Each of rules.ts STYLES names the layer its walls take. */
export const LAYER = { plaster: 0, brick: 1, concrete: 2, stone: 3, panel: 4, boards: 5, roof: 6, sheet: 7 } as const;
export const LAYERS = 8;

/** Metres one repeat of each layer covers, across and up. */
export const LAYER_TILE: readonly [number, number][] = [
  [1.2, 1.2],
  [0.9, 0.9],
  [1.6, 1.6],
  [1.8, 1.8],
  [1.5, 1.5],
  [0.9, 0.9],
  [2, 2],
  [0.762, 0.762],
];

/** One layer before packing: heights in metres, joints 0-1 and tone 0-1, row 0 at the bottom. */
export interface Surface {
  height: Float32Array;
  joint: Float32Array;
  tone: Float32Array;
}

/** Deterministic pseudo-random numbers, so the grain is the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Value noise that repeats over the tile: `cells` lattice cells across and `rows` up, each
 * lattice value random, smoothly blended between. Values 0-1.
 */
function noise(n: number, cells: number, rand: () => number, rows = cells): Float32Array {
  const lattice = new Float32Array(cells * rows);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const fy = (y / n) * rows;
    const iy = Math.floor(fy);
    const ty = smooth(fy - iy);
    const r0 = (iy % rows) * cells;
    const r1 = ((iy + 1) % rows) * cells;
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells;
      const ix = Math.floor(fx);
      const tx = smooth(fx - ix);
      const c0 = ix % cells;
      const c1 = (ix + 1) % cells;
      const a = lattice[r0 + c0]! + (lattice[r0 + c1]! - lattice[r0 + c0]!) * tx;
      const b = lattice[r1 + c0]! + (lattice[r1 + c1]! - lattice[r1 + c0]!) * tx;
      out[y * n + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/** Octaves of noise, each twice as fine and half as strong as the last; values about 0-1. */
function fbm(n: number, cells: number, octaves: number, rand: () => number, rows = cells): Float32Array {
  const out = new Float32Array(n * n);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const layer = noise(n, cells << o, rand, rows << o);
    for (let i = 0; i < out.length; i++) out[i]! += layer[i]! * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= total;
  return out;
}

function blank(n: number): Surface {
  return { height: new Float32Array(n * n), joint: new Float32Array(n * n), tone: new Float32Array(n * n).fill(0.5) };
}

/** Rendered plaster: a fine stucco, and a faint cloudiness where it was laid on. */
function plaster(n: number, rand: () => number): Surface {
  const s = blank(n);
  const grain = fbm(n, 16, 4, rand);
  const speck = noise(n, 128, rand);
  const cloud = fbm(n, 3, 3, rand);
  for (let i = 0; i < n * n; i++) {
    s.height[i] = (grain[i]! * 0.6 + speck[i]! * 0.4) * 0.0012;
    s.tone[i] = 0.5 + (cloud[i]! - 0.5) * 0.35 + (speck[i]! - 0.5) * 0.06;
  }
  return s;
}

/**
 * Stretcher bond: bricks 215 by 65 mm in 10 mm of mortar, four across the tile and twelve
 * courses up, each brick a tone of its own and pitted a little.
 */
function brick(n: number, rand: () => number): Surface {
  const s = blank(n);
  const across = 4;
  const courses = 12;
  const tones = Array.from({ length: across * courses }, () => rand());
  const pits = fbm(n, 32, 3, rand);
  const joint = 0.01 / 0.9;
  for (let y = 0; y < n; y++) {
    const v = ((y + 0.5) / n) * courses;
    const c = Math.floor(v);
    const fy = v - c;
    for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) / n) * across + (c % 2 ? 0.5 : 0);
      const b = Math.floor(u);
      const fx = u - b;
      // Distance from the brick's edge, in tile fractions, against half the joint.
      const ex = Math.min(fx, 1 - fx) / across;
      const ey = Math.min(fy, 1 - fy) / courses;
      const edge = Math.min(ex, ey);
      const i = y * n + x;
      const mortar = 1 - Math.min(1, Math.max(0, (edge - joint / 2) / (joint * 0.3) + 0.5));
      // The face rounds off at its arrises; the mortar lies 8 mm back.
      s.height[i] = (1 - mortar) * (0.008 - 0.004 * Math.exp(-edge / 0.004)) + pits[i]! * 0.0015;
      s.joint[i] = mortar;
      s.tone[i] = 0.36 + tones[(b % across) + c * across]! * 0.28 + (pits[i]! - 0.5) * 0.2;
    }
  }
  return s;
}

/** Precast concrete: smooth, with pinholes, faint cloudy patches and a grid of tie holes. */
function concrete(n: number, rand: () => number): Surface {
  const s = blank(n);
  const grain = fbm(n, 12, 4, rand);
  const cloud = fbm(n, 2, 4, rand);
  for (let i = 0; i < n * n; i++) {
    s.height[i] = grain[i]! * 0.0008;
    s.tone[i] = 0.5 + (cloud[i]! - 0.5) * 0.45 + (grain[i]! - 0.5) * 0.08;
  }
  // Pinholes: small pits scattered over the face.
  for (let k = 0; k < 220; k++) {
    const cx = rand() * n;
    const cy = rand() * n;
    const r = 0.6 + rand() * 1.3;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d >= 1) continue;
        const i = ((Math.floor(cy) + dy + n) % n) * n + ((Math.floor(cx) + dx + n) % n);
        s.height[i]! -= 0.002 * (1 - d * d);
        s.joint[i] = Math.max(s.joint[i]!, 0.5 * (1 - d));
      }
    }
  }
  // Tie holes from the formwork, every 0.4 m: four by four in the tile.
  const hole = (0.013 / 1.6) * n;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const cx = ((gx + 0.5) / 4) * n;
      const cy = ((gy + 0.5) / 4) * n;
      for (let y = Math.floor(cy - hole - 2); y <= cy + hole + 2; y++) {
        for (let x = Math.floor(cx - hole - 2); x <= cx + hole + 2; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / hole;
          if (d >= 1.3) continue;
          const i = ((y + n) % n) * n + ((x + n) % n);
          const k = Math.min(1, Math.max(0, (1.3 - d) / 0.3));
          s.height[i]! -= 0.006 * k;
          s.joint[i] = Math.max(s.joint[i]!, k);
        }
      }
    }
  }
  return s;
}

/**
 * Ashlar: courses 0.45 m high, four in the tile, of blocks 0.6 to 1.2 m long in 8 mm joints,
 * each block a tone of its own, its face tooled and a little pillowed.
 */
function stone(n: number, rand: () => number): Surface {
  const s = blank(n);
  const courses = 4;
  const tile = 1.8;
  const joint = 0.008 / tile;
  // Where each course's joints fall, as tile fractions, repeating across the tile.
  const rows: { cuts: number[]; tones: number[] }[] = [];
  for (let c = 0; c < courses; c++) {
    const cuts: number[] = [];
    let at = rand() * 0.3;
    const start = at;
    while (at < start + 1 - 0.3) {
      cuts.push(at);
      at += (0.6 + rand() * 0.6) / tile;
    }
    rows.push({ cuts, tones: cuts.map(() => rand()) });
  }
  const tooled = fbm(n, 24, 3, rand);
  const cloud = fbm(n, 4, 3, rand);
  for (let y = 0; y < n; y++) {
    const v = ((y + 0.5) / n) * courses;
    const c = Math.floor(v);
    const fy = v - c;
    const row = rows[c]!;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      // The block this texel is in: the last cut at or before it, wrapping round the tile.
      let k = row.cuts.length - 1;
      for (let m = 0; m < row.cuts.length; m++) if (row.cuts[m]! <= u) k = m;
      const from = row.cuts[k]!;
      const to = row.cuts[(k + 1) % row.cuts.length]! + (k + 1 === row.cuts.length ? 1 : 0);
      const lu = (((u - from) % 1) + 1) % 1;
      const length = (((to - from) % 1) + 1) % 1 || 1;
      const ex = Math.min(lu, length - lu);
      const ey = Math.min(fy, 1 - fy) / courses;
      const edge = Math.min(ex, ey);
      const i = y * n + x;
      const gap = 1 - Math.min(1, Math.max(0, (edge - joint / 2) / (joint * 0.4) + 0.5));
      const pillow = Math.min(1, edge / 0.02);
      s.height[i] = (1 - gap) * (0.004 + 0.003 * pillow) + tooled[i]! * 0.0012;
      s.joint[i] = gap;
      s.tone[i] = 0.42 + row.tones[k]! * 0.16 + (cloud[i]! - 0.5) * 0.12 + (tooled[i]! - 0.5) * 0.08;
    }
  }
  return s;
}

/** Glass and metal panels: flat but for the faint waves toughened glass takes from its rollers. */
function panel(n: number, rand: () => number): Surface {
  const s = blank(n);
  const wave = fbm(n, 2, 2, rand, 1);
  const cloud = fbm(n, 3, 3, rand);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      s.height[i] = Math.sin(((y + 0.5) / n) * Math.PI * 2 * 3 + wave[i]! * 2) * 0.0004;
      s.tone[i] = 0.5 + (cloud[i]! - 0.5) * 0.12;
    }
  }
  return s;
}

/** Weatherboards: six 150 mm boards up the tile, each lapping over the one below it. */
function boards(n: number, rand: () => number): Surface {
  const s = blank(n);
  const count = 6;
  const tones = Array.from({ length: count }, () => rand());
  const grain = fbm(n, 4, 4, rand, 32);
  for (let y = 0; y < n; y++) {
    const v = ((y + 0.5) / n) * count;
    const b = Math.floor(v);
    const fy = v - b;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      // Thick at its foot, thin where it tucks under the board above.
      s.height[i] = 0.018 * (1 - fy) + grain[i]! * 0.0006;
      // The shadow line under each board's foot.
      s.joint[i] = fy < 0.06 ? 1 - fy / 0.06 : 0;
      s.tone[i] = 0.45 + tones[b]! * 0.1 + (grain[i]! - 0.5) * 0.18;
    }
  }
  return s;
}

/** A flat roof: a membrane laid in metre-wide sheets, gritted. */
function roof(n: number, rand: () => number): Surface {
  const s = blank(n);
  const grit = noise(n, 160, rand);
  const cloud = fbm(n, 3, 4, rand);
  const seam = (0.03 / 2) * n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const fromSeam = Math.min(...[0, n / 2, n].map((c) => Math.abs(x + 0.5 - c)));
      const lap = fromSeam < seam ? 1 - fromSeam / seam : 0;
      s.height[i] = grit[i]! * 0.0015 + lap * 0.002;
      s.joint[i] = lap * 0.6;
      s.tone[i] = 0.5 + (grit[i]! - 0.5) * 0.35 + (cloud[i]! - 0.5) * 0.4;
    }
  }
  return s;
}

/** Corrugated steel: ten corrugations of 76 mm across the tile, with streaks where rain runs off. */
function sheet(n: number, rand: () => number): Surface {
  const s = blank(n);
  const streaks = fbm(n, 24, 3, rand, 2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      s.height[i] = Math.sin(((x + 0.5) / n) * Math.PI * 2 * 10) * 0.009;
      s.tone[i] = 0.5 + (streaks[i]! - 0.5) * 0.3;
    }
  }
  return s;
}

const RECIPES: ((n: number, rand: () => number) => Surface)[] = [plaster, brick, concrete, stone, panel, boards, roof, sheet];

/** The layers drawn, each `n` texels square: heights in metres, joints and tones. */
export function surfaces(n: number): Surface[] {
  return RECIPES.map((recipe, k) => recipe(n, mulberry32(0x5eed + k * 7919)));
}

/**
 * Packs the layers for the GPU, `n` texels square each, layer after layer: the surface's tilt
 * from its heights (central differences across the tile's wrap), the joints and the tone.
 */
export function packSurfaces(layers: readonly Surface[], n: number): Uint8Array {
  const out = new Uint8Array(n * n * 4 * layers.length);
  const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  layers.forEach((s, k) => {
    const [tx, ty] = LAYER_TILE[k]!;
    // Metres per texel, across and up.
    const mx = tx / n;
    const my = ty / n;
    const base = k * n * n * 4;
    const h = s.height;
    for (let y = 0; y < n; y++) {
      const row = y * n;
      const up = ((y + 1) % n) * n;
      const down = ((y + n - 1) % n) * n;
      for (let x = 0; x < n; x++) {
        const right = (x + 1) % n;
        const left = (x + n - 1) % n;
        const dx = (h[row + right]! - h[row + left]!) / (2 * mx);
        const dy = (h[up + x]! - h[down + x]!) / (2 * my);
        const len = Math.sqrt(dx * dx + dy * dy + 1);
        const o = base + (row + x) * 4;
        out[o] = byte((-dx / len) * 0.5 + 0.5);
        out[o + 1] = byte((-dy / len) * 0.5 + 0.5);
        out[o + 2] = byte(s.joint[row + x]!);
        out[o + 3] = byte(s.tone[row + x]!);
      }
    }
  });
  return out;
}
