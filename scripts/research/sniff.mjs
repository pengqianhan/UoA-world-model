// Research helper: open a public page in headless Chromium, record which network requests it
// makes (URL, type, status, size) and take a screenshot. Requests go through polite.mjs: only the
// page's own host and any given with --allow, one a second, every one logged, blocked ones too.
// Usage: node scripts/research/sniff.mjs <url> <outPrefix> [waitMs] [width] [height] [--allow=host,host]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { allowArg, politePage } from "./polite.mjs";

const { allow, rest } = allowArg(process.argv.slice(2));
const [url, outPrefix, waitMs = "15000", width = "1440", height = "900"] = rest;
const browser = await chromium.launch({
  args: process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const { page, log } = await politePage(browser, { url, allow, viewport: { width: +width, height: +height } });
const rows = [];
page.on("response", async (res) => {
  const req = res.request();
  let size = Number(res.headers()["content-length"] ?? -1);
  rows.push({ status: res.status(), type: req.resourceType(), method: req.method(), size, url: res.url() });
});
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(+waitMs);
await page.screenshot({ path: `${outPrefix}.png`, timeout: 90000 });
fs.writeFileSync(`${outPrefix}.requests.json`, JSON.stringify({ responses: rows, log }, null, 1));
const byHost = {};
for (const r of log) {
  const key = `${new URL(r.url).host || r.url.split(":")[0]}${r.sent ? "" : " (blocked)"}`;
  byHost[key] = (byHost[key] ?? 0) + 1;
}
console.log("title:", await page.title());
console.log("requests:", log.filter((r) => r.sent).length, "sent,", log.filter((r) => !r.sent).length, "blocked", JSON.stringify(byHost));
await browser.close();
