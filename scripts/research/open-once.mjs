// Research helper: open one URL in headless Chromium and report status / body prefix.
import { chromium } from "@playwright/test";
const url = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const body = await res.text();
  console.log("status", res.status(), res.headers()["content-type"], body.length, "bytes");
  console.log(body.slice(0, 600));
} catch (e) {
  console.log("navigation failed:", String(e).split("\n")[0]);
}
await browser.close();
