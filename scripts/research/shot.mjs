// Dev helper: screenshot a URL of the local preview/dev server with real WebGL.
// Usage: node scripts/research/shot.mjs <url> <out.png> [width] [height] [waitMs] [jsToRun]
import { chromium } from "@playwright/test";
const [url, out, width = "1440", height = "900", waitMs = "2500", js = ""] = process.argv.slice(2);
const browser = await chromium.launch({
  args: process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: +width, height: +height }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => errors.push(`[requestfailed] ${r.url()}`));
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(+waitMs);
if (js) { console.log("eval:", await page.evaluate(js)); await page.waitForTimeout(1800); }
await page.screenshot(out.endsWith(".jpg") ? { path: out, type: "jpeg", quality: 84 } : { path: out });
console.log(errors.slice(0, 12).join("\n") || "no console errors");
await browser.close();
