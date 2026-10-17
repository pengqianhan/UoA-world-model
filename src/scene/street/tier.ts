// How much the street-level views can afford on this device, decided before the renderer is made:
// a renderer that keeps a half-float picture for the walker views is made that way from the start.
// A software renderer (CI's SwiftShader, Mesa's llvmpipe) draws every pixel on the processor, and a
// phone has little to spare, so both draw the street look straight to the screen, without effects.

/** "full": high dynamic range, ambient occlusion and bloom. "basic": tone mapping in the materials. */
export type StreetTier = "full" | "basic";

/** Renderers that draw on the processor, by the name they give. */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|basic render|software/i.test(name);
}

/** The name the graphics driver gives itself, where the browser tells it. */
function rendererName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
}

/**
 * The tier for this device. A context of its own is asked what draws and whether it can draw into
 * half floats, and let go at once; the scene's own context comes after.
 */
export function streetTier(lite: boolean): StreetTier {
  if (lite) return "basic";
  try {
    const gl = document.createElement("canvas").getContext("webgl2", { powerPreference: "high-performance" });
    if (!gl) return "basic";
    const halfFloat = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    const software = isSoftwareRenderer(rendererName(gl));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return halfFloat && !software ? "full" : "basic";
  } catch {
    return "basic";
  }
}
