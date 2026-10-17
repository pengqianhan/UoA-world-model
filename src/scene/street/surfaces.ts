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
 * `tiles` gives the metres each layer covers (LAYER_TILE for the walls, GROUND_TILE for the ground).
 */
export function packSurfaces(layers: readonly Surface[], n: number, tiles: readonly (readonly [number, number])[] = LAYER_TILE): Uint8Array {
  const out = new Uint8Array(n * n * 4 * layers.length);
  const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  layers.forEach((s, k) => {
    const [tx, ty] = tiles[k]!;
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

// ---------------------------------------------------------------------------------------------
// The ground in the walker views (ground.ts): a lawn, open ground, asphalt, concrete, a railway's
// ballast and the ripples on still water, each a tile that repeats without a seam, packed as the
// walls' layers are; and a broad variation over half a kilometre that keeps the tiles from
// showing. The joints channel is what each surface has instead: the pale tips of grass blades,
// where tufts grow in open ground, the pale tops of the stones in asphalt, the pits in concrete,
// the gaps between stones of ballast.

/** Layers of the ground, in the order they are packed. */
export const GROUND_LAYER = { turf: 0, ground: 1, asphalt: 2, concrete: 3, ballast: 4, ripple: 5, macro: 6 } as const;
export const GROUND_LAYERS = 7;

/** Metres one repeat of each ground layer covers. The broad variation is four slow fields, not a surface. */
export const GROUND_TILE: readonly [number, number][] = [
  [1.3, 1.3],
  [2.4, 2.4],
  [1.2, 1.2],
  [1.6, 1.6],
  [1, 1],
  [4, 4],
  [512, 512],
];

/**
 * Adds to fields at a point between texels, shared over the four texels round it and wrapping
 * round the tile: `values[k]` to `fields[k]`.
 */
function splat(fields: readonly Float32Array[], n: number, x: number, y: number, values: readonly number[]): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const x0 = ((ix % n) + n) % n;
  const x1 = (x0 + 1) % n;
  const y0 = (((iy % n) + n) % n) * n;
  const y1 = ((y0 / n + 1) % n) * n;
  const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const at = [y0 + x0, y0 + x1, y1 + x0, y1 + x1];
  for (let k = 0; k < fields.length; k++) {
    const f = fields[k]!;
    const v = values[k]!;
    if (v === 0) continue;
    for (let c = 0; c < 4; c++) f[at[c]!]! += v * w[c]!;
  }
}

/** Calls `paint` for each texel within `r` texels of a point, with its distance over `r` (0-1), wrapping round the tile. */
function disc(n: number, cx: number, cy: number, r: number, paint: (i: number, d: number) => void): void {
  const reach = Math.ceil(r + 1);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const px = Math.floor(cx) + dx;
      const py = Math.floor(cy) + dy;
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / r;
      if (d < 1) paint((((py % n) + n) % n) * n + (((px % n) + n) % n), d);
    }
  }
}

/** Blades of grass `from` to `to` metres long lying every way, `count` of them where `keep` allows. */
function blades(s: Surface, n: number, tile: number, count: number, from: number, to: number, rand: () => number, keep: (i: number) => boolean = () => true): void {
  const perMetre = n / tile;
  for (let b = 0; b < count; b++) {
    const x = rand() * n;
    const y = rand() * n;
    const a = rand() * Math.PI * 2;
    const length = (from + rand() * (to - from)) * perMetre;
    const lift = 0.002 + rand() * 0.002;
    const shade = (rand() - 0.5) * 0.08;
    if (!keep((Math.floor(y) % n) * n + (Math.floor(x) % n))) continue;
    const fields = [s.height, s.tone, s.joint];
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let t = 0; t <= length; t += 0.7) {
      const k = t / length;
      splat(fields, n, x + ca * t, y + sa * t, [lift * (1 - 0.6 * k), shade, k > 0.6 ? (k - 0.6) * 0.8 : 0]);
    }
  }
}

function clampSurface(s: Surface): Surface {
  for (let i = 0; i < s.tone.length; i++) {
    s.tone[i] = Math.min(1, Math.max(0, s.tone[i]!));
    s.joint[i] = Math.min(1, Math.max(0, s.joint[i]!));
  }
  return s;
}

/** A mown lawn: blades of grass 2 to 7 cm long lying every way, in clumps of lighter and darker green. */
function turf(n: number, rand: () => number): Surface {
  const s = blank(n);
  const clumps = fbm(n, 6, 3, rand);
  const fine = noise(n, 64, rand);
  for (let i = 0; i < n * n; i++) {
    s.height[i] = clumps[i]! * 0.004 + fine[i]! * 0.0012;
    s.tone[i] = 0.5 + (clumps[i]! - 0.5) * 0.55 + (fine[i]! - 0.5) * 0.15;
  }
  blades(s, n, GROUND_TILE[GROUND_LAYER.turf]![0], 6000, 0.02, 0.07, rand);
  return clampSurface(s);
}

/** Open ground: compacted earth and fine gravel with pebbles in it, mottled, and tufts of grass in patches. */
function openGround(n: number, rand: () => number): Surface {
  const s = blank(n);
  const clods = fbm(n, 10, 4, rand);
  const mottle = fbm(n, 4, 3, rand);
  const tufts = fbm(n, 6, 3, rand);
  for (let i = 0; i < n * n; i++) {
    s.height[i] = clods[i]! * 0.006;
    s.tone[i] = 0.5 + (mottle[i]! - 0.5) * 0.55 + (clods[i]! - 0.5) * 0.25;
    s.joint[i] = Math.min(1, Math.max(0, (tufts[i]! - 0.42) / 0.25));
  }
  // Pebbles 6 to 30 mm across, paler or darker than the earth round them.
  for (let k = 0; k < 1300; k++) {
    const r = 0.6 + rand() * 1.6;
    const h = 0.002 + rand() * 0.005;
    const tone = 0.5 + (rand() - 0.4) * 0.6;
    disc(n, rand() * n, rand() * n, r, (i, d) => {
      s.height[i] = Math.max(s.height[i]!, clods[i]! * 0.006 + h * Math.sqrt(1 - d * d));
      s.tone[i] = s.tone[i]! + (tone - s.tone[i]!) * (1 - d);
    });
  }
  blades(s, n, GROUND_TILE[GROUND_LAYER.ground]![0], 4000, 0.02, 0.06, rand, (i) => s.joint[i]! > 0.3);
  return clampSurface(s);
}

/** Asphalt: the stones of its aggregate, 5 to 15 mm, in a dark binder; the larger ones worn flat and pale on top. */
function asphalt(n: number, rand: () => number): Surface {
  const s = blank(n);
  const binder = fbm(n, 12, 3, rand);
  const fine = noise(n, 128, rand);
  for (let i = 0; i < n * n; i++) {
    s.height[i] = fine[i]! * 0.0005;
    s.tone[i] = 0.5 + (binder[i]! - 0.5) * 0.35 + (fine[i]! - 0.5) * 0.12;
  }
  for (let k = 0; k < 4200; k++) {
    const r = 0.55 + rand() * 1.1;
    const h = 0.001 + rand() * 0.0015;
    const tone = 0.35 + rand() * 0.45;
    const worn = rand() < 0.45 ? 0.5 + rand() * 0.5 : 0;
    disc(n, rand() * n, rand() * n, r, (i, d) => {
      s.height[i] = Math.max(s.height[i]!, h * Math.sqrt(1 - d * d));
      s.tone[i] = tone;
      s.joint[i] = Math.max(s.joint[i]!, worn * (1 - d * d));
    });
  }
  return clampSurface(s);
}

/** Concrete of slabs, kerbs and steps: a fine sandy grain, small pits, and cloudy patches from the float. */
function paving(n: number, rand: () => number): Surface {
  const s = blank(n);
  const grain = fbm(n, 24, 3, rand);
  const speck = noise(n, 128, rand);
  const cloud = fbm(n, 3, 4, rand);
  for (let i = 0; i < n * n; i++) {
    s.height[i] = grain[i]! * 0.0008 + speck[i]! * 0.0004;
    s.tone[i] = 0.5 + (cloud[i]! - 0.5) * 0.4 + (speck[i]! - 0.5) * 0.1;
  }
  for (let k = 0; k < 420; k++) {
    disc(n, rand() * n, rand() * n, 0.5 + rand() * 0.9, (i, d) => {
      s.height[i]! -= 0.0012 * (1 - d * d);
      s.joint[i] = Math.max(s.joint[i]!, 0.7 * (1 - d));
    });
  }
  return clampSurface(s);
}

/** Ballast: crushed stone 30 to 60 mm across, each stone a tone of its own, dark gaps between them. */
function ballast(n: number, rand: () => number): Surface {
  const s = blank(n);
  const cells = 20;
  const size = n / cells;
  const points = Array.from({ length: cells * cells }, () => ({ x: rand(), y: rand(), tone: 0.25 + rand() * 0.55, h: 0.012 + rand() * 0.012 }));
  const fine = noise(n, 96, rand);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cx = Math.floor(x / size);
      const cy = Math.floor(y / size);
      let d1 = Infinity;
      let d2 = Infinity;
      let near = points[0]!;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const p = points[(((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells)]!;
          const d = Math.hypot((gx + p.x) * size - (x + 0.5), (gy + p.y) * size - (y + 0.5));
          if (d < d1) {
            d2 = d1;
            d1 = d;
            near = p;
          } else if (d < d2) d2 = d;
        }
      }
      // Texels from the edge of the stone.
      const edge = (d2 - d1) / 2;
      const i = y * n + x;
      s.height[i] = near.h * Math.min(1, edge / 4) ** 0.6 + fine[i]! * 0.001;
      s.joint[i] = 1 - Math.min(1, Math.max(0, (edge - 0.4) / 1.6));
      s.tone[i] = near.tone + (fine[i]! - 0.5) * 0.15;
    }
  }
  return clampSurface(s);
}

/** Ripples on still water: long low waves running every way, and a finer chop. Only their tilt is drawn. */
function ripple(n: number, rand: () => number): Surface {
  const s = blank(n);
  const chop = fbm(n, 16, 3, rand);
  const waves = Array.from({ length: 9 }, () => {
    let kx = 0;
    let ky = 0;
    while (kx === 0 && ky === 0) {
      kx = Math.round((rand() - 0.5) * 12);
      ky = Math.round((rand() - 0.5) * 12);
    }
    return { kx, ky, phase: rand() * Math.PI * 2, a: 0.006 / Math.hypot(kx, ky) };
  });
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let h = chop[y * n + x]! * 0.0016;
      for (const w of waves) h += w.a * Math.sin(((w.kx * x + w.ky * y) / n) * Math.PI * 2 + w.phase);
      s.height[y * n + x] = h;
    }
  }
  return s;
}

/** The layers of the ground that are surfaces, each `n` texels square. */
export function groundLayers(n: number): Surface[] {
  return [turf, openGround, asphalt, paving, ballast, ripple].map((recipe, k) => recipe(n, mulberry32(0x9a7e + k * 7919)));
}

/**
 * The broad variation over the ground, 512 m a tile, as four slow fields 0-1, packed: red, where
 * grass grows thicker or thinner; green, lighter and darker ground; blue, where water lies after
 * rain and grass grows lusher; alpha, wear. Each is stretched to its full range.
 */
export function groundVariation(n: number): Uint8Array {
  const rand = mulberry32(0x6a1e);
  const fields = [fbm(n, 4, 4, rand), fbm(n, 8, 3, rand), fbm(n, 16, 3, rand), fbm(n, 6, 3, rand)];
  const out = new Uint8Array(n * n * 4);
  fields.forEach((f, c) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of f) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    for (let i = 0; i < n * n; i++) out[i * 4 + c] = Math.round(((f[i]! - lo) / (hi - lo || 1)) * 255);
  });
  return out;
}

/** Every layer of the ground packed for the GPU, `n` texels square each: the surfaces, then the broad variation. */
export function packGround(n: number): Uint8Array {
  const surfaces = packSurfaces(groundLayers(n), n, GROUND_TILE);
  const out = new Uint8Array(n * n * 4 * GROUND_LAYERS);
  out.set(surfaces);
  out.set(groundVariation(n), surfaces.length);
  return out;
}
