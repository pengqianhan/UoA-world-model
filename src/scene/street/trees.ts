// The trees of the walker views: a trunk of bark with a few boughs into the crown, and a crown of
// cards of leaves (crowns.ts) that sways in a light breeze and is shaded as one round mass, lit on
// top and towards the sun, darker underneath and deep inside, where the leaves shade each other.
// Where a tree stands, how big it is, how it is turned and its shade are the map's
// (CampusScene.buildTrees); its leaves, bark, boughs and sway are drawn by rule and say nothing
// about the real tree.
//
// Cards are drawn for the trees within NEAR metres (NEAR_BASIC on a phone or a software renderer,
// which draws every card's every pixel) of where the camera was when they were last laid out, and laid out again as it moves on. Every other tree keeps a crown of the map's size,
// rounded, mottled and shaded the same way, which is what a tree that far off comes to.
//
// Loaded with the first walker view; a map's trees are planted the first time one is seen there.
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  CylinderGeometry,
  DataArrayTexture,
  DataTexture,
  DoubleSide,
  EqualDepth,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
  type IUniform,
  type Material,
  type WebGLRenderer,
} from "three";
import { CROWN_HALF_HEIGHT, CROWN_HALF_WIDTH, CROWN_MIDDLE, LEAF_CUTOFF, LEAF_REACH, crownCards, leafAtlas, leafState, leafVariant, treeSeed, type LeafState, type TreeSpec } from "./crowns.ts";
import { BARK_TILE, packBark } from "./surfaces.ts";
import type { RGB } from "./light.ts";

/** Metres round the camera within which trees have cards; they are laid out again when it has gone RELAYOUT from where they were. */
const NEAR = 160;
const NEAR_BASIC = 80;
const RELAYOUT = 30;
/** The card across each card of leaves, against the card's own size. */
const CROSS_CARD = 0.8;
/**
 * Where the cards' depth is drawn among the walker views' meshes (CampusScene GROUND_ORDER_AFTER,
 * PAINT_ORDER): after the ground, before everything that stands on it.
 */
const LEAF_DEPTH_ORDER = -0.2;
/** Texels across each kind of leaf's picture, and across the bark's. */
const LEAF_SIZE = 512;
const BARK_SIZE = 256;
/** How much of a card's shading is the crown's round mass rather than the card's own facing. */
const VOLUME = 0.7;
/** The share of the sky's light that reaches the leaves in the middle of a crown. */
const INNER_LIGHT = 0.4;
/**
 * A light breeze from the south-west, Auckland's most common wind: the weather the scene is given
 * has no wind, so it is the same every day. The top of a tree sways this share of its height, and
 * each card of leaves flutters this many metres.
 */
const WIND_TOWARD: readonly [number, number] = [Math.SQRT1_2, -Math.SQRT1_2];
const SWAY = 0.005;
const FLUTTER = 0.03;
/** A trunk's radius above its flare, as a share of the tree's width, and how far it leans at the crown. */
const TRUNK_RADIUS = 0.034;
const LEAN = 0.025;
/**
 * How much darker a far crown is drawn than its mottle, so that it matches the cards it stands for:
 * a crown of leaves shades itself inside, where a solid crown is lit all over.
 */
const FAR_TONE = 0.62;
/**
 * How much of the sky a leaf mirrors, against a smooth surface of its roughness: a crown is a
 * jumble of leaves at every angle, most of them shading the others, so it seldom shows the sheen
 * of the sky that a single card seen edge on would.
 */
const SHEEN = 0.35;

/** Colours, sRGB: two greens leaves are drawn in, and what deciduous trees wear through the year. */
const LEAVES: Record<Exclude<LeafState, "evergreen">, readonly [number, number]> = {
  summer: [0x5f7d38, 0x3a5a2b],
  autumn: [0xc8863a, 0x9b4825],
  spring: [0x9cc35c, 0x74aa48],
  // Far off, a bare tree's twigs are a haze of grey-brown, as the map draws it.
  bare: [0x8a7b6a, 0x7a6c5c],
};
const TWIG = 0x5a4a3c;
const BARK = 0x7a6f61;

/** sRGB to the linear values the shaders work in. */
function linear(hex: number): RGB {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as RGB;
}

const num = (x: number) => (Number.isFinite(x) ? x : 0).toFixed(5);

/** Puts `add` after `after` in a shader, or refuses if three's shaders have changed under it. */
function after(source: string, at: string, add: string): string {
  if (!source.includes(at)) throw new Error(`three's shaders have changed: "${at}" is not where trees.ts expects it`);
  return source.replace(at, `${at}\n${add}`);
}

function instead(source: string, at: string, put: string): string {
  if (!source.includes(at)) throw new Error(`three's shaders have changed: "${at}" is not where trees.ts expects it`);
  return source.replace(at, put);
}

/** The breeze, in the world: how far a point of a tree whose foot is tree.xyz and which is tree.w tall moves now. */
const BREEZE = /* glsl */ `
uniform float tcClock;
vec3 tcBreeze( vec3 p, vec4 tree, float flutter ) {
	float rise = clamp( ( p.y - tree.y ) / tree.w, 0.0, 1.3 );
	// Each tree in its own time, from where it stands.
	float phase = dot( tree.xz, vec2( 0.173, 0.291 ) );
	float sway = sin( tcClock * 1.1 + phase ) * 0.7 + sin( tcClock * 1.9 + phase * 1.3 ) * 0.3;
	vec3 move = vec3( ${num(WIND_TOWARD[0])}, 0.0, ${num(WIND_TOWARD[1])} ) * ( sway * rise * rise * tree.w * ${num(SWAY)} );
	move.y += sin( tcClock * 4.7 + dot( p, vec3( 1.3, 0.7, 1.9 ) ) ) * flutter * rise;
	return move;
}
`;

/** A point moved in the world, as the instance's own coordinates (three's transforms follow). */
const MOVE = "transformed += inverse( mat3( modelMatrix ) * mat3( instanceMatrix ) ) * tcMove;";

/** Value noise in three dimensions, 0-1: the mottle of a far crown. */
const NOISE = /* glsl */ `
float tcHash( vec3 p ) {
	p = fract( p * 0.3183099 + 0.1 );
	p *= 17.0;
	return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float tcNoise( vec3 x ) {
	vec3 i = floor( x );
	vec3 f = fract( x );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( mix( tcHash( i ), tcHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( tcHash( i + vec3( 0, 1, 0 ) ), tcHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( tcHash( i + vec3( 0, 0, 1 ) ), tcHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( tcHash( i + vec3( 0, 1, 1 ) ), tcHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
		f.z );
}
`;

/** The greens of a tree's leaves: an evergreen's, or a deciduous tree's for the month. */
const GREENS = /* glsl */ `
uniform vec3 tcLeafA;
uniform vec3 tcLeafB;
uniform vec3 tcTurnA;
uniform vec3 tcTurnB;
vec3 tcGreen( float which, float deciduous ) {
	return mix( mix( tcLeafA, tcTurnA, deciduous ), mix( tcLeafB, tcTurnB, deciduous ), which );
}
`;

type Shader = { vertexShader: string; fragmentShader: string; uniforms: Record<string, IUniform> };

/** Where a corner of a card goes in the breeze: the same in its depth and in its colour, so that the two meet. */
const LEAF_PLACE = `\tvec3 tcWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
	vec3 tcMove = tcBreeze( tcWorld, tcTree, ${num(FLUTTER)} );
	${MOVE}`;

/** The cards of leaves: their picture, the crown's round mass, how deep in it they are, the breeze. */
function patchLeaves(shader: Shader): void {
  let vs = shader.vertexShader;
  vs = after(
    vs,
    "#include <common>",
    `${BREEZE}
attribute vec4 tcTree;
attribute vec4 tcCrown;
attribute float tcDeciduous;
varying vec3 vTcVolume;
varying float vTcInner;
varying float vTcDeciduous;`,
  );
  vs = after(
    vs,
    "#include <begin_vertex>",
    `${LEAF_PLACE}
	// Out of the crown here, and how far out: the crown is lit and shaded as one round mass.
	vec3 tcOut = tcWorld - tcCrown.xyz;
	vTcInner = clamp( length( tcOut ) / tcCrown.w, 0.0, 1.0 );
	vTcVolume = normalize( ( viewMatrix * vec4( normalize( tcOut ), 0.0 ) ).xyz );
	// The shadow is looked up out of the crown too, so that its sunny side is lit as a whole.
	transformedNormal = vTcVolume;
	vTcDeciduous = tcDeciduous;`,
  );
  shader.vertexShader = vs;
  let fs = shader.fragmentShader;
  fs = after(
    fs,
    "#include <common>",
    `${GREENS}
uniform vec3 tcTwig;
varying vec3 vTcVolume;
varying float vTcInner;
varying float vTcDeciduous;`,
  );
  // The picture holds a leaf's tone, which green it is, twig and cover (crowns.ts leafAtlas).
  fs = instead(
    fs,
    "#include <map_fragment>",
    `\tvec4 tcTexel = texture2D( map, vMapUv );
	vec3 tcLeaf = tcGreen( tcTexel.g, vTcDeciduous ) * ( 0.3 + 0.7 * tcTexel.r );
	diffuseColor *= vec4( mix( tcLeaf, tcTwig * ( 0.6 + 0.8 * tcTexel.r ), tcTexel.b ), tcTexel.a );`,
  );
  fs = after(fs, "#include <normal_fragment_maps>", `\tnormal = normalize( mix( normal, normalize( vTcVolume ), ${num(VOLUME)} ) );`);
  fs = after(fs, "#include <lights_fragment_maps>", `\tradiance *= ${num(SHEEN)};`);
  fs = after(
    fs,
    "#include <aomap_fragment>",
    `\tfloat tcShade = mix( ${num(INNER_LIGHT)}, 1.0, smoothstep( 0.25, 0.95, vTcInner ) );
	reflectedLight.indirectDiffuse *= tcShade;
	reflectedLight.indirectSpecular *= tcShade;`,
  );
  shader.fragmentShader = fs;
}

/**
 * The cards' depth alone, drawn before their colour on a graphics card: each pixel of a crown is
 * then shaded once, for the leaf in front, however many cards lie behind it.
 */
function patchLeafDepth(shader: Shader): void {
  shader.vertexShader = after(shader.vertexShader, "#include <common>", `${BREEZE}\nattribute vec4 tcTree;`);
  shader.vertexShader = after(shader.vertexShader, "#include <begin_vertex>", LEAF_PLACE);
}

/** Trunks and boughs: bark from surfaces.ts round them and up them, darker at the foot, swaying with the crown. */
function patchBark(shader: Shader): void {
  let vs = shader.vertexShader;
  vs = after(vs, "#include <common>", `${BREEZE}\nvarying vec2 vTcBark;\nvarying float vTcRise;`);
  vs = after(
    vs,
    "#include <begin_vertex>",
    `\tvec4 tcTree = vec4( ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz, length( instanceMatrix[ 1 ].xyz ) );
	float tcWidth = length( instanceMatrix[ 0 ].xyz );
	// Whole tiles round the trunk, so that the bark meets itself.
	float tcAround = max( 1.0, floor( 6.2832 * ${num(TRUNK_RADIUS)} * tcWidth / ${num(BARK_TILE[0])} + 0.5 ) );
	vTcBark = vec2( uv.x * tcAround, uv.y * tcTree.w / ${num(BARK_TILE[1])} );
	vec3 tcWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
	vTcRise = tcWorld.y - tcTree.y;
	vec3 tcMove = tcBreeze( tcWorld, tcTree, 0.0 );
	${MOVE}`,
  );
  shader.vertexShader = vs;
  let fs = shader.fragmentShader;
  fs = after(
    fs,
    "#include <common>",
    `uniform sampler2DArray tcBark;
varying vec2 vTcBark;
varying float vTcRise;
// The bark's tilt, round the trunk and up it, as three's getTangentFrame finds the way of each.
vec3 tcTilt( vec4 g, vec3 n, vec3 position ) {
	vec3 dpx = dFdx( position );
	vec3 dpy = dFdy( position );
	vec2 dux = dFdx( vTcBark );
	vec2 duy = dFdy( vTcBark );
	vec3 dp2perp = cross( dpy, n );
	vec3 dp1perp = cross( n, dpx );
	vec3 t = dp2perp * dux.x + dp1perp * duy.x;
	vec3 b = dp2perp * dux.y + dp1perp * duy.y;
	float det = max( dot( t, t ), dot( b, b ) );
	float scale = det == 0.0 ? 0.0 : inversesqrt( det );
	vec2 d = ( g.rg * 2.0 - 1.0 ) * 1.2;
	return normalize( t * scale * d.x + b * scale * d.y + n * sqrt( max( 1.0 - dot( d, d ), 0.0 ) ) );
}`,
  );
  fs = after(
    fs,
    "#include <color_fragment>",
    `\tvec4 tcGrain = texture( tcBark, vec3( vTcBark, 0.0 ) );
	// Darker at the foot, where soil splashes and moss grows.
	diffuseColor.rgb *= ( 0.6 + 0.8 * tcGrain.a ) * ( 1.0 - 0.35 * tcGrain.b ) * mix( 0.72, 1.0, smoothstep( 0.0, 0.8, vTcRise ) );`,
  );
  fs = after(fs, "#include <normal_fragment_maps>", "\tnormal = tcTilt( tcGrain, normal, - vViewPosition );");
  fs = after(fs, "#include <aomap_fragment>", "\treflectedLight.indirectDiffuse *= 1.0 - 0.4 * tcGrain.b;");
  shader.fragmentShader = fs;
}

/** Far crowns: gone where the tree has cards; mottled like a crown of leaves, in the same greens. */
function patchFar(shader: Shader): void {
  let vs = shader.vertexShader;
  vs = after(vs, "#include <common>", "attribute float tcNear;\nattribute float tcDeciduous;\nvarying vec3 vTcWorld;\nvarying float vTcDeciduous;");
  vs = after(
    vs,
    "#include <begin_vertex>",
    `\ttransformed *= 1.0 - tcNear;
	vTcWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
	vTcDeciduous = tcDeciduous;`,
  );
  shader.vertexShader = vs;
  let fs = shader.fragmentShader;
  fs = after(fs, "#include <common>", `${NOISE}\n${GREENS}\nvarying vec3 vTcWorld;\nvarying float vTcDeciduous;`);
  fs = after(
    fs,
    "#include <color_fragment>",
    `\tfloat tcClump = tcNoise( vTcWorld * 1.1 ) * 0.6 + tcNoise( vTcWorld * 2.7 ) * 0.4;
	diffuseColor.rgb *= tcGreen( tcNoise( vTcWorld * 0.45 + 13.0 ), vTcDeciduous ) * ( 0.3 + 0.7 * ( 0.35 + 0.5 * tcClump ) ) * ${num(FAR_TONE)};`,
  );
  fs = after(fs, "#include <lights_fragment_maps>", `\tradiance *= ${num(SHEEN)};`);
  shader.fragmentShader = fs;
}

/** What is gone where a tree has cards: its far crown or its far trunk, in the picture and in the shadows. */
function patchGone(shader: Shader): void {
  shader.vertexShader = after(shader.vertexShader, "#include <common>", "attribute float tcNear;");
  shader.vertexShader = after(shader.vertexShader, "#include <begin_vertex>", "\ttransformed *= 1.0 - tcNear;");
}

type P3 = [number, number, number];
interface Parts {
  pos: number[];
  nor: number[];
  uv: number[];
  idx: number[];
}

/**
 * A tube along a line of points, of `radii` at each, `sides` round, added to `out`: u round it
 * 0-1, v its length from the start. In the space of a tree one wide and one tall.
 */
function tube(points: readonly P3[], radii: readonly number[], sides: number, out: Parts): void {
  let length = 0;
  for (let k = 0; k < points.length; k++) {
    const p = points[k]!;
    const a0 = points[Math.max(0, k - 1)]!;
    const a1 = points[Math.min(points.length - 1, k + 1)]!;
    const t = new Vector3(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]).normalize();
    const side = new Vector3().crossVectors(t, Math.abs(t.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
    const up = new Vector3().crossVectors(t, side);
    if (k) length += Math.hypot(p[0] - points[k - 1]![0], p[1] - points[k - 1]![1], p[2] - points[k - 1]![2]);
    const base = out.pos.length / 3;
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
      const r = radii[k]!;
      out.pos.push(p[0] + n.x * r, p[1] + n.y * r, p[2] + n.z * r);
      out.nor.push(n.x, n.y, n.z);
      out.uv.push(s / sides, length);
    }
    if (k) {
      for (let s = 0; s < sides; s++) {
        const i0 = base - (sides + 1) + s;
        const j0 = base + s;
        out.idx.push(i0, i0 + 1, j0, i0 + 1, j0 + 1, j0);
      }
    }
  }
}

function geometry(parts: Parts): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(parts.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(parts.nor), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(parts.uv), 2));
  g.setIndex(parts.idx);
  return g;
}

/** A trunk's radius at a height, in the space of a tree one wide and one tall: flared at its foot, tapering up into the crown. */
function trunkRadius(y: number): number {
  const h = Math.max(0, y);
  return TRUNK_RADIUS * (1 + 0.55 * Math.exp(-h / 0.025)) * (1 - 0.88 * Math.pow(Math.min(1, h / 0.7), 1.5));
}

/** Where a trunk is at a height: it leans a little, the more the higher. */
function trunkAt(y: number): P3 {
  return [LEAN * Math.pow(Math.max(0, y) / 0.6, 2), y, 0];
}

/** A bough from the trunk at `from` up, out towards `azimuth` (radians) at `elevation` above level, `length` long. */
function bough(from: number, azimuth: number, elevation: number, length: number, out: Parts, sides = 5): void {
  const start = trunkAt(from);
  const points: P3[] = [];
  const radii: number[] = [];
  const steps = 4;
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    // It rises more steeply as it goes, as a bough reaching for light.
    const el = elevation + 0.25 * u;
    const d = length * u;
    points.push([start[0] + Math.cos(azimuth) * Math.cos(el) * d, start[1] + Math.sin(el) * d, start[2] + Math.sin(azimuth) * Math.cos(el) * d]);
    radii.push(trunkRadius(from) * 0.5 * (1 - 0.92 * u));
  }
  tube(points, radii, sides, out);
}

/** The trunk of every tree in leaf: up into the crown, with three boughs out into it. */
function trunkGeometry(): BufferGeometry {
  const parts: Parts = { pos: [], nor: [], uv: [], idx: [] };
  const ys = [-0.06, 0, 0.012, 0.03, 0.07, 0.14, 0.24, 0.36, 0.48, 0.58, 0.68];
  tube(ys.map(trunkAt), ys.map(trunkRadius), 9, parts);
  bough(0.4, 0.3, 0.75, 0.24, parts);
  bough(0.46, 2.4, 0.85, 0.22, parts);
  bough(0.52, 4.4, 0.7, 0.2, parts);
  return geometry(parts);
}

/** The boughs a deciduous tree shows in winter, besides its trunk's three: longer, and forked. */
function bareGeometry(): BufferGeometry {
  const parts: Parts = { pos: [], nor: [], uv: [], idx: [] };
  const boughs: [number, number, number, number][] = [
    [0.32, 1.2, 0.55, 0.34],
    [0.36, 3.3, 0.6, 0.32],
    [0.42, 5.3, 0.65, 0.33],
    [0.47, 0.9, 0.95, 0.3],
    [0.5, 2.0, 0.6, 0.3],
    [0.55, 3.9, 0.9, 0.28],
    [0.6, 5.6, 1.0, 0.26],
  ];
  for (const [from, azimuth, elevation, length] of boughs) {
    bough(from, azimuth, elevation, length, parts, 4);
    // A fork halfway along, turned aside and up.
    const start = trunkAt(from);
    const half = length * 0.5;
    const fork = from + Math.sin(elevation + 0.12) * half;
    const at: P3 = [start[0] + Math.cos(azimuth) * Math.cos(elevation + 0.12) * half, fork, start[2] + Math.sin(azimuth) * Math.cos(elevation + 0.12) * half];
    const points: P3[] = [];
    const radii: number[] = [];
    for (let k = 0; k <= 3; k++) {
      const u = k / 3;
      const d = length * 0.5 * u;
      const az = azimuth + 0.7;
      const el = elevation + 0.35;
      points.push([at[0] + Math.cos(az) * Math.cos(el) * d, at[1] + Math.sin(el) * d, at[2] + Math.sin(az) * Math.cos(el) * d]);
      radii.push(trunkRadius(from) * 0.22 * (1 - 0.9 * u));
    }
    tube(points, radii, 4, parts);
  }
  return geometry(parts);
}

/**
 * Two cards of leaves crossed: one a metre across facing out of the crown (+z), and a smaller one
 * across it (+y), so that a crown seen edge on still shows leaves. Each is an octagon round its
 * cluster of leaves (crowns.ts leafAtlas keeps them inside a circle), so that the clear corners of
 * a square are not drawn only to be thrown away. The one across reaches further into the crown
 * than out of it, so that the lowest cards do not hang leaves to the ground. Each shows one kind's
 * half of the picture.
 */
function cardGeometry(variant: 0 | 1): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // Corners far enough out that the circle the leaves keep inside touches each side.
  const corner = LEAF_REACH / Math.cos(Math.PI / 8);
  const octagon = (scale: number, place: (a: number, b: number) => P3, normal: P3) => {
    const base = pos.length / 3;
    for (let k = -1; k < 8; k++) {
      const angle = Math.PI / 8 + (k * Math.PI) / 4;
      const a = k < 0 ? 0 : Math.cos(angle) * corner;
      const b = k < 0 ? 0 : Math.sin(angle) * corner;
      pos.push(...place(a * scale, b * scale));
      nor.push(...normal);
      uv.push((variant + 0.5 + a) / 2, 0.5 + b);
    }
    for (let k = 0; k < 8; k++) idx.push(base, base + 1 + k, base + 1 + ((k + 1) % 8));
  };
  octagon(1, (a, b) => [a, b, 0], [0, 0, 1]);
  octagon(CROSS_CARD, (a, b) => [a, 0, -b - CROSS_CARD * 0.2], [0, 1, 0]);
  return geometry({ pos, nor, uv, idx });
}

/** A far crown on a tree one wide and one tall: the map's room for it, rounded, its outline a little uneven. */
function farCrownGeometry(): BufferGeometry {
  const g = new SphereGeometry(0.5, 10, 7);
  const p = g.getAttribute("position") as BufferAttribute;
  const n = g.getAttribute("normal") as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // The same bulge for the same point, so that the seam stays closed.
    const bulge = 0.9 + 0.12 * Math.sin(x * 23.1 + z * 17.3) * Math.cos(y * 19.7 - x * 7.1);
    p.setXYZ(i, x * bulge * 2 * CROWN_HALF_WIDTH * 0.92, CROWN_MIDDLE + y * bulge * 2 * CROWN_HALF_HEIGHT * 0.92, z * bulge * 2 * CROWN_HALF_WIDTH * 0.92);
    const v = new Vector3(x, y / 0.84, z).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** A far tree's trunk, plain: under a crown that far off it is a few pixels. */
function farTrunkGeometry(): BufferGeometry {
  const g = new CylinderGeometry(TRUNK_RADIUS * 0.6, TRUNK_RADIUS * 1.2, 0.62, 6, 1, true);
  g.translate(0, 0.28, 0);
  return g;
}

/** An instanced mesh of a tree part: no picking, no occlusion pass unless `ao`, shadows cast and received. */
function part(geometry: BufferGeometry, material: Material, count: number, ao: boolean): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.userData.noPick = true;
  mesh.userData.noAO = !ao;
  mesh.raycast = () => {};
  return mesh;
}

/** The cards of one kind of leaf: their mesh, its depth drawn first where that pays, and their trees' attributes. */
interface Cards {
  mesh: InstancedMesh;
  depth?: InstancedMesh;
  tree: InstancedBufferAttribute;
  crown: InstancedBufferAttribute;
  deciduous: InstancedBufferAttribute;
}

export class StreetTrees {
  /** Every part of the walker views' trees; CampusScene stands it beside the map's and shows one or the other. */
  readonly group = new Group();
  private atlas: DataTexture;
  private bark: DataArrayTexture;
  private shared: Record<string, IUniform>;
  private leaves: MeshStandardMaterial;
  private leafDepth?: MeshBasicMaterial;
  private trunk: MeshStandardMaterial;
  private far: MeshStandardMaterial;
  private farTrunk: MeshStandardMaterial;
  private gone: MeshDepthMaterial;
  private cardShapes: [BufferGeometry, BufferGeometry];
  private shapes: { trunk: BufferGeometry; bare: BufferGeometry; far: BufferGeometry; farTrunk: BufferGeometry };
  private specs: readonly TreeSpec[] = [];
  private cards: [Cards | undefined, Cards | undefined] = [undefined, undefined];
  private trunks?: InstancedMesh;
  private bareBoughs?: InstancedMesh;
  private near?: InstancedBufferAttribute;
  private centre?: Vector3;
  private month = 0;
  private reach: number;
  /** Milliseconds the last planting took. */
  plantedIn = 0;

  /**
   * `full` on a graphics card (tier "full"), where the cards' depth is drawn before their colour.
   * The leaves are cut out at LEAF_CUTOFF, not smoothed by their cover (alpha to coverage): the
   * page's canvas keeps the picture's alpha, and a leaf's edge drawn part clear lets the page show
   * through it as pale specks.
   */
  constructor(renderer: WebGLRenderer, full: boolean) {
    const atlas = leafAtlas(LEAF_SIZE);
    const leaves = new DataTexture(atlas.levels[0]!, atlas.width, atlas.height, RGBAFormat, UnsignedByteType);
    leaves.mipmaps = atlas.levels.map((data, k) => ({ data, width: Math.max(1, atlas.width >> k), height: Math.max(1, atlas.height >> k) }));
    leaves.colorSpace = NoColorSpace;
    leaves.wrapS = leaves.wrapT = ClampToEdgeWrapping;
    leaves.minFilter = LinearMipmapLinearFilter;
    leaves.magFilter = LinearFilter;
    leaves.generateMipmaps = false;
    // No sharper at a slant than straight on: a crown is many layers of cards, and each look at the
    // picture costs again for each; its mipmaps keep a far crown full.
    leaves.needsUpdate = true;
    this.atlas = leaves;
    const bark = new DataArrayTexture(packBark(BARK_SIZE), BARK_SIZE, BARK_SIZE, 1);
    bark.format = RGBAFormat;
    bark.type = UnsignedByteType;
    bark.wrapS = bark.wrapT = RepeatWrapping;
    bark.minFilter = LinearMipmapLinearFilter;
    bark.magFilter = LinearFilter;
    bark.generateMipmaps = true;
    bark.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    bark.needsUpdate = true;
    this.bark = bark;
    this.shared = {
      tcClock: { value: 0 },
      tcLeafA: { value: new Vector3(...linear(LEAVES.summer[0])) },
      tcLeafB: { value: new Vector3(...linear(LEAVES.summer[1])) },
      tcTurnA: { value: new Vector3(...linear(LEAVES.summer[0])) },
      tcTurnB: { value: new Vector3(...linear(LEAVES.summer[1])) },
      tcTwig: { value: new Vector3(...linear(TWIG)) },
      tcBark: { value: bark },
    };
    const make = (name: string, patch: (s: Shader) => void, o: ConstructorParameters<typeof MeshStandardMaterial>[0]) => {
      const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, ...o });
      m.name = `StreetTrees-${name}`;
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.shared);
        patch(shader);
      };
      m.customProgramCacheKey = () => `street-trees-${name}`;
      return m;
    };
    this.leaves = make("leaves", patchLeaves, { map: leaves, alphaTest: LEAF_CUTOFF, side: DoubleSide });
    if (full) {
      // On a graphics card the cards' depth goes in first, with nothing else (patchLeafDepth), and
      // their colour after it only where it is the nearest leaf; a software renderer, which has no
      // early depth test to gain from it, draws them once (StreetLook.depthFirst).
      const depth = new MeshBasicMaterial({ map: leaves, alphaTest: LEAF_CUTOFF, side: DoubleSide, colorWrite: false });
      depth.name = "StreetTrees-leaf-depth";
      depth.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.shared);
        patchLeafDepth(shader);
      };
      depth.customProgramCacheKey = () => "street-trees-leaf-depth";
      this.leafDepth = depth;
      // Only the leaf in front matches the depth laid for it: the clear parts of cards before it in
      // the picture are not shaded at all. Where the two differ by a hair at the edge of a leaf, the
      // haze the picture is cleared to shows through (StreetLook.render), as the sky would.
      this.leaves.depthWrite = false;
      this.leaves.depthFunc = EqualDepth;
    }
    this.trunk = make("bark", patchBark, { roughness: 0.92 });
    this.trunk.color.setRGB(...linear(BARK));
    this.far = make("far", patchFar, {});
    this.farTrunk = make("far-trunk", patchGone, {});
    this.farTrunk.color.setRGB(...linear(BARK)).multiplyScalar(0.8);
    this.gone = new MeshDepthMaterial();
    this.gone.onBeforeCompile = (shader) => patchGone(shader);
    this.gone.customProgramCacheKey = () => "street-trees-gone";
    this.cardShapes = [cardGeometry(0), cardGeometry(1)];
    this.shapes = { trunk: trunkGeometry(), bare: bareGeometry(), far: farCrownGeometry(), farTrunk: farTrunkGeometry() };
    this.reach = full ? NEAR : NEAR_BASIC;
    this.group.name = "StreetTrees";
    this.group.matrixAutoUpdate = false;
  }

  /** Plants a map's trees: far crowns and trunks for all, boughs for the deciduous; the cards follow the camera. */
  plant(specs: readonly TreeSpec[]): void {
    const start = performance.now();
    this.clear();
    this.specs = specs;
    const count = specs.length;
    const m = new Matrix4();
    const far = part(this.shapes.far, this.far, count, false);
    const farTrunks = part(this.shapes.farTrunk, this.farTrunk, count, false);
    far.customDepthMaterial = farTrunks.customDepthMaterial = this.gone;
    // Each is gone where its tree has cards: one flag for both.
    const near = new InstancedBufferAttribute(new Float32Array(count), 1);
    const deciduous = new InstancedBufferAttribute(new Float32Array(count), 1);
    far.geometry = this.shapes.far.clone();
    far.geometry.setAttribute("tcNear", near);
    far.geometry.setAttribute("tcDeciduous", deciduous);
    farTrunks.geometry = this.shapes.farTrunk.clone();
    farTrunks.geometry.setAttribute("tcNear", near);
    const colours = new Float32Array(count * 3);
    const deciduousTrees = specs.filter((t) => t.deciduous);
    const bare = part(this.shapes.bare, this.trunk, deciduousTrees.length, true);
    specs.forEach((t, i) => {
      treeMatrix(t, m);
      far.setMatrixAt(i, m);
      farTrunks.setMatrixAt(i, m);
      colours.set(t.shade, i * 3);
      deciduous.setX(i, t.deciduous ? 1 : 0);
    });
    deciduousTrees.forEach((t, i) => bare.setMatrixAt(i, treeMatrix(t, m)));
    far.instanceColor = new InstancedBufferAttribute(colours, 3);
    far.count = farTrunks.count = count;
    bare.count = deciduousTrees.length;
    this.bareBoughs = bare;
    this.near = near;
    this.group.add(far, farTrunks, bare);
    this.season();
    this.plantedIn = performance.now() - start;
  }

  /** The month, 1-12: what deciduous trees wear (crowns.ts leafState). */
  setSeason(month: number): void {
    if (month === this.month) return;
    this.month = month;
    this.season();
    // A bare tree has no cards; one in leaf has them again.
    this.centre = undefined;
  }

  /** Keeps the cards on the trees round the camera, laying them out again once it has moved far enough. */
  follow(eye: Vector3): void {
    if (!this.specs.length || (this.centre && this.centre.distanceToSquared(eye) < RELAYOUT * RELAYOUT)) return;
    this.centre = eye.clone();
    this.layout(eye);
  }

  /** The clock the trees sway by, seconds. */
  tick(seconds: number): void {
    this.shared.tcClock!.value = seconds;
  }

  /** How many trees are planted, and how many cards of leaves are drawn round the camera. For tests. */
  count(): { street: number; cards: number } {
    return { street: this.specs.length, cards: (this.cards[0]?.mesh.count ?? 0) + (this.cards[1]?.mesh.count ?? 0) };
  }

  dispose(): void {
    this.clear();
    for (const m of [this.leaves, this.leafDepth, this.trunk, this.far, this.farTrunk, this.gone]) m?.dispose();
    for (const g of [...this.cardShapes, ...Object.values(this.shapes)]) g.dispose();
    this.atlas.dispose();
    this.bark.dispose();
  }

  /** What deciduous trees wear this month; the cards are laid out again after it. */
  private season(): void {
    const state = leafState(this.month, true);
    const [a, b] = LEAVES[state === "evergreen" ? "summer" : state];
    (this.shared.tcTurnA!.value as Vector3).set(...linear(a));
    (this.shared.tcTurnB!.value as Vector3).set(...linear(b));
    if (this.bareBoughs) this.bareBoughs.visible = state === "bare";
  }

  private clear(): void {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      const mesh = o as InstancedMesh;
      // The shapes are kept; the copies carrying a planting's attributes go with it.
      if (!Object.values(this.shapes).includes(mesh.geometry) && !this.cardShapes.includes(mesh.geometry)) mesh.geometry.dispose();
      mesh.dispose();
    }
    this.cards = [undefined, undefined];
    this.trunks = undefined;
    this.centre = undefined;
    this.specs = [];
  }

  /** Cards and trunks for the trees within reach of the camera; every other tree keeps its far crown. */
  private layout(eye: Vector3): void {
    const specs = this.specs;
    const near = this.near!;
    const flags = near.array as Float32Array;
    flags.fill(0);
    const bare = leafState(this.month, true) === "bare";
    const chosen: number[] = [];
    for (let i = 0; i < specs.length; i++) {
      const t = specs[i]!;
      if ((t.x - eye.x) ** 2 + (t.z - eye.z) ** 2 < this.reach * this.reach) {
        chosen.push(i);
        flags[i] = 1;
      }
    }
    near.needsUpdate = true;
    // Trunks with their boughs.
    if (!this.trunks || this.trunks.instanceMatrix.count < chosen.length) {
      if (this.trunks) this.group.remove(this.trunks);
      this.trunks?.dispose();
      this.trunks = part(this.shapes.trunk, this.trunk, Math.ceil(chosen.length * 1.4) + 16, true);
      this.group.add(this.trunks);
    }
    const m = new Matrix4();
    chosen.forEach((i, k) => this.trunks!.setMatrixAt(k, treeMatrix(specs[i]!, m)));
    this.trunks.count = chosen.length;
    this.trunks.instanceMatrix.needsUpdate = true;
    // Cards of leaves, each kind of leaf on a mesh of its own.
    const laid: [number[], number[]] = [[], []];
    for (const i of chosen) {
      const t = specs[i]!;
      if (t.deciduous && bare) continue;
      laid[leafVariant(treeSeed(t.x, -t.z))].push(i);
    }
    const turn = new Matrix4();
    const basis = new Matrix4();
    const x = new Vector3();
    const y = new Vector3();
    const z = new Vector3();
    const at = new Vector3();
    for (const v of [0, 1] as const) {
      const trees = laid[v];
      const all = trees.map((i) => crownCards(treeSeed(specs[i]!.x, -specs[i]!.z), specs[i]!.width, specs[i]!.height));
      const total = all.reduce((n, c) => n + c.length, 0);
      const cards = this.cardMesh(v, total);
      const colour = cards.mesh.instanceColor!;
      let k = 0;
      trees.forEach((i, j) => {
        const t = specs[i]!;
        turn.makeRotationY(t.turn);
        const radius = ((2 * CROWN_HALF_WIDTH * t.width + CROWN_HALF_HEIGHT * t.height) / 3) * 0.9;
        for (const c of all[j]!) {
          z.set(...c.facing).applyMatrix4(turn);
          x.crossVectors(Math.abs(z.y) < 0.95 ? Y_AXIS : X_AXIS, z).normalize();
          y.crossVectors(z, x);
          // Turned about its facing by its roll.
          const cr = Math.cos(c.roll);
          const sr = Math.sin(c.roll);
          const xr = x.clone().multiplyScalar(cr).addScaledVector(y, sr);
          y.crossVectors(z, xr);
          basis.makeBasis(xr.multiplyScalar(c.size), y.multiplyScalar(c.size), z.clone().multiplyScalar(c.size));
          at.set(...c.at).applyMatrix4(turn);
          basis.setPosition(t.x + at.x, t.y + at.y, t.z + at.z);
          cards.mesh.setMatrixAt(k, basis);
          colour.setXYZ(k, t.shade[0] * c.tint, t.shade[1] * c.tint, t.shade[2] * c.tint);
          cards.tree.setXYZW(k, t.x, t.y, t.z, t.height);
          cards.crown.setXYZW(k, t.x, t.y + CROWN_MIDDLE * t.height, t.z, radius);
          cards.deciduous.setX(k, t.deciduous ? 1 : 0);
          k++;
        }
      });
      cards.mesh.count = k;
      if (cards.depth) cards.depth.count = k;
      for (const a of [cards.mesh.instanceMatrix, colour, cards.tree, cards.crown, cards.deciduous]) a.needsUpdate = true;
    }
  }

  /** The cards of one kind of leaf, with room for `count` of them. */
  private cardMesh(variant: 0 | 1, count: number): Cards {
    const had = this.cards[variant];
    if (had && had.mesh.instanceMatrix.count >= count) return had;
    if (had) {
      this.group.remove(had.mesh);
      if (had.depth) this.group.remove(had.depth);
      had.mesh.geometry.dispose();
      had.mesh.dispose();
    }
    const room = Math.ceil(count * 1.4) + 64;
    const g = this.cardShapes[variant].clone();
    const cards: Cards = {
      mesh: part(g, this.leaves, room, false),
      tree: new InstancedBufferAttribute(new Float32Array(room * 4), 4),
      crown: new InstancedBufferAttribute(new Float32Array(room * 4), 4),
      deciduous: new InstancedBufferAttribute(new Float32Array(room), 1),
    };
    g.setAttribute("tcTree", cards.tree);
    g.setAttribute("tcCrown", cards.crown);
    g.setAttribute("tcDeciduous", cards.deciduous);
    cards.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(room * 3), 3);
    if (this.leafDepth) {
      // The same cards, sharing their places: drawn after the ground and before everything at 0.
      const depth = part(g, this.leafDepth, 0, false);
      depth.instanceMatrix = cards.mesh.instanceMatrix;
      depth.castShadow = depth.receiveShadow = false;
      depth.renderOrder = LEAF_DEPTH_ORDER;
      cards.depth = depth;
      this.group.add(depth);
    }
    this.cards[variant] = cards;
    this.group.add(cards.mesh);
    return cards;
  }
}

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

/** Where a tree stands, as the map has it: its size, its turn, its foot. */
function treeMatrix(t: TreeSpec, m: Matrix4): Matrix4 {
  m.makeRotationY(t.turn);
  m.scale(new Vector3(t.width, t.height, t.width));
  return m.setPosition(t.x, t.y, t.z);
}
