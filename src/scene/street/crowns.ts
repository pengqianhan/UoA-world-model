// The trees of the walker views, by rule: how a crown is made of cards of leaves, which leaves a
// tree has, what a deciduous tree wears in each month, and the picture of a cluster of leaves the
// cards show. Plain numbers, so that tests can check them without a GPU; trees.ts draws them.
//
// Where a tree stands is OpenStreetMap's, and its size, turn and shade are the map's
// (CampusScene.buildTrees). Nothing is known of its kind: the shape of its crown, its leaves, its
// bark and how it sways are all drawn by rule, and say nothing about the real tree.

/**
 * The map's crown on a tree one metre wide and one tall: a gem of radius 0.5, 0.84 as tall as it is
 * wide, its middle 0.6 up the tree (CampusScene.buildTrees). The cards fill the same room.
 */
export const CROWN_MIDDLE = 0.6;
export const CROWN_HALF_WIDTH = 0.5;
export const CROWN_HALF_HEIGHT = 0.42;
/** How far out of the middle the cards stand, as a share of the crown's half-width and half-height: their leaves reach a little past it. */
const CROWN_FILL = 0.85;
/** Cards on the smallest tree the map draws (5.5 m across) and on the largest (10.5 m). */
export const MIN_CARDS = 10;
export const MAX_CARDS = 16;
/** A card's side against the crown's mean half-axis. */
const CARD_SIZE = 1.2;

/** A tree as the map draws it (CampusScene.buildTrees), which the walker views draw again by these rules. */
export interface TreeSpec {
  /** Where its trunk stands, in the scene's axes: metres east, the ground's height, metres south. */
  x: number;
  y: number;
  z: number;
  /** Metres across its crown, and from its foot to its top. */
  width: number;
  height: number;
  /** Radians it is turned about its trunk. */
  turn: number;
  /** The map's shade for its crown, a multiplier for each of red, green and blue. */
  shade: [number, number, number];
  /** OpenStreetMap tags it deciduous. */
  deciduous: boolean;
}

/** One card of leaves in a crown. */
export interface LeafCard {
  /** Metres from the foot of the trunk: east, up, south, before the tree is turned. */
  at: [number, number, number];
  /** Which way the card faces: out of the crown, a little at random. Unit length. */
  facing: [number, number, number];
  /** Radians the card is turned about its facing. */
  roll: number;
  /** Metres along each side. */
  size: number;
  /** A shade of its own, about 1. */
  tint: number;
}

/** What a tree's leaves are doing: evergreen, or a deciduous tree in leaf, turning, bare or coming into leaf. */
export type LeafState = "evergreen" | "summer" | "autumn" | "bare" | "spring";

/** Deterministic pseudo-random numbers, so a tree is the same on every load. */
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

function mix32(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A tree's seed from where it stands, metres east and north, to the decimetre the map keeps. */
export function treeSeed(east: number, north: number): number {
  return mix32(mix32(Math.round(east * 10) | 0) ^ Math.imul(Math.round(north * 10) | 0, 0x9e3779b1));
}

/**
 * Which of the two kinds of leaf a tree has: broad leaves, as on an oak or a plane, or small narrow
 * ones, as on many natives. About three trees in five have the broad.
 */
export function leafVariant(seed: number): 0 | 1 {
  return (seed >>> 8) % 100 < 62 ? 0 : 1;
}

/**
 * A tree's leaves in a month, 1-12, through a southern-hemisphere year: trees OpenStreetMap tags as
 * deciduous turn in April and May, stand bare from June to August and come into leaf in September
 * and October, as the map colours them; the rest are evergreen.
 */
export function leafState(month: number, deciduous: boolean): LeafState {
  if (!deciduous) return "evergreen";
  if (month === 4 || month === 5) return "autumn";
  if (month >= 6 && month <= 8) return "bare";
  if (month === 9 || month === 10) return "spring";
  return "summer";
}

/** How many cards a crown has: more on a larger tree. */
export function cardCount(width: number): number {
  const k = Math.min(1, Math.max(0, (width - 5.5) / 5));
  return Math.round(MIN_CARDS + (MAX_CARDS - MIN_CARDS) * k);
}

/** A direction at random, of unit length. */
function unit(rand: () => number): [number, number, number] {
  const y = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - y * y);
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

function normalise(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * The cards of a crown, `width` metres across and on a tree `height` metres tall, from the tree's
 * seed. They gather on three to five lobes, each a bulge of the crown in a direction of its own, so
 * that the crown is not a ball; one hangs under its middle and three round its lower rim, where the
 * lowest boughs reach out and down, and one stands on top, so that it is closed from below and
 * above. Each faces out of the crown, give or take, and is a cluster of leaves on twigs.
 */
export function crownCards(seed: number, width: number, height: number): LeafCard[] {
  const rand = mulberry32(seed ^ 0x1eaf5eed);
  const a = CROWN_HALF_WIDTH * width * CROWN_FILL;
  const b = CROWN_HALF_HEIGHT * height * CROWN_FILL;
  const mid = CROWN_MIDDLE * height;
  const mean = (2 * a + b) / 3;
  const lobeCount = 3 + Math.floor(rand() * 3);
  const lobes = Array.from({ length: lobeCount }, (_, k) => {
    const azimuth = ((k + rand() * 0.7) / lobeCount) * Math.PI * 2;
    const up = -0.3 + rand() * 1.05;
    const flat = Math.sqrt(1 - Math.min(0.95, up * up));
    return { dir: normalise([flat * Math.cos(azimuth), up, flat * Math.sin(azimuth)]), reach: 0.82 + rand() * 0.25 };
  });
  const count = cardCount(width);
  const rim = rand() * Math.PI * 2;
  const cards: LeafCard[] = [];
  for (let k = 0; k < count; k++) {
    const lobe = lobes[k % lobes.length]!;
    const r = unit(rand);
    const around = rim + ((k - 1) / 3) * Math.PI * 2;
    const toward: readonly number[] = k === 0 ? [0, -1, 0] : k <= 3 ? [0.8 * Math.cos(around), -0.6, 0.8 * Math.sin(around)] : k === 4 ? [0, 1, 0] : lobe.dir;
    const spread = k <= 4 ? 0.3 : 0.85;
    const dir = normalise([toward[0]! * 1.2 + r[0] * spread, toward[1]! * 1.2 + r[1] * spread, toward[2]! * 1.2 + r[2] * spread]);
    const reach = k <= 3 ? 0.85 + 0.12 * rand() : k === 4 ? 0.7 + 0.15 * rand() : lobe.reach * (0.6 + 0.3 * rand());
    const tilt = unit(rand);
    cards.push({
      at: [dir[0] * a * reach, mid + dir[1] * b * reach, dir[2] * a * reach],
      facing: normalise([dir[0] + tilt[0] * 0.35, dir[1] + tilt[1] * 0.35, dir[2] + tilt[2] * 0.35]),
      roll: rand() * Math.PI * 2,
      size: mean * CARD_SIZE * (0.85 + 0.35 * rand()),
      tint: 0.9 + 0.2 * rand(),
    });
  }
  return cards;
}

// ---------------------------------------------------------------------------------------------
// The picture on the cards: a cluster of leaves on twigs, one for each kind of leaf, side by side.

/** The alpha a texel of the leaves must reach to be drawn (trees.ts); the mipmaps keep the share that does. */
export const LEAF_CUTOFF = 0.45;
/** How far from the middle of its picture, as a share of its width, a cluster's leaves reach. */
export const LEAF_REACH = 0.47;

/** One kind of leaf: how many in a cluster, their length and width (shares of the picture and of the length), and the twigs they grow on. */
interface LeafKind {
  leaves: number;
  length: [number, number];
  width: [number, number];
  twigs: number;
}

const LEAF_KINDS: readonly LeafKind[] = [
  { leaves: 950, length: [0.034, 0.05], width: [0.38, 0.5], twigs: 7 },
  { leaves: 1700, length: [0.025, 0.036], width: [0.24, 0.32], twigs: 8 },
];

/**
 * The picture of the leaves, `n` texels square for each kind, the kinds side by side: red, a leaf's
 * tone (0-1, shade from leaves over it, paler along its midrib); green, which of two greens it is;
 * blue, 1 for twig; alpha, cover. Each level of its mipmaps, largest first, keeps the share of
 * texels at or over LEAF_CUTOFF that the largest has, so that a far crown does not thin away.
 */
export function leafAtlas(n: number): { width: number; height: number; levels: Uint8Array[] } {
  const width = n * LEAF_KINDS.length;
  const tone = new Float32Array(width * n).fill(0.6);
  const hue = new Float32Array(width * n).fill(0.5);
  const twig = new Float32Array(width * n);
  const cover = new Float32Array(width * n);
  const s = n / 512;
  /** Lays a texel over what is there: the picture's own "over". */
  const lay = (x: number, y: number, c: number, t: number, h: number, w: number) => {
    if (c <= 0) return;
    const i = y * width + x;
    const old = cover[i]!;
    const a = c + old * (1 - c);
    const keep = (old * (1 - c)) / a;
    tone[i] = t + (tone[i]! - t) * keep;
    hue[i] = h + (hue[i]! - h) * keep;
    twig[i] = w + (twig[i]! - w) * keep;
    cover[i] = a;
  };
  LEAF_KINDS.forEach((kind, v) => {
    const rand = mulberry32(0x1ea7 + v * 7919);
    const x0 = v * n;
    const cx = n / 2;
    const cy = n / 2;
    const reach = LEAF_REACH * n;
    // Twigs out from the middle, each bending a little; leaves grow along them and between.
    // Each twig starts from the middle or forks off one before it, and bends a little along its length.
    type Twig = { x: number; y: number; angle: number; bend: number; length: number; width: number };
    const twigs: Twig[] = [];
    for (let k = 0; k < kind.twigs; k++) {
      const angle = ((k + rand() * 0.6) / kind.twigs) * Math.PI * 2;
      const from = rand() * 0.04 * n;
      twigs.push({ x: cx + Math.cos(angle) * from, y: cy + Math.sin(angle) * from, angle, bend: (rand() - 0.5) * 0.8, length: (0.3 + rand() * 0.1) * n, width: 2.4 });
    }
    const along = (tw: Twig, u: number): [number, number, number] => {
      const a = tw.angle + tw.bend * u;
      const d = tw.length * u;
      return [tw.x + Math.cos(a) * d, tw.y + Math.sin(a) * d, a];
    };
    for (const main of twigs.slice()) {
      for (let f = 0; f < 3; f++) {
        const [x, y, a] = along(main, 0.3 + rand() * 0.5);
        twigs.push({ x, y, angle: a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5), bend: (rand() - 0.5) * 0.8, length: (0.08 + rand() * 0.08) * n, width: 1.3 });
      }
    }
    for (const tw of twigs) {
      for (let k = 0; k < 24; k++) {
        const [px, py] = along(tw, k / 24);
        const [qx, qy] = along(tw, (k + 1) / 24);
        const half = tw.width * (1 - 0.6 * (k / 24)) * s;
        capsule(px, py, qx, qy, half, n, (x, y, c) => lay(x0 + x, y, c, 0.45 + rand() * 0.1, 0.5, 1));
      }
    }
    // Leaves deeper in the cluster are laid first and darker: those over them shade them.
    for (let k = 0; k < kind.leaves; k++) {
      const depth = k / kind.leaves;
      const length = (kind.length[0] + rand() * (kind.length[1] - kind.length[0])) * n;
      const half = (length * (kind.width[0] + rand() * (kind.width[1] - kind.width[0]))) / 2;
      let bx: number;
      let by: number;
      let angle: number;
      if (rand() < 0.6) {
        const tw = twigs[Math.floor(rand() * twigs.length)]!;
        const [px, py, a] = along(tw, 0.1 + rand() * 0.9);
        bx = px;
        by = py;
        angle = a + (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.7);
      } else {
        // Thick in the middle of the cluster, thinning to its edge.
        let r = 0;
        do r = Math.sqrt(rand()) * 0.44 * n;
        while (rand() > 1 - Math.pow(r / (0.46 * n), 3));
        const a = rand() * Math.PI * 2;
        bx = cx + Math.cos(a) * r;
        by = cy + Math.sin(a) * r;
        angle = a + (rand() - 0.5) * 2.2;
      }
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      // Leaves that would reach the edge of the picture are left off it, so that it ends in clear.
      if (Math.hypot(bx + dx * length - cx, by + dy * length - cy) > reach) continue;
      const shade = 0.45 + 0.5 * depth + (rand() - 0.5) * 0.14;
      const green = Math.pow(rand(), 1.3);
      leaf(bx, by, dx, dy, length, half, n, (x, y, c, u, across) => {
        const midrib = across < 0.14 ? 0.06 : 0;
        lay(x0 + x, y, c, Math.min(1, shade * (0.86 + 0.14 * u) * (1 - 0.2 * across * across) + midrib), green, 0);
      });
    }
  });
  return { width, height: n, levels: mipLevels(width, n, tone, hue, twig, cover) };
}

/** Calls `paint` with the cover of each texel of the tile within `half` of the segment p-q. */
function capsule(px: number, py: number, qx: number, qy: number, half: number, n: number, paint: (x: number, y: number, c: number) => void): void {
  const ex = qx - px;
  const ey = qy - py;
  const l2 = ex * ex + ey * ey || 1;
  for (let y = Math.max(0, Math.floor(Math.min(py, qy) - half - 1)); y <= Math.min(n - 1, Math.ceil(Math.max(py, qy) + half + 1)); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(px, qx) - half - 1)); x <= Math.min(n - 1, Math.ceil(Math.max(px, qx) + half + 1)); x++) {
      const t = Math.min(1, Math.max(0, ((x + 0.5 - px) * ex + (y + 0.5 - py) * ey) / l2));
      const d = Math.hypot(x + 0.5 - px - ex * t, y + 0.5 - py - ey * t);
      paint(x, y, Math.min(1, Math.max(0, half - d + 0.5)));
    }
  }
}

/**
 * Calls `paint` for each texel of a leaf from (bx, by) along (dx, dy), `length` texels long and
 * `half` wide at its widest: its cover, how far along it is (0-1) and how far across (0-1).
 */
function leaf(bx: number, by: number, dx: number, dy: number, length: number, half: number, n: number, paint: (x: number, y: number, c: number, u: number, across: number) => void): void {
  const tx = bx + dx * length;
  const ty = by + dy * length;
  const pad = half + 1;
  for (let y = Math.max(0, Math.floor(Math.min(by, ty) - pad)); y <= Math.min(n - 1, Math.ceil(Math.max(by, ty) + pad)); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(bx, tx) - pad)); x <= Math.min(n - 1, Math.ceil(Math.max(bx, tx) + pad)); x++) {
      const rx = x + 0.5 - bx;
      const ry = y + 0.5 - by;
      const t = rx * dx + ry * dy;
      const side = Math.abs(-rx * dy + ry * dx);
      if (t < -1 || t > length + 1) continue;
      const u = Math.min(1, Math.max(0, t / length));
      // Widest a little below the middle, coming to a point at the tip and a narrow base at the stalk.
      const w = half * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.75);
      const c = Math.min(1, Math.max(0, w - side + 0.5)) * Math.min(1, Math.max(0, Math.min(t, length - t) + 0.5));
      if (c > 0) paint(x, y, c, u, w > 0 ? Math.min(1, side / w) : 1);
    }
  }
}

/** The share of a level's texels whose cover, times `scale`, reaches the cutoff. */
function coverage(cover: Float32Array, scale: number): number {
  let n = 0;
  for (const c of cover) if (c * scale >= LEAF_CUTOFF) n++;
  return n / cover.length;
}

/**
 * Every level of the mipmaps, packed: each half the size of the last, its tone, green and twig
 * averaged by cover so that clear texels do not darken the leaves, and its cover raised until the
 * same share of it reaches the cutoff as of the largest level.
 */
function mipLevels(w0: number, h0: number, tone: Float32Array, hue: Float32Array, twig: Float32Array, cover: Float32Array): Uint8Array[] {
  const target = coverage(cover, 1);
  const levels: Uint8Array[] = [];
  let w = w0;
  let h = h0;
  let level = { tone, hue, twig, cover };
  for (;;) {
    let scale = 1;
    if (levels.length) {
      let lo = 1;
      let hi = 8;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if (coverage(level.cover, mid) < target) lo = mid;
        else hi = mid;
      }
      scale = hi;
    }
    const out = new Uint8Array(w * h * 4);
    const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
    for (let i = 0; i < w * h; i++) {
      out[i * 4] = byte(level.tone[i]!);
      out[i * 4 + 1] = byte(level.hue[i]!);
      out[i * 4 + 2] = byte(level.twig[i]!);
      out[i * 4 + 3] = byte(Math.min(1, level.cover[i]! * scale));
    }
    levels.push(out);
    if (w === 1 && h === 1) break;
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const next = { tone: new Float32Array(nw * nh), hue: new Float32Array(nw * nh), twig: new Float32Array(nw * nh), cover: new Float32Array(nw * nh) };
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let a = 0;
        let t = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let dy = 0; dy < (h > 1 ? 2 : 1); dy++) {
          for (let dx = 0; dx < (w > 1 ? 2 : 1); dx++) {
            const i = Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx);
            const c = level.cover[i]!;
            a += c;
            t += level.tone[i]! * c;
            g += level.hue[i]! * c;
            b += level.twig[i]! * c;
            count++;
          }
        }
        const j = y * nw + x;
        next.cover[j] = a / count;
        next.tone[j] = a > 0 ? t / a : 0.6;
        next.hue[j] = a > 0 ? g / a : 0.5;
        next.twig[j] = a > 0 ? b / a : 0;
      }
    }
    level = next;
    w = nw;
    h = nh;
  }
  return levels;
}
