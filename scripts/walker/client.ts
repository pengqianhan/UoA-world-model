// Talking to the walker's controller (daemon.ts): find it from the file it leaves in .walker/,
// start it in the background when it is not running, and send it commands. Used by the CLI
// (cli.ts) and the MCP server (mcp.ts). Everything stays on this machine: the controller listens
// on 127.0.0.1 only and wants the token it wrote to .walker/daemon.json.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const STATE_DIR = path.join(ROOT, ".walker");
export const STATE_FILE = path.join(STATE_DIR, "daemon.json");
export const SHOT_DIR = path.join(STATE_DIR, "shots");
export const DEFAULT_PORT = Number(process.env.WALKER_PORT) || 4719;

export interface DaemonState {
  port: number;
  token: string;
  pid: number;
  url: string;
  startedAt: string;
}

export interface StartOptions {
  /** The site to open; by default a Vite dev server of this checkout, or WALKER_URL. */
  url?: string;
  /** No window: for agents on a machine nobody is watching. Default: WALKER_HEADLESS=1. */
  headless?: boolean;
}

export function readState(): DaemonState | undefined {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as DaemonState;
  } catch {
    return undefined;
  }
}

async function call(state: DaemonState, route: string, body?: unknown, timeoutMs = 120_000): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${state.port}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-walker-token": state.token },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: `The controller answered ${res.status}: ${text.slice(0, 200)}` };
  }
}

/** The running controller, if there is one that answers. */
export async function findDaemon(): Promise<DaemonState | undefined> {
  const state = readState();
  if (!state) return undefined;
  try {
    const r = await call(state, "/health", undefined, 3000);
    return r.ok ? state : undefined;
  } catch {
    return undefined;
  }
}

/** The running controller, started in the background first when there is none. */
export async function ensureDaemon(opts: StartOptions = {}, log: (line: string) => void = () => {}): Promise<DaemonState> {
  const running = await findDaemon();
  if (running) return running;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // Not there: nothing to clear.
  }
  const args = [path.join(ROOT, "scripts", "walker", "daemon.ts")];
  // WALKER_HEADLESS=1 keeps the browser hidden for an agent working where nobody watches.
  const headless = opts.headless ?? process.env.WALKER_HEADLESS === "1";
  const url = opts.url ?? process.env.WALKER_URL;
  if (url) args.push("--url", url);
  if (headless) args.push("--headless");
  const logFile = fs.openSync(path.join(STATE_DIR, "daemon.log"), "a");
  const child = spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: ["ignore", logFile, logFile], windowsHide: true });
  child.unref();
  log(`Starting the walker's controller (pid ${child.pid}); it opens ${headless ? "a hidden" : "a"} browser on the campus map…`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    const state = await findDaemon();
    if (state) return state;
    if (child.exitCode !== null) break;
  }
  throw new Error(`The walker's controller did not start. See ${path.relative(ROOT, path.join(STATE_DIR, "daemon.log"))}.`);
}

/** Runs one walker command (see src/app/walker.ts) and returns its answer. */
export async function command(name: string, args: Record<string, unknown> = {}, opts: StartOptions = {}, log?: (line: string) => void): Promise<Record<string, unknown>> {
  const state = await ensureDaemon(opts, log);
  return call(state, "/run", { command: name, args });
}

/** A picture of what the view shows now, saved under .walker/shots/. */
export async function see(args: { view?: string; name?: string; yaw?: number; pitch?: number } = {}, opts: StartOptions = {}, log?: (line: string) => void): Promise<Record<string, unknown>> {
  const state = await ensureDaemon(opts, log);
  return call(state, "/see", args);
}

/** Stops the controller and its browser. */
export async function stopDaemon(): Promise<boolean> {
  const state = await findDaemon();
  if (!state) return false;
  try {
    await call(state, "/stop", {}, 10_000);
  } catch {
    // It closes the connection as it exits.
  }
  return true;
}
