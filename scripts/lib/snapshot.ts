// Polite, cache-first fetcher for raw data snapshots.
//
// Rules this module enforces (see README "Updating the data snapshot"):
//  - every URL is fetched at most once; later runs read the file on disk unless --refresh is passed
//  - at most one request per second, per process
//  - an honest User-Agent that links back to this repository
//  - every snapshot is recorded in data/sources.json with URL, fetch time, size and sha256
//
// Raw snapshots live under data/raw/ which is gitignored except for openly licensed data.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const USER_AGENT =
  "UoA-world-model/0.1 (unofficial student project; https://github.com/pengqianhan/UoA-world-model)";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const RAW_DIR = path.join(ROOT, "data", "raw");
const MANIFEST = path.join(ROOT, "data", "sources.json");
const MIN_INTERVAL_MS = 1100;

export interface SnapshotRecord {
  /** Path relative to data/raw, forward slashes. */
  file: string;
  url: string;
  fetchedAt: string;
  bytes: number;
  sha256: string;
  source: string;
}

interface Manifest {
  note: string;
  snapshots: SnapshotRecord[];
}

function readManifest(): Manifest {
  if (!fs.existsSync(MANIFEST)) {
    return {
      note: "Provenance of every raw snapshot used to build public/data. Raw files are local-only unless openly licensed.",
      snapshots: [],
    };
  }
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as Manifest;
}

function writeManifest(m: Manifest): void {
  m.snapshots.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
}

let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export interface FetchOptions {
  /** Logical source id, e.g. "mapsindoors" or "osm". */
  source: string;
  /** File path relative to data/raw. */
  file: string;
  url: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  /** Re-download even if the snapshot exists. */
  refresh?: boolean;
}

/** Returns the snapshot bytes, downloading them only if they are not on disk yet. */
export async function snapshot(opts: FetchOptions): Promise<Buffer> {
  const abs = path.join(RAW_DIR, opts.file);
  if (fs.existsSync(abs) && !opts.refresh) return fs.readFileSync(abs);

  await throttle();
  const res = await fetch(opts.url, {
    method: opts.method ?? "GET",
    body: opts.body,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json, */*;q=0.5", ...opts.headers },
  });
  if (!res.ok) throw new Error(`${opts.url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);

  const m = readManifest();
  const rec: SnapshotRecord = {
    file: opts.file.replaceAll("\\", "/"),
    url: opts.url,
    fetchedAt: new Date().toISOString(),
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    source: opts.source,
  };
  m.snapshots = m.snapshots.filter((s) => s.file !== rec.file);
  m.snapshots.push(rec);
  writeManifest(m);
  console.log(`fetched ${rec.file} (${rec.bytes} B)`);
  return buf;
}

export function readSnapshot(file: string): Buffer {
  return fs.readFileSync(path.join(RAW_DIR, file));
}

export function hasSnapshot(file: string): boolean {
  return fs.existsSync(path.join(RAW_DIR, file));
}

export function manifest(): SnapshotRecord[] {
  return readManifest().snapshots;
}
