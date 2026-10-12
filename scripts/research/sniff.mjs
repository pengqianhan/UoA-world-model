// Research helper: open a public page in headless Chromium, record which network
// requests it makes (URL, type, status, size) and take a screenshot.
// Usage: node scripts/research/sniff.mjs <url> <outPrefix> [waitMs] [width] [height]
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [url, outPrefix, waitMs = "15000", width = "1440", height = "900"] = process.argv.slice(2);
const browser = await chromium.launch({
  args: process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: +width, height: +height } });
const rows = [];
page.on("response", async (res) => {
  const req = res.request();
  let size = Number(res.headers()["content-length"] ?? -1);
  rows.push({ status: res.status(), type: req.resourceType(), method: req.method(), size, url: res.url() });
});
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(+waitMs);
await page.screenshot({ path: `${outPrefix}.png`, timeout: 90000 });
fs.writeFileSync(`${outPrefix}.requests.json`, JSON.stringify(rows, null, 1));
const byHost = {};
for (const r of rows) {
  const h = new URL(r.url).host;
  byHost[h] = (byHost[h] ?? 0) + 1;
}
console.log("title:", await page.title());
console.log("requests:", rows.length, JSON.stringify(byHost));
await browser.close();
