// Research helper: open one URL in headless Chromium and report status / body prefix. Only the
// page itself is requested (polite.mjs, documents only): none of the scripts, images or analytics
// it would load.
import { chromium } from "@playwright/test";
import { politePage } from "./polite.mjs";

const url = process.argv[2];
const browser = await chromium.launch();
const { page, log } = await politePage(browser, { url, types: ["document"] });
try {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const body = await res.text();
  console.log("status", res.status(), res.headers()["content-type"], body.length, "bytes");
  console.log(body.slice(0, 600));
} catch (e) {
  console.log("navigation failed:", String(e).split("\n")[0]);
}
console.log("requests:", log.filter((r) => r.sent).length, "sent,", log.filter((r) => !r.sent).length, "blocked");
await browser.close();
