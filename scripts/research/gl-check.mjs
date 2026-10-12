// Research helper: which Chromium launch options give a working WebGL context on this machine?
import { chromium } from "@playwright/test";
const variants = {
  "headless-shell default": { args: [] },
  "headless-shell swiftshader": { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  "headless-shell d3d11": { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] },
};
for (const [name, opts] of Object.entries(variants)) {
  try {
    const browser = await chromium.launch(opts);
    const page = await browser.newPage();
    const info = await page.evaluate(() => {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      if (!gl) return "no webgl2";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "webgl2 ok (renderer hidden)";
    });
    console.log(name, "=>", info);
    await browser.close();
  } catch (e) {
    console.log(name, "=> failed:", String(e).split("\n")[0]);
  }
}
