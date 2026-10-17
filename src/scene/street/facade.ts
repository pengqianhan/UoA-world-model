// The walls and roofs of every building in the walker views, drawn by rule on three's standard
// material: storeys and bays from the outlines (rules.ts), a style of wall per building, window
// openings set back in the wall with frames, sills and the glass in them, a room behind each pane
// and blinds in some, lit or dark after dark, and the grain of plaster, brick, concrete, stone,
// glass and boards (surfaces.ts). The window grid is worked out per pixel from what each vertex
// carries (MeshBuilder's facade attributes), so one material draws the 2,800 buildings round the
// campus and one more the University's. Nothing about a real facade is known: it is all drawn by
// rule, and says nothing about the real walls, doors or windows. There are no doors.
//
// Loaded with the first walker view. The map keeps its own materials, which ignore what is added
// here to the geometry.
import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  ShaderChunk,
  UnsignedByteType,
  Vector3,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { FLAT_ROOFS, LANE, LIT_PERIOD, PITCHED_ROOFS, PLINTH, SEED_STEPS, STYLE, STYLES, type StyleSpec } from "./rules.ts";
import { LAYER, LAYERS, LAYER_TILE, packSurfaces, surfaces } from "./surfaces.ts";
import type { RGB } from "./light.ts";

/** The two kinds of building, each with a material of its own: the University's and the city's round it. */
export type FacadeKind = "university" | "city";

/** Texels across each layer of the grain: 2 MB in all, with its mipmaps under 3. */
const SURFACE_SIZE = 256;
/** Share of rooms with their light on after dark: fewer in the University's buildings than in the city's. */
const LIT_SHARE: Record<FacadeKind, number> = { university: 0.36, city: 0.44 };
/** Metres from the glass to the back of the room behind it. */
const ROOM_DEPTH = 4.5;
/** Metres of a window frame, of a bar between panes, of a joint between concrete panels. */
const FRAME = 0.055;
const BAR = 0.05;
const PANEL_JOINT = 0.02;
/** How much float glass reflects head on, and the share of light it lets through. */
const GLASS_F0: RGB = [0.06, 0.066, 0.064];
const GLASS_TRANSMIT = 0.82;
/** The brightest a glint of the sun in a pane is drawn: enough to bloom a little by day (light.ts BLOOM_THRESHOLD_DAY). */
const GLINT = 12;
/** Mortar, and the stone or concrete of sills and lintels. sRGB. */
const MORTAR = 0xb4afa5;
const TRIM = 0xd9d4c9;
/** The plinth at the foot of every wall. sRGB. */
const PLINTH_COLOUR = 0x99948a;
/** What a building sunk to its footprint beside an open one fades to: about the ground's tone. sRGB. */
const AWAY = 0xcfcabd;
/**
 * Lamps after dark, warm to cool, and the share of rooms each lights (the rest of the share goes to
 * the last); then how bright a lit room is drawn, in the scene's units (a white wall in sun is about 1).
 */
const LIGHTS: RGB[] = [
  [1, 0.7, 0.42],
  [1, 0.79, 0.55],
  [1, 0.88, 0.74],
  [0.72, 0.78, 0.85],
];
const LAMP_SHARES = [0.35, 0.35, 0.22];
const LIT_LEVEL = 0.8;

/**
 * The share of a window that is glass, the rest frame and bars, for a storey of a typical height:
 * what a window far off, too small for its frames to be drawn, is on average.
 */
function glazed(s: StyleSpec): number {
  const w = (s.window[1] - s.window[0]) * s.bay;
  const h = (s.window[3] - s.window[2]) * 3.4;
  let share = ((w - 2 * FRAME) * (h - 2 * FRAME)) / (w * h);
  if (s.panes > 1) share *= 1 - ((s.panes - 1) * BAR) / w;
  if (s.transom > 0) share *= 1 - BAR / h;
  return share;
}

/** sRGB to the linear values the shader works in. */
function linear(hex: number): RGB {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as RGB;
}

const num = (x: number) => (Number.isFinite(x) ? x : 0).toFixed(5);
const vec3 = (c: readonly number[]) => `vec3( ${c.map(num).join(", ")} )`;

/**
 * Where things are in a kind's table (`table`), in fours: each style's window, form, finish, glass
 * and colours, then the roofs' colours, the layers' tiles, the lamps, and the colours themselves.
 */
const STYLE_ROWS = 5;
const ROOF_AT = STYLES.length * STYLE_ROWS;
const TILE_AT = ROOF_AT + 1;
const LAMP_AT = TILE_AT + LAYERS;
const COLOUR_AT = LAMP_AT + LIGHTS.length;

/**
 * Everything the shader looks up by a building's style, as one array of fours. Kept in uniforms,
 * which the graphics chip indexes as it goes, where constant arrays in the shader may be copied
 * out for every pixel.
 */
function table(kind: FacadeKind): Float32Array {
  const rows: number[][] = [];
  const colours: number[][] = [];
  const run = (list: number[]): [number, number] => {
    const start = COLOUR_AT + colours.length;
    for (const c of list) colours.push([...linear(c), 0]);
    return [start, list.length];
  };
  const styleRows = STYLES.map((s) => {
    const walls = run(kind === "university" ? s.university : s.city);
    const frames = run(s.frames);
    return [
      [...s.window],
      // recess, panes, transom, sill + 2 x lintel
      [s.recess, s.panes, s.transom, (s.sill ? 1 : 0) + (s.lintel ? 2 : 0)],
      // roughness, relief, layer, how much the grain's tone shows
      [s.roughness, s.relief, s.layer, s.layer === 1 || s.layer === 3 ? 1 : 0.6],
      [glazed(s), 0, 0, 0],
      [...walls, ...frames],
    ];
  });
  for (const r of styleRows) rows.push(...r);
  rows.push([...run(FLAT_ROOFS), ...run(PITCHED_ROOFS)]);
  for (const [x, y] of LAYER_TILE) rows.push([x, y, 0, 0]);
  for (const c of LIGHTS) rows.push([...c, 0]);
  rows.push(...colours);
  return Float32Array.from(rows.flat());
}

/** The constants the shader takes from rules.ts and surfaces.ts, so that the numbers live in one place. */
function constants(kind: FacadeKind): string {
  return [
    `#define FC_TABLE_SIZE ${table(kind).length / 4}`,
    `#define FC_STYLE_ROWS ${STYLE_ROWS}`,
    `#define FC_ROOF_AT ${ROOF_AT}`,
    `#define FC_TILE_AT ${TILE_AT}`,
    `#define FC_LAMP_AT ${LAMP_AT}`,
    `const float FC_LIT_SHARE = ${num(LIT_SHARE[kind])};`,
    `const float FC_LIT_PERIOD = ${num(LIT_PERIOD)};`,
    `const uint FC_LANE_WINDOW = ${LANE.window}u;`,
    `const uint FC_LANE_LIT = ${LANE.lit}u;`,
    `const float FC_SEED_STEPS = ${num(SEED_STEPS)};`,
    `const float FC_PLINTH = ${num(PLINTH)};`,
    `const float FC_ROOM = ${num(ROOM_DEPTH)};`,
    `const float FC_FRAME = ${num(FRAME)};`,
    `const float FC_BAR = ${num(BAR)};`,
    `const float FC_PANEL_JOINT = ${num(PANEL_JOINT)};`,
    `const float FC_LIT_LEVEL = ${num(LIT_LEVEL)};`,
    `const float FC_TRANSMIT = ${num(GLASS_TRANSMIT)};`,
    `const float FC_GLINT = ${num(GLINT)};`,
    `const vec3 FC_GLASS = ${vec3(GLASS_F0)};`,
    `const vec3 FC_MORTAR = ${vec3(linear(MORTAR))};`,
    `const vec3 FC_TRIM = ${vec3(linear(TRIM))};`,
    `const vec3 FC_PLINTH_COLOUR = ${vec3(linear(PLINTH_COLOUR))};`,
    `const vec3 FC_AWAY = ${vec3(linear(AWAY))};`,
    `const int FC_BRICK = ${STYLE.brick};`,
    `const int FC_CONCRETE = ${STYLE.concrete};`,
    `const int FC_STONE = ${STYLE.stone};`,
    `const int FC_GLASS_WALL = ${STYLE.glass};`,
  ].join("\n");
}

/** pcg4d (Jarzynski and Olano 2020): four whole numbers to four; rules.ts pcg4d is the same in JavaScript. */
const PCG = /* glsl */ `
uvec4 fcPcg( uvec4 v ) {
	v = v * 1664525u + 1013904223u;
	v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
	v ^= v >> 16u;
	v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
	return v;
}
`;

const VERTEX_PARS = /* glsl */ `
attribute vec4 facade;
attribute vec4 facadeStoreys;
varying vec4 vFcA;
varying vec4 vFcB;
varying vec3 vFcPos;
varying vec3 vFcNormal;
varying vec4 vFcBuilding;
${PCG}
`;

const VERTEX = /* glsl */ `
	// Street facades (facade.ts): what the vertex carries, and where it stands in the world.
	vFcA = facade;
	vFcB = facadeStoreys;
	vFcPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	vFcNormal = normalize( mat3( modelMatrix ) * objectNormal );
	// The building's own draws, the same at each of its vertices: its colour, its frames, its roof, and one more.
	vFcBuilding = vec4( fcPcg( uvec4( uint( fract( facade.w ) * ${num(SEED_STEPS)} + 0.5 ), 65535u, 65535u, 3u ) ) ) / 4294967296.0;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2DArray fcSurface;
uniform vec3 fcSun;
uniform float fcGlow;
uniform float fcClock;
uniform vec3 fcInterior;
uniform vec3 fcBlind;
uniform vec3 fcSkyUp;
uniform vec3 fcSkyLow;
uniform vec3 fcGround;
uniform vec3 fcCity;
uniform float fcReflect;
// 0-1: how far the building has sunk to its footprint beside an open one (CampusScene focus).
uniform float fcAway;
uniform vec4 fcTable[ FC_TABLE_SIZE ];
varying vec4 vFcA;
varying vec4 vFcB;
varying vec3 vFcPos;
varying vec3 vFcNormal;
varying vec4 vFcBuilding;

// The facade's frame in the world: along the wall (or across a roof), up it, and out of it.
vec3 fcT;
vec3 fcB;

struct Facade {
	vec3 albedo;
	float roughness;
	float metalness;
	// Tangent space: x along, y up, z out of the surface.
	vec3 normal;
	vec3 emissive;
	float occlusion;
	float sun;
	float reflect;
};

${PCG}
// Four numbers 0-1 for one window (rules.ts windowLanes): whether its light is on.
vec4 fcLanes( uint seed, float i, float j, uint lane ) {
	return vec4( fcPcg( uvec4( seed, uint( i ), uint( j ), lane ) ) ) / 4294967296.0;
}
// Four more, cheaper, for how it looks: its lamp, its blind and how far down (Dave Hoskins, "Hash
// without Sine"). Whole-number multiplies are slow on some graphics chips; these are not.
vec4 fcLook( vec3 p ) {
	vec4 p4 = fract( p.xyzx * vec4( 0.1031, 0.1030, 0.0973, 0.1099 ) );
	p4 += dot( p4, p4.wzxy + 33.33 );
	return fract( ( p4.xxyz + p4.yzzw ) * p4.zywx );
}

// The share of a pixel w wide round x that falls on [a, b] of each whole period: a stripe drawn
// without stepping as it shrinks with distance, where it fades to its average instead.
float fcPulseSum( float x, float a, float b ) { return floor( x ) * ( b - a ) + clamp( fract( x ), a, b ); }
float fcPulse( float x, float a, float b, float w ) {
	w = max( w, 1e-4 );
	return clamp( ( fcPulseSum( x + 0.5 * w, a, b ) - fcPulseSum( x - 0.5 * w, a, b ) ) / w, 0.0, 1.0 );
}
// The same for one band [a, b], a <= b.
float fcBox( float x, float a, float b, float w ) {
	w = max( w, 1e-4 );
	return clamp( ( clamp( x + 0.5 * w, a, b ) - clamp( x - 0.5 * w, a, b ) ) / w, 0.0, 1.0 );
}
float fcRect( vec2 p, vec2 lo, vec2 hi, float w ) { return fcBox( p.x, lo.x, hi.x, w ) * fcBox( p.y, lo.y, hi.y, w ); }

// Whether the light reaches a point of an opening, depth metres into the wall: the line from it
// towards the light must leave through the opening.
float fcSunlit( vec2 at, float depth, vec2 lo, vec2 hi, vec3 l, float w ) {
	if ( l.z <= 0.0 ) return 0.0;
	return fcRect( at + l.xy / max( l.z, 0.03 ) * depth, lo, hi, w );
}

// One of a run of colours in the table, from where it starts and how many, by a number 0-1.
vec3 fcPick( float start, float count, float chance ) {
	return fcTable[ int( start ) + min( int( chance * count ), int( count ) - 1 ) ].rgb;
}

// The sky as a pane reflects it where there is no environment map (phones, software renderers).
vec3 fcSky( vec3 r ) {
	return r.y >= 0.0 ? mix( fcSkyLow, fcSkyUp, sqrt( r.y ) ) : fcGround;
}

// What is seen of the room behind a pane: the line of sight from the glass, at depth d, to the
// first of the room's sides it meets. By day the room is lit by the window, by night by its own
// light when it is on.
vec3 fcRoom( vec2 q, vec3 v, vec2 lo, vec2 hi, vec3 dayColour, vec3 light ) {
	// Far off a pixel's share of a window can come from beyond its room: keep to the room.
	q = clamp( q, lo, hi );
	vec2 dir = - v.xy / max( v.z, 0.08 );
	dir = mix( dir, vec2( 1e-4 ), step( abs( dir ), vec2( 1e-4 ) ) );
	vec2 s2 = ( mix( lo, hi, step( 0.0, dir ) ) - q ) / dir;
	float s = clamp( min( s2.x, s2.y ), 0.0, FC_ROOM );
	// Back wall, side wall, floor, ceiling.
	vec4 day = vec4( 0.5, 0.42, 0.3, 0.46 );
	vec4 night = vec4( 0.62, 0.5, 0.42, 1.0 );
	float d; float n;
	if ( s >= FC_ROOM ) { d = day.x; n = night.x; }
	else if ( s2.x < s2.y ) { d = day.y; n = night.y; }
	else if ( dir.y < 0.0 ) { d = day.z; n = night.z; }
	else { d = day.w; n = night.w; }
	return dayColour * d * exp( - s * 0.28 ) + light * n;
}

Facade fcEvaluate() {
	Facade f = Facade( vec3( 0.5 ), 0.9, 0.0, vec3( 0.0, 0.0, 1.0 ), vec3( 0.0 ), 1.0, 1.0, 1.0 );

	vec3 N = normalize( vFcNormal );
	vec3 V = normalize( cameraPosition - vFcPos );
	int sty = clamp( int( vFcA.w ), 0, ${STYLES.length - 1} );
	uint seed = uint( fract( vFcA.w ) * FC_SEED_STEPS + 0.5 );
	float part = vFcB.w;
	vec4 b4 = vFcBuilding;

	bool level = abs( N.y ) > 0.5;
	if ( part > 2.5 ) {
		// A pitched roof: across the slope, and up it.
		vec3 c = cross( vec3( 0.0, 1.0, 0.0 ), N );
		fcT = dot( c, c ) > 1e-6 ? normalize( c ) : vec3( 1.0, 0.0, 0.0 );
	} else {
		fcT = level ? vec3( 1.0, 0.0, 0.0 ) : normalize( vec3( N.z, 0.0, - N.x ) );
	}
	fcB = level || part > 2.5 ? normalize( cross( N, fcT ) ) : vec3( 0.0, 1.0, 0.0 );

	// Roofs and soffits are laid out from the building's anchor; walls along and up.
	vec2 st = level || part > 1.5 ? vec2( dot( vFcA.xyz, fcT ), dot( vFcA.xyz, fcB ) ) : vFcA.xy;
	int at = sty * FC_STYLE_ROWS;
	vec4 finish = fcTable[ at + 2 ];
	// Soffits are rendered whatever the walls are made of.
	int layer = part > 2.5 ? ${LAYER.sheet} : part > 1.5 ? ${LAYER.roof} : level ? ${LAYER.plaster} : int( finish.z );
	vec4 grain = texture( fcSurface, vec3( st / fcTable[ FC_TILE_AT + layer ].xy, float( layer ) ) );
	// Broad patches over a whole wall, so that a large one is not one even tone: a coarse mipmap of
	// the plaster, which is all blots at that size, read without filtering along the wall.
	vec4 patches = textureLod( fcSurface, vec3( st / 23.0 + b4.zw * 17.0, ${LAYER.plaster}.0 ), 4.0 );

	// What the window grid needs, worked out here where every pixel takes part.
	// Only an upright wall has a face to count along; elsewhere the vertex holds a position.
	bool upright = ! level && part < 1.5;
	float along = upright ? vFcA.x : 0.0;
	float up = vFcA.y;
	float bay = upright && part < 0.5 ? max( vFcA.z, 0.0 ) : 0.0;
	float storeyH = max( vFcB.x, 0.5 );
	float groundH = max( vFcB.y, 0.5 );
	float top = vFcB.z;
	float v = up < groundH ? up / groundH : 1.0 + ( up - groundH ) / storeyH;
	float u = bay > 0.0 ? along / bay : 0.0;
	float wu = fwidth( u );
	float wv = fwidth( v );
	// Metres a pixel spans on the surface.
	float mpp = max( max( fwidth( st.x ), fwidth( st.y ) ), 1e-4 );
	vec2 g = grain.rg * 2.0 - 1.0;
	float gz = sqrt( max( 1.0 - dot( g, g ), 0.0 ) );

	if ( part > 1.5 ) {
		// A flat roof of gritted membrane, or a pitched one of painted corrugated steel.
		bool pitched = part > 2.5;
		vec4 roofs = fcTable[ FC_ROOF_AT ];
		vec3 c = pitched ? fcPick( roofs.z, roofs.w, b4.z ) : fcPick( roofs.x, roofs.y, b4.z );
		f.albedo = c * ( 1.0 + ( grain.a - 0.5 ) * 0.7 ) * ( 1.0 + ( patches.a - 0.5 ) * 0.4 );
		f.albedo *= 1.0 - 0.4 * grain.b;
		f.roughness = pitched ? 0.5 : 0.93;
		f.normal = normalize( vec3( g * ( pitched ? 1.0 : 0.7 ), gz ) );
	} else {
		// The wall itself.
		vec4 colours = fcTable[ at + 4 ];
		vec3 wall = fcPick( colours.x, colours.y, b4.x );
		vec3 albedo = wall * ( 1.0 + ( grain.a - 0.5 ) * finish.w ) * ( 1.0 + ( patches.a - 0.5 ) * 0.3 );
		vec3 joint = sty == FC_BRICK ? FC_MORTAR : wall * ( sty == FC_STONE ? 0.78 : 0.42 );
		albedo = mix( albedo, joint, grain.b );
		float roughness = finish.x;
		float metalness = sty == FC_GLASS_WALL ? 0.6 : 0.0;
		vec3 n = normalize( vec3( g * finish.y, gz ) );
		float occlusion = 1.0;

		// Panels a bay wide and a storey high.
		if ( sty == FC_CONCRETE && bay > 0.0 ) {
			float ju = FC_PANEL_JOINT / bay;
			float jv = FC_PANEL_JOINT / storeyH;
			float panel = fcPulse( u + 0.5 * ju, ju, 1.0, wu ) * fcPulse( v + 0.5 * jv, jv, 1.0, wv );
			albedo *= mix( 0.45, 1.0, panel );
			occlusion *= mix( 0.6, 1.0, panel );
		}
		// A plinth along the foot, and the foot darker where rain splashes.
		float plinth = 1.0 - fcBox( up, FC_PLINTH, 1e6, mpp );
		albedo = mix( albedo, FC_PLINTH_COLOUR * ( 1.0 + ( grain.a - 0.5 ) * 0.5 ), plinth );
		roughness = mix( roughness, 0.92, plinth );
		metalness *= 1.0 - plinth;
		albedo *= mix( 0.88, 1.0, smoothstep( 0.0, 1.8, up ) );

		// Windows: a whole storey's, in every bay of a face with room for one.
		float i = floor( u );
		float j = floor( v );
		float vTop = top < groundH ? top / groundH : 1.0 + ( top - groundH ) / storeyH;
		float zone = ( part < 0.5 && bay > 0.0 && j > - 0.5 && j + 1.0 <= vTop + 0.02 ) ? 1.0 : 0.0;
		vec4 win = fcTable[ at ];
		vec4 form = fcTable[ at + 1 ];
		float open = zone * fcPulse( u, win.x, win.y, wu ) * fcPulse( v, win.z, win.w, wv );
		float sunlit = 1.0;
		vec3 emissive = vec3( 0.0 );
		float reflectGain = 1.0;

		if ( zone > 0.0 ) {
			float cellH = j < 0.5 ? groundH : storeyH;
			float floorY = j < 0.5 ? 0.0 : groundH + ( j - 1.0 ) * storeyH;
			vec2 p = vec2( along, up );
			vec2 lo = vec2( ( i + win.x ) * bay, floorY + win.z * cellH );
			vec2 hi = vec2( ( i + win.y ) * bay, floorY + win.w * cellH );
			// A sill under the window and a lintel over it, with the shadow line under the sill.
			bool hasSill = mod( form.w, 2.0 ) > 0.5;
			float sill = hasSill ? fcRect( p, vec2( lo.x - 0.05, lo.y - 0.07 ), vec2( hi.x + 0.05, lo.y ), mpp ) : 0.0;
			float under = hasSill ? fcRect( p, vec2( lo.x - 0.05, lo.y - 0.12 ), vec2( hi.x + 0.05, lo.y - 0.07 ), mpp ) : 0.0;
			float lintel = form.w > 1.5 ? fcRect( p, vec2( lo.x - 0.12, hi.y ), vec2( hi.x + 0.12, hi.y + 0.17 ), mpp ) : 0.0;
			// Rain runs off the sill and stains the wall below it in streaks, fading as they go down.
			float below = lo.y - 0.12 - up;
			// Far off, where a pixel is wider than the streaks, they are drawn as their average.
			float runs = mix( 0.5, 0.5 + 0.5 * sin( p.x * 23.0 + sin( p.x * 7.3 + i ) * 2.0 ), 1.0 - smoothstep( 0.03, 0.1, mpp ) );
			float streak = hasSill ? fcBox( p.x, lo.x + 0.04, hi.x - 0.04, mpp ) * step( 0.0, below ) * exp( - below * ( 1.2 + 1.5 * runs ) ) * runs : 0.0;
			albedo *= 1.0 - 0.12 * streak * ( 0.4 + b4.w );
			// Sills and lintels are cast stone or concrete: smooth, whatever the wall is laid in.
			float trim = max( sill, lintel );
			albedo = mix( albedo, FC_TRIM * ( 1.0 + ( patches.a - 0.5 ) * 0.4 ), trim );
			roughness = mix( roughness, 0.8, trim );
			n = normalize( mix( n, vec3( 0.0, 0.0, 1.0 ), lintel ) );
			n = normalize( mix( n, vec3( 0.0, 0.28, 0.96 ), sill ) );
			occlusion *= 1.0 - 0.45 * under;

			if ( open > 0.0 ) {
				// How the window looks: its lamp, its blind and how far the blind is down.
				vec4 w4 = fcLook( vec3( i, j, float( seed ) * 0.0137 ) );
				// Far off each window fades to what windows are on average, rather than flicker.
				float vary = smoothstep( 1.5, 4.0, 1.0 / max( max( wu, wv ), 1e-4 ) );
				// After dark, whether its light is on: drawn again every so often, at a moment of its own.
				float lit = 0.0;
				if ( fcGlow > 0.0 ) {
					float phase = fcLanes( seed, i, j, FC_LANE_WINDOW ).x;
					lit = fcLanes( seed, i, j, FC_LANE_LIT + uint( floor( max( fcClock, 0.0 ) / FC_LIT_PERIOD + phase ) ) ).x < FC_LIT_SHARE ? 1.0 : 0.0;
				}
				lit = mix( FC_LIT_SHARE, lit, vary );
				int lampAt = w4.y < ${num(LAMP_SHARES[0]!)} ? 0 : w4.y < ${num(LAMP_SHARES[0]! + LAMP_SHARES[1]!)} ? 1 : w4.y < ${num(LAMP_SHARES[0]! + LAMP_SHARES[1]! + LAMP_SHARES[2]!)} ? 2 : 3;
				vec3 lamp = fcTable[ FC_LAMP_AT + lampAt ].rgb * FC_LIT_LEVEL * ( 0.75 + 0.6 * fract( w4.y * 7.31 ) );
				// A room with its light off is not quite black: light spills from a corridor or a screen.
				vec3 light = lamp * mix( 0.025, 1.0, lit ) * fcGlow * ( 1.0 - fcAway );
				vec3 dayColour = fcInterior * mix( 0.75, 1.15, fract( w4.y * 3.7 ) );
				float cover = w4.z < 0.45 ? 0.0 : w4.z < 0.85 ? 0.15 + 0.6 * w4.w : 1.0;
				cover = mix( 0.33, cover, vary );
				vec3 blindColour = mix( vec3( 0.86, 0.84, 0.8 ), vec3( 0.7, 0.71, 0.72 ), step( 0.5, fract( w4.w * 5.3 ) ) );
				vec3 blindLight = fcBlind * blindColour + lamp * lit * fcGlow * ( 1.0 - fcAway ) * 0.3;

				bool curtain = sty == FC_GLASS_WALL;
				vec3 F0 = curtain ? wall * 1.4 : FC_GLASS;
				vec3 frame = fcPick( colours.z, colours.w, b4.y );
				vec3 vt = vec3( dot( V, fcT ), dot( V, fcB ), dot( V, N ) );
				float facing = clamp( vt.z, 0.0, 1.0 );
				vec3 fresnel = F0 + ( 1.0 - F0 ) * pow( 1.0 - facing, 5.0 );

				// Far off the opening is flat, and its frames, room and blind are what they are on average.
				float near = 1.0 - smoothstep( 0.035, 0.09, mpp );
				float glassPlane = 1.0;
				float glazing = fcTable[ at + 3 ].x;
				vec3 behind = mix( dayColour * 0.42 + light * 0.6, blindLight, cover );
				float revealSun = 1.0;
				float glassSun = 1.0;
				float meet = 1.0;
				float edge = 1.0;
				vec3 revealN = vec3( 0.0, 0.0, 1.0 );
				vec3 glassN = vec3( 0.0, 0.0, 1.0 );
				if ( near > 0.0 ) {
					// Close to, the glass stands back in the wall: the line of sight meets it further on,
					// or meets the side of the opening first.
					float d = form.x * near;
					vec3 lt = vec3( dot( fcSun, fcT ), dot( fcSun, fcB ), dot( fcSun, N ) );
					vec2 shift = vt.xy / max( vt.z, 0.08 ) * d;
					vec2 q = p - shift;
					glassPlane = fcRect( q, lo, hi, mpp );
					vec2 past = clamp( max( lo - q, q - hi ) / max( abs( shift ), vec2( 1e-5 ) ), 0.0, 1.0 );
					meet = 1.0 - max( past.x, past.y );
					revealN = past.x > past.y ? vec3( q.x < lo.x ? 1.0 : - 1.0, 0.0, 0.0 ) : vec3( 0.0, q.y < lo.y ? 1.0 : - 1.0, 0.0 );
					revealSun = fcSunlit( p - shift * meet, d * meet, lo, hi, lt, mpp );
					glassSun = fcSunlit( q, d, lo, hi, lt, mpp );
					// Frames round the panes, bars between them and a transom across.
					vec2 size = hi - lo;
					vec2 lq = q - lo;
					float pane = fcRect( lq, vec2( FC_FRAME ), size - vec2( FC_FRAME ), mpp );
					float paneW = size.x / form.y;
					float bars = form.y > 1.5 ? fcPulse( lq.x / paneW + 0.5 * FC_BAR / paneW, FC_BAR / paneW, 1.0, mpp / paneW ) : 1.0;
					float transom = form.z > 0.0 ? 1.0 - fcBox( lq.y, form.z * size.y - 0.5 * FC_BAR, form.z * size.y + 0.5 * FC_BAR, mpp ) : 1.0;
					glazing = mix( glazing, pane * bars * transom, near );
					// The room behind, and the blind in front of it, its slats 25 mm apart.
					vec3 room = fcRoom( q, vt, vec2( i * bay, floorY + 0.02 ), vec2( ( i + 1.0 ) * bay, floorY + cellH - 0.3 ), dayColour, light );
					float blind = fcBox( lq.y, size.y * ( 1.0 - cover ), size.y + 1.0, mpp ) * step( 0.01, cover );
					float slats = mix( 0.72, 1.0, fcPulse( lq.y / 0.025, 0.0, 0.8, mpp / 0.025 ) );
					behind = mix( behind, mix( room, blindLight * slats, blind ), near );
					vec2 inside = min( lq, size - lq );
					edge = mix( 1.0, 0.62 + 0.38 * smoothstep( 0.0, 0.35, min( inside.x, inside.y ) ), near );
					// Toughened glass is not quite flat, which shows in what it reflects.
					if ( curtain ) glassN = normalize( vec3( g * 0.6 * near, gz ) );
				}
				vec3 glassEmit = ( 1.0 - fresnel ) * FC_TRANSMIT * behind + fresnel * fcCity;
				#ifndef USE_ENVMAP
					glassEmit += fresnel * fcSky( reflect( - V, N ) ) * 0.9;
				#endif

				float glassW = open * glassPlane * glazing;
				float frameW = open * glassPlane * ( 1.0 - glazing );
				float revealW = open * ( 1.0 - glassPlane );
				float wallW = 1.0 - open;
				albedo = albedo * wallW + albedo * 1.04 * revealW + frame * frameW + F0 * glassW;
				roughness = roughness * ( wallW + revealW ) + 0.38 * frameW + ( curtain ? 0.05 : 0.04 ) * glassW;
				metalness = metalness * wallW + ( curtain ? 0.7 : 0.0 ) * frameW + glassW;
				n = normalize( n * wallW + mix( n, revealN, 0.85 ) * revealW + vec3( 0.0, 0.0, 1.0 ) * frameW + glassN * glassW );
				emissive += glassEmit * glassW;
				occlusion *= wallW + revealW * ( 0.62 + 0.38 * meet ) + ( frameW + glassW ) * edge;
				sunlit = wallW + revealW * revealSun + ( frameW + glassW ) * glassSun;
				reflectGain = 1.0 + ( fcReflect - 1.0 ) * glassW;
			}
		}

		f.albedo = albedo;
		f.roughness = roughness;
		f.metalness = metalness;
		f.normal = n;
		f.emissive = emissive;
		f.occlusion = occlusion;
		f.sun = sunlit;
		f.reflect = reflectGain;
	}
	// A building sunk to its footprint beside an open one recedes to a pale ground tone.
	f.albedo = mix( f.albedo, FC_AWAY, 0.75 * fcAway );
	f.metalness *= 1.0 - fcAway;
	return f;
}
`;

/** The places in three's standard shaders the facade goes in, each found or the material refuses. */
const LIGHT_LOOP = "getDirectionalLightInfo( directionalLight, directLight );";

function patch(shader: WebGLProgramParametersWithUniforms, kind: FacadeKind): void {
  const swap = (source: string, from: string, to: string) => {
    if (!source.includes(from)) throw new Error(`three's shaders have changed: "${from}" is not where facade.ts expects it`);
    return source.replace(from, to);
  };
  let vs = shader.vertexShader;
  vs = swap(vs, "#include <common>", `#include <common>\n${VERTEX_PARS}`);
  vs = swap(vs, "#include <fog_vertex>", `#include <fog_vertex>\n${VERTEX}`);
  shader.vertexShader = vs;

  const lights = ShaderChunk.lights_fragment_begin;
  if (!lights.includes(LIGHT_LOOP)) throw new Error("three's lights_fragment_begin has changed: facade.ts cannot shade the window recesses");
  let fs = shader.fragmentShader;
  fs = swap(fs, "#include <common>", `#include <common>\n${constants(kind)}\n${FRAGMENT_PARS}`);
  fs = swap(fs, "#include <color_fragment>", "#include <color_fragment>\n\tFacade fc = fcEvaluate();\n\tdiffuseColor.rgb *= fc.albedo;");
  fs = swap(fs, "#include <roughnessmap_fragment>", "float roughnessFactor = fc.roughness;");
  fs = swap(fs, "#include <metalnessmap_fragment>", "float metalnessFactor = fc.metalness;");
  fs = swap(
    fs,
    "#include <normal_fragment_maps>",
    `#include <normal_fragment_maps>
	{
		vec3 tv = normalize( ( viewMatrix * vec4( fcT, 0.0 ) ).xyz );
		vec3 bv = normalize( ( viewMatrix * vec4( fcB, 0.0 ) ).xyz );
		normal = normalize( tv * fc.normal.x + bv * fc.normal.y + normal * fc.normal.z );
	}`,
  );
  fs = swap(fs, "#include <emissivemap_fragment>", "totalEmissiveRadiance += fc.emissive;");
  fs = swap(fs, "#include <lights_fragment_begin>", lights.replace(LIGHT_LOOP, `${LIGHT_LOOP}\n\t\tdirectLight.color *= fc.sun;`));
  // The sun is a light of no size here, so a pane would mirror it thousands of times brighter
  // than the sky draws its disc (SUN_PEAK); the glint is held to a little over the bloom's threshold.
  fs = swap(fs, "#include <lights_fragment_maps>", "#include <lights_fragment_maps>\n\tradiance *= fc.reflect;\n\treflectedLight.directSpecular = min( reflectedLight.directSpecular, vec3( FC_GLINT ) );");
  fs = swap(fs, "#include <aomap_fragment>", "#include <aomap_fragment>\n\treflectedLight.indirectDiffuse *= fc.occlusion;\n\treflectedLight.indirectSpecular *= fc.occlusion;");
  shader.fragmentShader = fs;
}

/** What the facades are lit by, from the street look's light (light.ts). */
export interface FacadeLight {
  /** Towards the scene's directional light, the sun or the moon, in the world. */
  sun: Vector3;
  /** How much the lit rooms show, 0 by day to 1 after dark. */
  glow: number;
  /** A room's walls by day, and a blind, as seen through the glass. */
  interior: RGB;
  blind: RGB;
  /** The sky and the ground as a pane reflects them without an environment map. */
  skyUp: RGB;
  skyLow: RGB;
  ground: RGB;
  /** The city's glow after dark, as a pane reflects it. */
  city: RGB;
  /** How much stronger the environment's reflection is in glass than the scene's skylight share. */
  reflect: number;
}

export class StreetFacades {
  private texture: DataArrayTexture;
  private shared: Record<string, IUniform>;
  private tables: Record<FacadeKind, IUniform<Float32Array>>;
  private made: MeshStandardMaterial[] = [];

  constructor(renderer: WebGLRenderer) {
    const n = SURFACE_SIZE;
    const texture = new DataArrayTexture(packSurfaces(surfaces(n), n), n, n, LAYERS);
    texture.format = RGBAFormat;
    texture.type = UnsignedByteType;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    // Walls are mostly seen at a slant: sharp along them, without shimmer.
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.texture = texture;
    this.shared = {
      fcSurface: { value: texture },
      fcSun: { value: new Vector3(0, 1, 0) },
      fcGlow: { value: 0 },
      fcClock: { value: 0 },
      fcInterior: { value: new Vector3() },
      fcBlind: { value: new Vector3() },
      fcSkyUp: { value: new Vector3() },
      fcSkyLow: { value: new Vector3() },
      fcGround: { value: new Vector3() },
      fcCity: { value: new Vector3() },
      fcReflect: { value: 1 },
    };
    this.tables = { university: { value: table("university") }, city: { value: table("city") } };
  }

  /**
   * A material for one kind of building. The University's buildings take one each, for their
   * tint and for sinking beside an open one (setAway); all of a kind share one program.
   */
  material(kind: FacadeKind): MeshStandardMaterial {
    const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    m.name = `StreetFacade-${kind}`;
    m.userData.away = { value: 0 } satisfies IUniform;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.shared, { fcAway: m.userData.away, fcTable: this.tables[kind] });
      patch(shader, kind);
    };
    m.customProgramCacheKey = () => `street-facade-${kind}`;
    this.made.push(m);
    return m;
  }

  /**
   * How far a material's buildings have sunk to their footprints beside an open building, 0-1:
   * they fade to the ground's tone, as on the map, and their rooms go dark.
   */
  setAway(m: MeshStandardMaterial, away: number): void {
    (m.userData.away as IUniform<number>).value = away;
  }

  setLight(l: FacadeLight): void {
    const u = this.shared;
    (u.fcSun!.value as Vector3).copy(l.sun).normalize();
    u.fcGlow!.value = l.glow;
    (u.fcInterior!.value as Vector3).set(...l.interior);
    (u.fcBlind!.value as Vector3).set(...l.blind);
    (u.fcSkyUp!.value as Vector3).set(...l.skyUp);
    (u.fcSkyLow!.value as Vector3).set(...l.skyLow);
    (u.fcGround!.value as Vector3).set(...l.ground);
    (u.fcCity!.value as Vector3).set(...l.city);
    u.fcReflect!.value = l.reflect;
  }

  /** The slow clock rooms switch their lights by, minutes. */
  tick(minutes: number): void {
    this.shared.fcClock!.value = minutes;
  }

  dispose(): void {
    for (const m of this.made) m.dispose();
    this.made = [];
    this.texture.dispose();
  }
}
