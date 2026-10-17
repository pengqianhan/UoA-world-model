// The ground in the walker views, drawn by rule on three's standard material: open ground of
// thin, dry grass worn to bare earth in patches, lawns in parks and in the shade of woods,
// asphalt on roads with white lines down streets and repairs here and there, kerbs and a concrete
// channel along them, footpaths of concrete slabs, steps with treads, railways of ballast,
// sleepers and rails, and still water (water.ts). What each surface is, and where its kerbs and
// lines run, comes from roads.ts; the grain of each from surfaces.ts. None of it says what a real
// street or park looks like.
//
// The map lays its paint (areas, roads, railways) over the ground in layers lifted a little apart
// and draws each in its own colour (CampusScene.setContext). Here the same meshes are drawn with
// these materials instead, and laid back on the ground where a walker stands: the paint is
// lowered to the walker's feet (GROUND_PAINT over the ground), the terrain is lifted to the same,
// and the layers are told apart by the stencil, not by depth. The paint does not write depth: it
// is drawn top layer first, each marking the stencil where it is drawn so that no layer under it
// is drawn there, and is pulled a little towards the eye so that the ground's own mesh, which
// does not quite follow the same triangles, cannot show through it. Nothing that stands on the
// ground is drawn before it, so the pull hides none of it.
//
// Loaded with the first walker view. The map keeps its own materials.
import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  NotEqualStencilFunc,
  RepeatWrapping,
  ReplaceStencilOp,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import {
  CHANNEL,
  DASH,
  DASH_PERIOD,
  EDGE_LINE_IN,
  GAUGE,
  GROUND,
  KERB_FACE,
  KERB_TOP,
  KERB_UNIT,
  LINE_FADE,
  LINE_STOP,
  LINE_WIDTH,
  RAIL_HEAD,
  RAIL_WIDTH,
  ROAD_EDGE_WIDTH,
  ROAD_WIDTH,
  SLAB,
  SLEEPER_LENGTH,
  SLEEPER_SPACING,
  SLEEPER_WIDTH,
  TREAD,
  type GroundKind,
} from "./roads.ts";
import { GROUND_LAYER, GROUND_LAYERS, GROUND_TILE, packGround } from "./surfaces.ts";
import { DEEP, WATER_FRAGMENT, WATER_FRAGMENT_PARS, WATER_ROUGHNESS } from "./water.ts";
import type { RGB } from "./light.ts";

/** Texels across each layer of the ground's grain: under 2 MB in all, with its mipmaps under 3. */
const SURFACE_SIZE = 256;
/**
 * The stencil bit paint on the ground marks: the walker's figure keeps the lowest bit for itself
 * (figure.ts), and every other bit is free.
 */
export const PAINT_STENCIL = 2;
/**
 * Metres the paint is pulled towards the eye, and that much more for every metre away: more than
 * the paint's triangles ever stand under the ground's mesh (under a quarter of a metre on the
 * terrain round the campus), and more than the depth buffer can tell apart far off.
 */
const PULL = 0.35;
const PULL_FAR = 0.004;
/**
 * How much brighter the lit rooms and lamps low round a street are, after dark, than the city's glow
 * a pane reflects on average (light.ts CITY_GLOW): what wet ground and water shine with.
 */
const CITY_LOW = 2.5;
/** Metres of road each repair patch may fall in, and the share of those stretches that have one, on each side. */
const PATCH_SPACING = 11;
const PATCHES = 0.2;

/** Colours of each surface, sRGB; the shader works in linear values. */
const COLOURS = {
  // Open ground: pale compacted earth and fine gravel, and dry grass where it grows.
  earth: 0x978872,
  sward: 0x848b5a,
  // Lawns: their green, where they grow lushest, and the pale tips and dry patches.
  lawn: 0x66803f,
  lush: 0x557a37,
  dry: 0x9a9762,
  // Under trees: fallen leaves here and there in the grass.
  litter: 0x6a5b42,
  // Asphalt and the pale tops of its stones, worn into view; its white lines.
  asphalt: 0x5d5c59,
  chip: 0x8e8a83,
  paint: 0xdcdcd6,
  // Concrete of kerbs, slabs and steps, and of the channel along a street.
  concrete: 0xa5a298,
  channel: 0x96938b,
  // A railway: ballast of crushed basalt, concrete sleepers, the rails' polished heads and rusty sides.
  ballast: 0x6f6c67,
  sleeper: 0x8e8a83,
  steel: 0xc4c4c2,
  rust: 0x6e4b37,
} as const;

/** sRGB to the linear values the shader works in. */
function linear(hex: number): RGB {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as RGB;
}

const num = (x: number) => (Number.isFinite(x) ? x : 0).toFixed(5);
const vec3 = (c: readonly number[]) => `vec3( ${c.map(num).join(", ")} )`;

/** The constants the shader takes from roads.ts and surfaces.ts, so that the numbers live in one place. */
function constants(): string {
  const kinds = Object.entries(GROUND).map(([k, v]) => `#define GD_${k.toUpperCase()} ${v}`);
  // Each layer of the grain, and the metres one repeat of it covers.
  const layers = Object.entries(GROUND_LAYER).map(([k, v]) => `#define GD_L_${k.toUpperCase()} ${v}.0, ${num(GROUND_TILE[v]![0])}`);
  const colours = Object.entries(COLOURS).map(([k, v]) => `const vec3 GD_${k.toUpperCase()} = ${vec3(linear(v))};`);
  return [
    ...kinds,
    ...layers,
    ...colours,
    `const float GD_LINE = ${num(LINE_WIDTH)};`,
    `const float GD_DASH = ${num(DASH)};`,
    `const float GD_DASH_PERIOD = ${num(DASH_PERIOD)};`,
    `const float GD_EDGE_MAJOR = ${num(EDGE_LINE_IN.major)};`,
    `const float GD_EDGE_MOTORWAY = ${num(EDGE_LINE_IN.motorway)};`,
    `const float GD_LINE_STOP = ${num(LINE_STOP)};`,
    `const float GD_LINE_FADE = ${num(LINE_FADE)};`,
    `const float GD_CHANNEL_WIDTH = ${num(CHANNEL)};`,
    `const float GD_PATCH_SPACING = ${num(PATCH_SPACING)};`,
    `const float GD_PATCHES = ${num(PATCHES)};`,
    `const float GD_KERB_FACE = ${num(KERB_FACE)};`,
    `const float GD_KERB_TOP = ${num(KERB_TOP)};`,
    `const float GD_EDGE_HALF = ${num(ROAD_EDGE_WIDTH / 2)};`,
    `const float GD_SLAB = ${num(SLAB)};`,
    `const float GD_KERB_UNIT = ${num(KERB_UNIT)};`,
    `const float GD_TREAD = ${num(TREAD)};`,
    `const float GD_GAUGE = ${num(GAUGE)};`,
    `const float GD_RAIL_HEAD = ${num(RAIL_HEAD)};`,
    `const float GD_SLEEPER_LENGTH = ${num(SLEEPER_LENGTH)};`,
    `const float GD_SLEEPER_WIDTH = ${num(SLEEPER_WIDTH)};`,
    `const float GD_SLEEPER_SPACING = ${num(SLEEPER_SPACING)};`,
  ].join("\n");
}

const VERTEX_PARS = /* glsl */ `
attribute vec3 slope;
attribute vec4 ribbon;
// 1 for the paint the map lays over the ground, 0 for the ground itself.
uniform float gdPaint;
// Metres the map lifted this layer of paint over the ground, less where a walker's feet stand.
uniform float gdDrop;
varying vec3 vGdPos;
varying vec3 vGdNormal;
varying vec4 vGdRibbon;
`;

/** Where the ground's parts go in three's standard vertex shader: after the first, the second. */
const VERTEX: readonly [string, string][] = [
  // The map's paint is lit as level ground; here as the slope it lies on.
  ["#include <beginnormal_vertex>", "\tif ( gdPaint > 0.5 ) objectNormal = slope;"],
  ["#include <begin_vertex>", "\ttransformed.y -= gdDrop * gdPaint;"],
  [
    "#include <project_vertex>",
    `\tif ( gdPaint > 0.5 ) {
		// Towards the eye along its own line of sight, so that it stays where it is in the picture.
		float gdEye = length( mvPosition.xyz );
		float gdPull = min( ${num(PULL)} + ${num(PULL_FAR)} * gdEye, 0.5 * gdEye );
		gl_Position = projectionMatrix * vec4( mvPosition.xyz * ( 1.0 - gdPull / gdEye ), 1.0 );
	}`,
  ],
  [
    "#include <fog_vertex>",
    `\tvGdPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	vGdNormal = normalize( mat3( modelMatrix ) * objectNormal );
	vGdRibbon = ribbon;`,
  ],
];

/** What both the ground's and the water's fragment shaders declare. */
const GROUND_COMMON = /* glsl */ `
uniform sampler2DArray gdSurface;
uniform int gdKind;
// Half the width of a carriageway, path or railway, metres.
uniform float gdHalf;
// How wet the ground is, 0-1.
uniform float gdWet;
// How much stronger the sky's reflection is than the skylight's share of it (light.ts SKYLIGHT).
uniform float gdReflect;
uniform vec3 gdSkyUp;
uniform vec3 gdSkyLow;
uniform vec3 gdGround;
// Light on the ground after dark from the lamps, rooms and clouds of the city the scene does not draw,
// and the glow of the same as a glossy surface reflects it (light.ts, as the windows' panes do).
uniform vec3 gdGlow;
uniform vec3 gdCity;
varying vec3 vGdPos;
varying vec3 vGdNormal;
varying vec4 vGdRibbon;

// The sky as a wet surface reflects it where there is no environment map (phones, software renderers).
vec3 gdSky( vec3 r ) {
	return r.y >= 0.0 ? mix( gdSkyLow, gdSkyUp, sqrt( r.y ) ) : gdGround;
}

// The city's glow after dark as water and wet ground reflect it: from the buildings and lamps
// round the horizon, brighter there than the glow a pane reflects on average, not from the sky overhead.
vec3 gdCityLow( vec3 r ) {
	return gdCity * ${num(CITY_LOW)} * ( 1.0 - smoothstep( 0.0, 0.45, r.y ) );
}
`;

const GROUND_EVALUATE = /* glsl */ `
struct Ground {
	vec3 albedo;
	float roughness;
	float metalness;
	// In the world.
	vec3 normal;
	float occlusion;
	vec3 emissive;
	// How much of the city's light after dark reaches it: streets are lit, lawns and open ground less.
	float lit;
};

// One of the grain's layers at a point, metres east and north: GD_L_* gives the layer and its tile.
vec4 gdGrain( vec2 p, float layer, float tile ) {
	return texture( gdSurface, vec3( p / tile, layer ) );
}

// A normal tilted by the grain: east and north on the surface (t, b), out of it (n).
vec3 gdTilt( vec4 g, float relief, vec3 t, vec3 b, vec3 n ) {
	vec2 d = ( g.rg * 2.0 - 1.0 ) * relief;
	return normalize( t * d.x + b * d.y + n * sqrt( max( 1.0 - dot( d, d ), 0.0 ) ) );
}

// The share of a pixel w wide round x that falls on [a, b] of each whole period, as roads.ts pulse.
float gdPulseSum( float x, float a, float b ) { return floor( x ) * ( b - a ) + clamp( fract( x ), a, b ); }
float gdPulse( float x, float a, float b, float w ) {
	w = max( w, 1e-4 );
	return clamp( ( gdPulseSum( x + 0.5 * w, a, b ) - gdPulseSum( x - 0.5 * w, a, b ) ) / w, 0.0, 1.0 );
}
// The same for one band [a, b], as roads.ts box.
float gdBox( float x, float a, float b, float w ) {
	w = max( w, 1e-4 );
	return clamp( ( clamp( x + 0.5 * w, a, b ) - clamp( x - 0.5 * w, a, b ) ) / w, 0.0, 1.0 );
}

float gdHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

// Which way along a ribbon its first coordinate grows, on the surface: from how it and the
// position change across the pixel (as three's getTangentFrame).
vec3 gdAlong( vec3 n, float along, vec3 fallback ) {
	vec3 dpx = dFdx( vGdPos );
	vec3 dpy = dFdy( vGdPos );
	vec3 t = ( cross( dpy, n ) * dFdx( along ) + cross( n, dpx ) * dFdy( along ) ) * sign( dot( n, cross( dpx, dpy ) ) );
	float l = dot( t, t );
	return l > 1e-24 ? t * inversesqrt( l ) : fallback;
}

// How much of a pixel of carriageway is white line, as roads.ts lineCover.
float gdLines( float along, float across, float run, float wa, float wc ) {
	bool centre = gdKind == GD_STREET || gdKind == GD_MAJOR;
	bool edges = gdKind == GD_MAJOR || gdKind == GD_MOTORWAY;
	float ends = clamp( ( min( along, run - along ) - GD_LINE_STOP ) / GD_LINE_FADE, 0.0, 1.0 );
	float cover = 0.0;
	if ( centre ) {
		cover = gdPulse( along / GD_DASH_PERIOD, 0.0, GD_DASH / GD_DASH_PERIOD, wa / GD_DASH_PERIOD ) * gdBox( across, - 0.5 * GD_LINE, 0.5 * GD_LINE, wc );
	}
	if ( edges ) {
		float inner = gdHalf - ( gdKind == GD_MAJOR ? GD_EDGE_MAJOR : GD_EDGE_MOTORWAY );
		cover = max( cover, gdBox( abs( across ), inner - GD_LINE, inner, wc ) );
	}
	return cover * ends;
}

Ground gdEvaluate() {
	vec3 N = normalize( vGdNormal );
	// East and north on the surface, for the grain.
	vec3 T = normalize( vec3( 1.0, 0.0, 0.0 ) - N * N.x );
	vec3 B = cross( N, T );
	vec2 xz = vec2( vGdPos.x, - vGdPos.z );
	// The broad variation, turned so that its grid does not line up with streets that run east or north.
	vec4 broad = gdGrain( mat2( 0.8, 0.6, - 0.6, 0.8 ) * xz, GD_L_MACRO );
	float along = vGdRibbon.x;
	float across = vGdRibbon.y;
	// Metres a pixel spans along the ribbon and across it.
	float wa = max( fwidth( along ), 1e-4 );
	float wc = max( fwidth( across ), 1e-4 );

	vec3 albedo = vec3( 0.5 );
	vec3 n = N;
	float roughness = 0.9;
	float metalness = 0.0;
	float occlusion = 1.0;
	// What rain does: how dark it soaks the surface, whether it turns glossy, and how readily water stands on it.
	float soak = 0.6;
	float hard = 0.0;
	float hollow = 0.0;
	float lit = 1.0;
	vec4 s = vec4( 0.5 );

	if ( gdKind == GD_OPEN ) {
		// Open ground: a thin, dry sward with tufts in it, worn to bare earth in broad patches.
		s = gdGrain( xz, GD_L_GROUND );
		float bare = smoothstep( 0.6, 0.92, broad.a * 0.9 + ( 1.0 - s.b ) * 0.1 );
		vec3 sward = mix( GD_SWARD, GD_LAWN, s.b * 0.2 ) * ( 0.84 + 0.32 * s.a ) * ( 0.88 + 0.24 * broad.g );
		vec3 earth = GD_EARTH * ( 0.8 + 0.4 * s.a ) * ( 0.9 + 0.2 * broad.g );
		albedo = mix( sward, earth, bare );
		lit = 0.4;
		n = gdTilt( s, 1.0, T, B, N );
		roughness = 0.94;
		soak = mix( 0.8, 0.62, bare );
	} else if ( gdKind <= GD_PITCH ) {
		// A park, grass, a pitch or the ground under trees: a lawn. A pitch is kept more evenly; under
		// trees the grass is in shade, darker, with fallen leaves here and there.
		s = gdGrain( xz, GD_L_TURF );
		float even = gdKind == GD_PITCH ? 0.45 : 1.0;
		vec3 c = GD_LAWN * ( 1.0 + ( s.a - 0.5 ) * 0.75 * even );
		c = mix( c, GD_LUSH, clamp( ( broad.b - 0.4 ) * 1.5, 0.0, 1.0 ) * 0.7 * even );
		c = mix( c, GD_DRY, clamp( s.b * 0.8 + ( broad.a - 0.62 ) * 1.4 * even, 0.0, 1.0 ) * 0.55 );
		c *= 0.88 + 0.24 * mix( 0.5, broad.g, even );
		if ( gdKind == GD_WOOD ) c = mix( c * 0.8, GD_LITTER * ( 0.8 + 0.4 * s.a ), smoothstep( 0.5, 0.85, broad.r * 0.8 + s.b * 0.3 ) * 0.7 );
		albedo = c;
		// The blades lie every way: they show more as flecks of colour than as relief.
		n = gdTilt( s, 0.55, T, B, N );
		roughness = 0.86;
		soak = 0.82;
		lit = 0.35;
	} else if ( gdKind == GD_EDGE ) {
		// The strip under a street shows outside its carriageway: the kerb's face, its top, the footpath.
		vec3 Tr = gdAlong( N, along, T );
		vec3 outward = cross( N, Tr ) * sign( across );
		// Metres out from the edge of the carriageway.
		float beyond = abs( across ) - ( vGdRibbon.z - GD_EDGE_HALF );
		float face = 1.0 - gdBox( beyond, GD_KERB_FACE, 1e3, wc );
		float top = gdBox( beyond, GD_KERB_FACE, GD_KERB_FACE + GD_KERB_TOP, wc );
		float foot = max( 1.0 - face - top, 0.0 );
		s = gdGrain( xz, GD_L_CONCRETE );
		// Joints across the kerb's units and the footpath's slabs, and along where the two meet.
		float joints = ( face + top ) * ( 1.0 - gdPulse( along / GD_KERB_UNIT, 0.006 / GD_KERB_UNIT, 1.0, wa / GD_KERB_UNIT ) );
		joints += foot * ( 1.0 - gdPulse( along / GD_SLAB, 0.008 / GD_SLAB, 1.0, wa / GD_SLAB ) );
		joints = max( joints, gdBox( beyond, GD_KERB_FACE + GD_KERB_TOP - 0.005, GD_KERB_FACE + GD_KERB_TOP + 0.005, wc ) );
		albedo = GD_CONCRETE * ( 0.86 + 0.28 * s.a ) * ( 0.9 + 0.2 * broad.g ) * ( 1.0 - 0.5 * joints ) * mix( 1.0, 0.9, face );
		n = gdTilt( s, 0.6, T, B, N );
		// The face stands up out of the channel, turned to the road; the top's front edge is rounded.
		n = normalize( mix( n, normalize( N * 0.35 - outward ), face ) );
		float arris = top * ( 1.0 - smoothstep( 0.0, 0.035, beyond - GD_KERB_FACE ) );
		n = normalize( mix( n, normalize( N - outward * 0.7 ), arris ) );
		occlusion = mix( 1.0, 0.5 + 0.5 * smoothstep( 0.0, GD_KERB_FACE, beyond ), face ) * ( 1.0 - 0.3 * joints );
		roughness = 0.86;
		soak = 0.68;
		hard = 1.0;
		hollow = foot * 0.3;
	} else if ( gdKind == GD_PATH ) {
		// Concrete slabs: a joint across every few paces, one down the middle, each slab a tone of its own.
		s = gdGrain( xz, GD_L_CONCRETE );
		float slab = floor( along / GD_SLAB );
		float tone = gdHash( vec2( slab, step( 0.0, across ) * 7.0 + 3.0 ) );
		float joints = 1.0 - gdPulse( along / GD_SLAB, 0.008 / GD_SLAB, 1.0, wa / GD_SLAB );
		joints = max( joints, gdBox( across, - 0.004, 0.004, wc ) );
		// Dirt along the edges, where the ground meets the path.
		float edge = smoothstep( gdHalf - 0.15, gdHalf, abs( across ) );
		albedo = GD_CONCRETE * ( 0.84 + 0.28 * s.a ) * ( 0.93 + 0.14 * tone ) * ( 0.88 + 0.24 * broad.g ) * ( 1.0 - 0.45 * joints ) * ( 1.0 - 0.22 * edge );
		n = gdTilt( s, 0.6, T, B, N );
		occlusion = 1.0 - 0.3 * joints;
		roughness = 0.85;
		soak = 0.68;
		hard = 1.0;
		hollow = 0.3;
	} else if ( gdKind == GD_STEPS ) {
		// Treads, level whatever the slope; the riser down from each nosing faces down the slope.
		s = gdGrain( xz, GD_L_CONCRETE );
		vec3 Tr = gdAlong( N, along, T );
		vec3 down = vec3( N.x, 0.0, N.z );
		float fall = length( down );
		down = fall > 1e-3 ? down / fall : Tr;
		bool descending = dot( Tr, down ) >= 0.0;
		float x = along / GD_TREAD;
		float w = wa / GD_TREAD;
		// Seen from below, each riser shows as a face; from above it is hidden, and only the line of
		// shade under each nosing marks the step.
		float facing = smoothstep( 0.0, 0.35, dot( normalize( cameraPosition - vGdPos ), down ) );
		float r = 0.04 + 0.16 * facing;
		float riser = descending ? gdPulse( x, 1.0 - r, 1.0, w ) : gdPulse( x, 0.0, r, w );
		float nosing = descending ? gdPulse( x, 0.92 - r, 1.0 - r, w ) : gdPulse( x, r, r + 0.08, w );
		float back = descending ? gdPulse( x, 0.0, 0.18, w ) : gdPulse( x, 0.82, 1.0, w );
		vec3 up = vec3( 0.0, 1.0, 0.0 );
		vec3 level = vec3( 1.0, 0.0, 0.0 );
		n = gdTilt( s, 0.6, level, vec3( 0.0, 0.0, - 1.0 ), up );
		n = normalize( mix( n, normalize( down + up * 0.25 ), riser * facing ) );
		albedo = GD_CONCRETE * ( 0.84 + 0.28 * s.a ) * ( 0.9 + 0.2 * broad.g ) * ( 1.0 + 0.14 * nosing ) * ( 1.0 - 0.45 * riser * ( 1.0 - facing ) );
		occlusion = 1.0 - 0.3 * back - riser * mix( 0.5, 0.15, facing );
		roughness = 0.84;
		soak = 0.66;
		hard = 1.0;
	} else if ( gdKind == GD_RAIL ) {
		// Ballast, sleepers across it, and two rails on them.
		s = gdGrain( xz, GD_L_BALLAST );
		albedo = GD_BALLAST * ( 0.62 + 0.76 * s.a ) * ( 1.0 - 0.65 * s.b );
		n = gdTilt( s, 1.0, T, B, N );
		roughness = 0.95;
		occlusion = 1.0 - 0.4 * s.b;
		vec3 Tr = gdAlong( N, along, T );
		vec3 Br = cross( N, Tr );
		float sleeper = gdBox( abs( across ), - 1.0, 0.5 * GD_SLEEPER_LENGTH, wc ) * gdPulse( along / GD_SLEEPER_SPACING, 0.0, GD_SLEEPER_WIDTH / GD_SLEEPER_SPACING, wa / GD_SLEEPER_SPACING );
		albedo = mix( albedo, GD_SLEEPER * ( 0.85 + 0.3 * s.a ), sleeper );
		n = normalize( mix( n, N, sleeper ) );
		roughness = mix( roughness, 0.85, sleeper );
		occlusion = mix( occlusion, 1.0, sleeper );
		float side = abs( abs( across ) - 0.5 * GD_GAUGE );
		float rail = gdBox( side, - 1.0, 0.5 * GD_RAIL_HEAD, wc );
		float web = gdBox( side, 0.5 * GD_RAIL_HEAD, 0.5 * GD_RAIL_HEAD + 0.05, wc );
		albedo = mix( albedo, GD_RUST, web * 0.8 );
		occlusion *= 1.0 - 0.45 * web;
		albedo = mix( albedo, GD_STEEL, rail );
		metalness = rail;
		roughness = mix( roughness, 0.28, rail );
		// The head of a rail is rounded across.
		float across0 = ( abs( across ) - 0.5 * GD_GAUGE ) / ( 0.5 * GD_RAIL_HEAD );
		n = normalize( mix( n, normalize( N + Br * sign( across ) * clamp( across0, - 1.0, 1.0 ) * 0.6 ), rail ) );
		soak = 0.7;
		hard = 0.5;
	} else {
		// Asphalt: a service lane, a street, a major road or a motorway.
		s = gdGrain( xz, GD_L_ASPHALT );
		// A second, coarser look at the same grain, turned, so that its repeat does not show; where
		// every look costs more (phones, software renderers), the broad variation does without it.
		#ifdef GD_LITE
			vec4 s2 = vec4( 0.5, 0.5, 0.5, broad.r );
		#else
			vec4 s2 = gdGrain( mat2( 0.6, - 0.8, 0.8, 0.6 ) * xz * 0.27, GD_L_ASPHALT );
		#endif
		vec3 c = GD_ASPHALT * ( 0.78 + 0.44 * s.a ) * ( 0.9 + 0.2 * s2.a );
		c = mix( c, GD_CHIP, s.b * 0.4 );
		c *= 0.86 + 0.28 * broad.g;
		roughness = 0.9;
		float side = abs( across );
		vec3 Tr = gdAlong( N, along, T );
		vec3 Br = cross( N, Tr );
		// Now and then a patch where the road was dug up and laid again: newer asphalt, darker, in a
		// rectangle across part of one side. Where each falls comes from the road's length and the side.
		float stretch = floor( along / GD_PATCH_SPACING );
		float draw = gdHash( vec2( stretch, vGdRibbon.w * 0.731 + step( 0.0, across ) * 17.0 ) );
		if ( draw < GD_PATCHES ) {
			float start = fract( draw * 37.13 ) * 0.5 * GD_PATCH_SPACING;
			float span = 1.2 + fract( draw * 71.31 ) * 3.5;
			float inner = fract( draw * 13.97 ) * 0.6 * gdHalf;
			float area = gdBox( along - stretch * GD_PATCH_SPACING, start, start + span, wa ) * gdBox( side, inner, inner + 0.7 + fract( draw * 5.71 ) * 1.6, wc );
			c = mix( c, GD_ASPHALT * ( 0.66 + 0.2 * s.a ), area * 0.85 );
			roughness = mix( roughness, 0.82, area );
		}
		if ( gdKind == GD_STREET || gdKind == GD_MAJOR ) {
			// A lane each way: the wheels polish two tracks along each, and cars drip oil between them.
			float fromLane = abs( side - 0.5 * gdHalf );
			float tracks = smoothstep( 0.35, 0.75, fromLane ) * ( 1.0 - smoothstep( 1.0, 1.4, fromLane ) );
			float oil = ( 1.0 - smoothstep( 0.1, 0.45, fromLane ) ) * smoothstep( 0.35, 0.85, broad.b * 0.6 + s2.a * 0.5 );
			c *= 1.0 + 0.05 * tracks - 0.12 * oil;
			roughness -= 0.06 * tracks;
			// A concrete channel along each side, against the kerb.
			float channel = gdBox( side, gdHalf - GD_CHANNEL_WIDTH, 1e3, wc );
			c = mix( c, GD_CHANNEL * ( 0.85 + 0.3 * s.a ), channel );
			roughness = mix( roughness, 0.8, channel );
			hollow = channel * 0.7;
		}
		// The road is crowned: it falls a little to each side.
		n = gdTilt( s, 0.9, T, B, N );
		n = normalize( n + Br * sign( across ) * 0.02 );
		float line = gdLines( along, across, vGdRibbon.w, wa, wc );
		c = mix( c, GD_PAINT * ( 0.78 + 0.3 * s.a ) * ( 0.9 + 0.1 * broad.a ), line );
		roughness = mix( roughness, 0.62, line );
		n = normalize( mix( n, N, line * 0.7 ) );
		albedo = c;
		soak = mix( 0.5, 0.8, line );
		hard = 1.0;
		hollow = max( hollow, 0.35 );
	}

	// Rain darkens what it soaks into, turns hard surfaces glossy, and stands in their hollows.
	albedo *= mix( 1.0, soak, gdWet );
	roughness = mix( roughness, mix( 0.62, 0.3, hard ), gdWet );
	float standing = gdWet * hard * smoothstep( 0.6, 0.76, broad.b * 0.55 + ( 1.0 - s.a ) * 0.25 + hollow * 0.35 );
	albedo *= 1.0 - 0.35 * standing;
	roughness = mix( roughness, 0.03, standing );
	n = normalize( mix( n, N, standing ) );

	// What a glossy surface reflects that the environment map does not hold: after dark, low down,
	// the glow of the city's lamps and lit rooms; and where there is no environment map, the sky.
	vec3 V = normalize( cameraPosition - vGdPos );
	vec3 R = reflect( - V, n );
	float f = 0.04 + 0.96 * pow( 1.0 - clamp( dot( n, V ), 0.0, 1.0 ), 5.0 );
	float gloss = 1.0 - roughness;
	gloss *= gloss * gloss;
	vec3 emissive = f * gloss * gdCityLow( R );
	#ifndef USE_ENVMAP
		emissive += f * gloss * gdSky( R );
	#endif
	return Ground( albedo, roughness, metalness, n, occlusion, emissive, lit );
}
`;

type Patch = readonly [string, string];

/** Puts each piece in after its place in a shader, or refuses if the place is not there. */
function insert(source: string, patches: readonly Patch[], what: string): string {
  let out = source;
  for (const [after, add] of patches) {
    if (!out.includes(after)) throw new Error(`three's shaders have changed: "${after}" is not where ${what} expects it`);
    out = out.replace(after, `${after}\n${add}`);
  }
  return out;
}

/** The ground's own parts in three's standard fragment shader. */
const GROUND_FRAGMENT: readonly Patch[] = [
  ["#include <color_fragment>", "\tGround gd = gdEvaluate();\n\tdiffuseColor.rgb *= gd.albedo;"],
  ["#include <roughnessmap_fragment>", "\troughnessFactor = gd.roughness;"],
  ["#include <metalnessmap_fragment>", "\tmetalnessFactor = gd.metalness;"],
  ["#include <normal_fragment_maps>", "\tnormal = normalize( ( viewMatrix * vec4( gd.normal, 0.0 ) ).xyz );"],
  ["#include <emissivemap_fragment>", "\ttotalEmissiveRadiance += gd.emissive;"],
  ["#include <lights_fragment_maps>", "\tradiance *= gdReflect;\n\tirradiance += gdGlow * gd.lit;"],
  ["#include <aomap_fragment>", "\treflectedLight.indirectDiffuse *= gd.occlusion;\n\treflectedLight.indirectSpecular *= gd.occlusion;"],
];

function patch(shader: WebGLProgramParametersWithUniforms, water: boolean, lite: boolean): void {
  const what = water ? "water.ts" : "ground.ts";
  shader.vertexShader = insert(shader.vertexShader, [["#include <common>", VERTEX_PARS], ...VERTEX], what);
  const pars = water ? `${GROUND_COMMON}\n${WATER_FRAGMENT_PARS}` : `${GROUND_COMMON}\n${GROUND_EVALUATE}`;
  const defines = lite ? "#define GD_LITE\n" : "";
  shader.fragmentShader = insert(shader.fragmentShader, [["#include <common>", `${defines}${constants()}\n${pars}`], ...(water ? WATER_FRAGMENT : GROUND_FRAGMENT)], what);
}

/** What the ground is lit by, from the street look's light (light.ts). */
export interface GroundLight {
  /** How wet the ground is, 0-1. */
  wet: number;
  /** How much stronger the sky's reflection is than the scene's share of the skylight. */
  reflect: number;
  /** The sky and the ground as a wet surface reflects them without an environment map. */
  skyUp: RGB;
  skyLow: RGB;
  ground: RGB;
  /** Light on the ground after dark from the city round it, and the city's glow as glossy ground and water reflect it. */
  glow: RGB;
  city: RGB;
}

/** Half the width each kind of paint is drawn, metres: the carriageway, path or track bed. */
function halfWidth(kind: GroundKind): number {
  if (kind === "rail") return RAIL_WIDTH / 2;
  return kind in ROAD_WIDTH ? ROAD_WIDTH[kind as keyof typeof ROAD_WIDTH] / 2 : 0;
}

export class StreetGround {
  /** The ground itself: the terrain's meshes and the plane round them. */
  readonly open: MeshStandardMaterial;
  private texture: DataArrayTexture;
  private shared: Record<string, IUniform>;
  private paints = new Map<GroundKind, MeshStandardMaterial>();
  private lite: boolean;

  /**
   * `lite` where every texture read costs dearly (the basic tier: phones and software renderers):
   * the grain is read less sharply at a slant, and asphalt once rather than twice.
   */
  constructor(renderer: WebGLRenderer, lite: boolean) {
    this.lite = lite;
    const n = SURFACE_SIZE;
    const texture = new DataArrayTexture(packGround(n), n, n, GROUND_LAYERS);
    texture.format = RGBAFormat;
    texture.type = UnsignedByteType;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    // The ground is seen at a slant from a walker's height: sharp along it, without shimmer.
    texture.anisotropy = Math.min(lite ? 2 : 8, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.texture = texture;
    this.shared = {
      gdSurface: { value: texture },
      gdWet: { value: 0 },
      gdReflect: { value: 1 },
      gdSkyUp: { value: new Vector3() },
      gdSkyLow: { value: new Vector3() },
      gdGround: { value: new Vector3() },
      gdGlow: { value: new Vector3() },
      gdCity: { value: new Vector3() },
      gdClock: { value: 0 },
    };
    this.open = this.make("open", false);
    // The ground is drawn only where no paint was drawn over it.
    Object.assign(this.open, { stencilWrite: true, stencilFunc: NotEqualStencilFunc, stencilRef: PAINT_STENCIL, stencilFuncMask: PAINT_STENCIL, stencilWriteMask: 0 });
  }

  /**
   * The material for one kind of paint, `drop` metres lower than the map lays it, so that it lies
   * where a walker's feet stand. One for each kind; all but the water's share one program.
   */
  paint(kind: Exclude<GroundKind, "open">, drop: number): MeshStandardMaterial {
    let m = this.paints.get(kind);
    if (!m) {
      m = this.make(kind, true);
      // Drawn top layer first, each marking where it is drawn, so that nothing under it is drawn there too.
      Object.assign(m, {
        depthWrite: false,
        stencilWrite: true,
        stencilFunc: NotEqualStencilFunc,
        stencilRef: PAINT_STENCIL,
        stencilFuncMask: PAINT_STENCIL,
        stencilWriteMask: PAINT_STENCIL,
        stencilZPass: ReplaceStencilOp,
      });
      this.paints.set(kind, m);
    }
    (m.userData.drop as IUniform<number>).value = drop;
    return m;
  }

  setLight(l: GroundLight): void {
    const u = this.shared;
    u.gdWet!.value = l.wet;
    u.gdReflect!.value = l.reflect;
    (u.gdSkyUp!.value as Vector3).set(...l.skyUp);
    (u.gdSkyLow!.value as Vector3).set(...l.skyLow);
    (u.gdGround!.value as Vector3).set(...l.ground);
    (u.gdGlow!.value as Vector3).set(...l.glow);
    (u.gdCity!.value as Vector3).set(...l.city);
  }

  /** The clock the water's ripples drift by, seconds. */
  tick(seconds: number): void {
    this.shared.gdClock!.value = seconds;
  }

  dispose(): void {
    this.open.dispose();
    for (const m of this.paints.values()) m.dispose();
    this.paints.clear();
    this.texture.dispose();
  }

  private make(kind: GroundKind, paint: boolean): MeshStandardMaterial {
    const water = kind === "water";
    const m = new MeshStandardMaterial({ color: 0xffffff, roughness: water ? WATER_ROUGHNESS : 0.9, metalness: 0 });
    if (water) m.color.setRGB(...DEEP);
    m.name = `StreetGround-${kind}`;
    const own = { gdKind: { value: GROUND[kind] }, gdHalf: { value: halfWidth(kind) }, gdPaint: { value: paint ? 1 : 0 }, gdDrop: { value: 0 } };
    m.userData.drop = own.gdDrop;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.shared, own);
      patch(shader, water, this.lite);
    };
    m.customProgramCacheKey = () => `${water ? "street-water" : "street-ground"}${this.lite ? "-lite" : ""}`;
    return m;
  }
}
