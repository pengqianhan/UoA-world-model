// Ponds and fountains in the walker views: still water drawn on the outlines OpenStreetMap gives,
// on three's standard material. It is dark in itself and shows the sky: little of it looking down
// into it, most of it at a slant, as water does (Schlick's fresnel from its 2% reflectance head on).
// Two sets of ripples drift across it at their own speeds and angles, so that the reflection
// wavers and the sun glints in it; nothing else is reflected, since that would mean drawing the
// scene a second time. Its colour, ripples and glint are drawn by rule, not known.
//
// ground.ts makes the material: the water lies on the ground as the other paint does, and takes
// the ground's vertex shader, grain texture and light.
import { GROUND_LAYER, GROUND_TILE } from "./surfaces.ts";
import type { RGB } from "./light.ts";

/** The colour of the water's depths, linear; how rough its surface is between ripples; the share of light it reflects head on. */
export const DEEP: RGB = [0.008, 0.021, 0.025];
export const WATER_ROUGHNESS = 0.05;
export const WATER_F0 = 0.02;
/** How much steeper the ripples are drawn than the grain layer holds them: a breath of wind on still water. */
const RIPPLE = 0.9;
/** Metres per second each set of ripples drifts, east and north, and the metres one repeat of it covers. */
const DRIFT_A: [number, number] = [0.045, 0.026];
const DRIFT_B: [number, number] = [-0.031, 0.052];
const TILE_A = 6.3;
const TILE_B = 2.7;
/** The brightest the sun's glint is drawn: over the bloom's threshold by day (light.ts BLOOM_THRESHOLD_DAY), not much over. */
export const WATER_GLINT = 14;

const num = (x: number) => x.toFixed(5);
const RIPPLE_TILE = GROUND_TILE[GROUND_LAYER.ripple]![0];

/** What the water's fragment shader adds to the standard one, after the ground's declarations (ground.ts GROUND_COMMON). */
export const WATER_FRAGMENT_PARS = /* glsl */ `
uniform float gdClock;

// The water's surface: its normal in the world, from two sets of ripples drifting over each other.
// The second set is read turned, and its tilt turned back.
vec3 wtNormal() {
	vec2 p = vec2( vGdPos.x, - vGdPos.z );
	vec4 a = texture( gdSurface, vec3( ( p - vec2( ${num(DRIFT_A[0])}, ${num(DRIFT_A[1])} ) * gdClock ) / ${num(TILE_A)}, ${GROUND_LAYER.ripple}.0 ) );
	vec2 q = mat2( 0.8, 0.6, - 0.6, 0.8 ) * p;
	vec4 b = texture( gdSurface, vec3( ( q - vec2( ${num(DRIFT_B[0])}, ${num(DRIFT_B[1])} ) * gdClock ) / ${num(TILE_B)}, ${GROUND_LAYER.ripple}.0 ) );
	vec2 tilt = ( a.rg - 0.5 ) * ${num((2 * RIPPLE * RIPPLE_TILE) / TILE_A)} + mat2( 0.8, - 0.6, 0.6, 0.8 ) * ( b.rg - 0.5 ) * ${num((RIPPLE * RIPPLE_TILE) / TILE_B)};
	return normalize( vec3( tilt.x, 1.0, - tilt.y ) );
}
`;

/** Where the water's own parts go in three's standard fragment shader: after the first, the second. */
export const WATER_FRAGMENT: readonly [string, string][] = [
  ["#include <normal_fragment_maps>", "\tvec3 wtN = wtNormal();\n\tnormal = normalize( ( viewMatrix * vec4( wtN, 0.0 ) ).xyz );"],
  // Water reflects 2% head on, not the 4% three gives every other surface that is not a metal.
  ["#include <lights_physical_fragment>", `\tmaterial.specularColor = vec3( ${num(WATER_F0)} );\n\tmaterial.specularColorBlended = vec3( ${num(WATER_F0)} );`],
  [
    "#include <emissivemap_fragment>",
    `\t{
		// After dark, the city's glow low down round it; without an environment map, the sky as the
		// windows reflect it (light.ts). Each as strongly as fresnel gives.
		vec3 V = normalize( cameraPosition - vGdPos );
		vec3 R = reflect( - V, wtN );
		float f = ${num(WATER_F0)} + ${num(1 - WATER_F0)} * pow( 1.0 - clamp( dot( wtN, V ), 0.0, 1.0 ), 5.0 );
		totalEmissiveRadiance += f * gdCityLow( R );
		#ifndef USE_ENVMAP
			totalEmissiveRadiance += f * gdSky( R );
		#endif
	}`,
  ],
  ["#include <lights_fragment_maps>", "\tradiance *= gdReflect;"],
  // The sun is a light of no size here: its glint is held under a bright but finite peak.
  ["#include <lights_fragment_end>", `\treflectedLight.directSpecular = min( reflectedLight.directSpecular, vec3( ${num(WATER_GLINT)} ) );`],
];
