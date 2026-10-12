// Snapshot the class timetable from the University's Classes API v2.
//
// This needs credentials that only a University of Auckland account holder can obtain from
// https://developer.auckland.ac.nz/prd (see README, "Adding the class timetable"). They are read
// from the environment and never written to disk:
//
//   UOA_CLIENT_ID + UOA_CLIENT_SECRET [+ UOA_SCOPE]   OAuth2 client-credentials flow, or
//   UOA_API_KEY                                       sent as an `apikey` header
//   UOA_TERMS=1265,1263                               optional; defaults to the current terms
//
// The request shape follows the published OpenAPI document. It has NOT been run against the live
// API, because the project was built without credentials; expect to adjust the scope or the paging
// parameters on first use. Raw pages are cached under data/raw/uoa-classes (gitignored) and each
// page is fetched once, at most one request per second.
import fs from "node:fs";
import path from "node:path";
import { aucklandWallTime } from "../src/shared/time.ts";
import type { AcademicCalendar } from "../src/shared/types.ts";
import { snapshot, USER_AGENT } from "./lib/snapshot.ts";

const BASE = "https://apis.auckland.ac.nz/classes/v2";
const PAGE_SIZE = 500;
const refresh = process.argv.includes("--refresh");

async function authHeaders(): Promise<Record<string, string>> {
  const { UOA_API_KEY, UOA_CLIENT_ID, UOA_CLIENT_SECRET, UOA_SCOPE } = process.env;
  if (UOA_CLIENT_ID && UOA_CLIENT_SECRET) {
    const body = new URLSearchParams({ client_id: UOA_CLIENT_ID, client_secret: UOA_CLIENT_SECRET, grant_type: "client_credentials" });
    if (UOA_SCOPE) body.set("scope", UOA_SCOPE);
    const res = await fetch(`${BASE}/oauth2/token`, { method: "POST", body, headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`token request failed: HTTP ${res.status} ${await res.text()}`);
    const token = ((await res.json()) as { access_token?: string }).access_token;
    if (!token) throw new Error("token response had no access_token");
    return { Authorization: `Bearer ${token}` };
  }
  if (UOA_API_KEY) return { apikey: UOA_API_KEY };
  throw new Error(
    "No credentials. Set UOA_CLIENT_ID and UOA_CLIENT_SECRET (or UOA_API_KEY) in the environment.\n" +
      "See README: 'Adding the class timetable'.",
  );
}

/** Terms whose teaching has not finished yet, or failing that the most recent one. */
function defaultTerms(): string[] {
  const cal = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "data", "academic-calendar.json"), "utf8")) as AcademicCalendar;
  const today = aucklandWallTime().date;
  const current = cal.terms.filter((t) => t.end >= today).map((t) => t.code);
  if (current.length) return current;
  const last = [...cal.terms].sort((a, b) => b.end.localeCompare(a.end))[0];
  return last ? [last.code] : [];
}

const terms = (process.env.UOA_TERMS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const wanted = terms.length ? terms : defaultTerms();
const headers = await authHeaders();

for (const term of wanted) {
  let from = 0;
  let total = Infinity;
  let pages = 0;
  while (from < total) {
    const url = `${BASE}/classes?term=${encodeURIComponent(term)}&size=${PAGE_SIZE}&from=${from}`;
    const buf = await snapshot({ source: "uoa-classes", file: `uoa-classes/${term}-${String(from).padStart(6, "0")}.json`, url, headers, refresh });
    const page = JSON.parse(buf.toString("utf8")) as { data?: unknown[]; total?: number };
    const rows = page.data?.length ?? 0;
    if (typeof page.total === "number") total = page.total;
    pages++;
    if (rows < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  console.log(`term ${term}: ${pages} page(s), ${Number.isFinite(total) ? total : "unknown number of"} classes`);
}
console.log("Now run: npm run data:build");
