// The walker's controller: opens the campus map in a browser with a walker on it, and takes
// commands for it over HTTP on 127.0.0.1, from the CLI (cli.ts) or the MCP server (mcp.ts).
// The browser window shows what the walker does; --headless keeps it hidden.
//
//   node scripts/walker/daemon.ts [--url <site>] [--headless] [--port <port>]
//
// Without --url it serves this checkout with Vite on port 5273, or uses a dev server already
// there. It writes its port and a random token to .walker/daemon.json; a request without the
// token is refused, so another page in a browser cannot steer the walker. Nothing is sent
// anywhere but to the site it opens.
import { chromium } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DEFAULT_PORT, ROOT, SHOT_DIR, STATE_DIR, STATE_FILE } from "./client.ts";

const argv = process.argv.slice(2);
const option = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const headless = argv.includes("--headless");
const port = Number(option("--port")) || DEFAULT_PORT;
const LOCAL = "http://localhost:5273/campus-world-model/";

function log(line: string): void {
  console.log(`${new Date().toISOString()} ${line}`);
}

async function answers(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** The site to open, and how to stop the server started for it. */
async function site(): Promise<{ url: string; close?: () => Promise<void> }> {
  const given = option("--url");
  if (given) return { url: given };
  if (await answers(LOCAL)) return { url: LOCAL };
  const { createServer } = await import("vite");
  const server = await createServer({ root: ROOT, configFile: path.join(ROOT, "vite.config.ts"), logLevel: "warn" });
  await server.listen();
  log(`Serving this checkout at ${LOCAL}`);
  return { url: LOCAL, close: () => server.close() };
}

const { url, close: closeSite } = await site();
// A window someone watches draws on the GPU: on a Mac, SwiftShader shows a walking figure at under
// one frame a second. Hidden runs keep the software renderer that CI uses.
const glArgs =
  process.platform === "win32"
    ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"]
    : process.platform === "darwin" && !headless
      ? ["--use-angle=metal", "--ignore-gpu-blocklist"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ headless, args: glArgs });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const pageLog: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") pageLog.push(`${m.type()}: ${m.text()}`.slice(0, 400));
  if (pageLog.length > 50) pageLog.shift();
});
page.on("pageerror", (e) => pageLog.push(`pageerror: ${String(e)}`.slice(0, 400)));

const open = new URL(url);
open.searchParams.set("walk", "1");
if (!open.searchParams.has("lang")) open.searchParams.set("lang", "en");
await page.goto(open.toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForFunction(() => (window as unknown as { __walker?: { ready(): boolean } }).__walker?.ready(), null, { timeout: 90_000 });
log(`The campus is open at ${open.toString()}`);

const token = crypto.randomBytes(24).toString("hex");

type Json = Record<string, unknown>;
const run = (command: string, args: Json) =>
  page.evaluate(([c, a]) => (window as unknown as { __walker: { run(c: string, a: Json): Promise<Json> } }).__walker.run(c, a), [command, args] as const);

/** A picture of the view, with the panels out of the way and the labels kept. */
async function see(body: Json): Promise<Json> {
  if (body.view) {
    const r = await run("view", { view: body.view, name: body.name, yaw: body.yaw, pitch: body.pitch });
    if (r.error) return r;
  }
  // Two frames for the camera to settle where it was put.
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector(".app")?.classList.add("shot-clean"));
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const file = path.join(SHOT_DIR, `view-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    await page.screenshot({ path: file });
    const out: Json = { file: path.relative(ROOT, file).split(path.sep).join("/"), absolute: file };
    if (body.inline) out.jpeg = (await page.screenshot({ type: "jpeg", quality: 72 })).toString("base64");
    return out;
  } finally {
    await page.evaluate(() => document.querySelector(".app")?.classList.remove("shot-clean"));
  }
}

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("Stopping");
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // Already gone.
  }
  await browser.close().catch(() => {});
  await closeSite?.().catch(() => {});
  server.close();
  setTimeout(() => process.exit(0), 200);
}

function readBody(req: http.IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > 200_000) reject(new Error("too large"));
    });
    req.on("end", () => {
      try {
        resolve(text ? (JSON.parse(text) as Json) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const reply = (status: number, body: Json) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // Only this machine's own programs, with the token from .walker/daemon.json, and only JSON.
  if (req.headers["x-walker-token"] !== token) return reply(403, { error: "Wrong or missing token." });
  try {
    if (req.method === "GET" && req.url === "/health") return reply(200, { ok: true, url: open.toString(), log: pageLog.slice(-10) });
    if (req.method !== "POST" || req.headers["content-type"] !== "application/json") return reply(405, { error: "POST JSON only." });
    const body = await readBody(req);
    if (req.url === "/run") return reply(200, await run(String(body.command ?? ""), (body.args as Json) ?? {}));
    if (req.url === "/see") return reply(200, await see(body));
    if (req.url === "/stop") {
      reply(200, { stopped: true });
      void stop();
      return;
    }
    return reply(404, { error: "No such route." });
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(port, "127.0.0.1", () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ port, token, pid: process.pid, url: open.toString(), startedAt: new Date().toISOString() }, null, 2));
  log(`Taking commands on 127.0.0.1:${port}`);
});
server.on("error", (e) => {
  log(`Cannot listen on 127.0.0.1:${port}: ${String(e)}`);
  void stop();
});

// Closing the browser window ends the controller too.
browser.on("disconnected", () => void stop());
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
