# PROGRESS

Handover notes for whoever (probably a future session of the same agent) picks this up next.
Read `GOAL.md` (local only, not committed) first, then this file, then `git status` / `git log`.

Last updated: 2026-10-13 (session 1)

## Now working on

Step 3 of GOAL §10: spatial data pipeline (MapsIndoors + OSM -> `public/data/spatial.json`), then the
3D campus.

**Next concrete steps, in order:**

1. `scripts/fetch-osm.ts`: one Overpass query for context (other buildings, roads, parks, water) around
   City / Grafton / Newmarket. Snapshot goes to `data/raw/osm/` (ODbL, committed).
2. `scripts/build-data.ts`: snapshots -> `public/data/spatial.json` (buildings, floors, learning-space
   rooms, OSM context), `public/data/meta.json` (sources, snapshot dates, coverage numbers).
3. Academic calendar JSON from the official 2026 key-dates PDF (URL in "Data sources" below).
4. three.js campus scene, building/floor/room views, search, time panel, URL state, i18n, About.

## Done (with evidence)

- Local toolchain: Vite 8 + TypeScript 7 + Preact 11 + three 0.186 + Vitest 5 + Playwright 1.64.
  `npm run typecheck`, `npm test`, `npm run build` pass locally (2026-10-13).
- GitHub repo `pengqianhan/UoA-world-model` (public), Pages enabled with `build_type=workflow`.
  First CI run green; https://pengqianhan.github.io/UoA-world-model/ returned HTTP 200 with the
  placeholder page (checked with curl, 2026-10-13).
- Cron job `17 */5 * * *` created in session 1 (id 233af833). It is session-only; re-check with
  CronList on every wake-up and recreate if missing or older than 6 days.
- Data feasibility research finished (see next section).
- Looked at the reference site with Playwright (campus view + classroom view screenshots, local only):
  isometric camera, dark miniature campus, pill labels on buildings, left "courses & spaces" panel,
  top-right info / Search / time+weather, right-hand floor list, bottom building name + room select,
  "‹ Campus" back button, per-session precision note.

## Data sources: what exists and what does not (researched 2026-10-13)

### Timetable (class times + rooms): NOT publicly available without a login

Every route was checked once, politely, with an honest User-Agent:

| Route | Result |
| --- | --- |
| `apis.auckland.ac.nz/classes/v2/classes` (official "Classes Api V2", documented at `developer.auckland.ac.nz/prd/documentation/api-classes-v2`) | HTTP 401 `Unauthorized` without credentials. Exactly the data we need: each class has `meetingPatterns[]` with `startDate, endDate, startTime, endTime, daysOfWeek, location`. Keys are issued through the Developer Portal, whose login is UoA single sign-on (`openid-connect`). |
| `api.auckland.ac.nz/service/classes/v1/classes` (legacy API older student projects used) | TCP connection reset after the request, for curl, for WebFetch and for a real headless Chromium. Closed to the outside. |
| `www.student.guest.auckland.ac.nz` (guest "browse course catalogue", still linked from auckland.ac.nz) | Whole host 302-redirects to an AskAuckland article that says "This answer is no longer available". Retired. |
| `www.student.auckland.ac.nz` (Student Services Online) | Redirects to the SSO login. |
| `courseoutline.auckland.ac.nz` | Redirects to the SSO login. |
| `study.auckland.ac.nz` (Curriculum Catalogue, Oracle APEX) | Public. Has course code, title, points, prescription, campus and terms offered. **No class times or rooms.** |

**Decision:** follow GOAL §12. Ship with real buildings/rooms and no fabricated classes; build the whole
timetable pipeline and UI so that it lights up the moment a Classes API key is supplied
(`UOA_API_KEY=... npm run data:classes`). See "Needs the user".

Do not retry the dead routes; do not try to get around the reset/401 (they are deliberate).

### Buildings, floors, rooms: official public campus map (works, snapshot taken)

`maps.auckland.ac.nz` is a public MapsIndoors app (solution id `auckland`). The same anonymous JSON
requests the page makes give:

- `sync/venues` — 8 campuses (City, Grafton, Newmarket, Leigh, Ardmore, Tai Tokerau, Tai Tonga, Waiheke)
- `sync/buildings` — 209 buildings: `administrativeId` (the 3-digit building number, e.g. `303`, `105S`),
  name (`B102 Old Government House`), footprint polygon, and per-floor outline polygons keyed by floor
  index ×10 (`-10` = B, `0` = G, `10` = 1 …) with display names.
- `sync/locations` — 26,521 locations (20 MB). Each room has `externalId` = the room code
  (`303-G23`, `109-B10`, `105S-039`), `building`, `floor` index, `floorName`, `type`, polygon geometry.
  Learning-space types: Lecture theatres 54, Teaching spaces 369, Computer labs 72, Laboratories 244,
  Lab-Undergrad 51, Study spaces 8, Library 2, Student hubs 9 …

Snapshot: `data/raw/mapsindoors/*.json` (gitignored; URL/date/sha256 in `data/sources.json`).
Fetch script: `npx tsx scripts/fetch-mapsindoors.ts` (cache-first; `--refresh` to re-download).

**Decision:** publish only derived facts for learning-relevant rooms (code, type, floor, simplified
outline) plus building footprints and floor outlines. Offices, residences, plant rooms etc. are not
published (irrelevant to students finding a class, bulky, and more sensitive). Attribute the
University's public campus map in About.

This also settles GOAL §5's question about room numbering: codes are `<building>-<room>`, and the true
floor comes from the map's `floorName`. The "first character of the room number = floor" rule is kept
only as a fallback for room codes that are not in the map, and is labelled "inferred".

### Other sources

- Academic calendar: official PDF
  `https://www.auckland.ac.nz/assets/about-us/about-the-university/the-university/official-publications/university-calendar/current-calendar/2026-calendar-parts/2026-calendar-key-dates.pdf`
  (Semester Two 2026: Mon 20 July – lectures end Fri 23 Oct; Labour Day Mon 26 Oct.) Not yet transcribed.
- Subject list: `…/university-calendar/current-calendar/courses.html` lists every subject code with its
  name by faculty (one page). Course-level catalogue would need the APEX app's lazy-loaded browse pages
  (many requests) — deferred; low value while there is no timetable.
- Context geometry: OpenStreetMap via Overpass (not fetched yet).
- Terrain (bonus): AWS open "terrarium" elevation tiles need no key. Not started.
- `www.auckland.ac.nz/robots.txt`: `Allow: /`. `api.mapsindoors.com/robots.txt`: 404 (none).

## Decisions (and why) — do not re-litigate without new information

- **GOAL.md is gitignored.** It contains the local working-directory path (with a username), and
  GOAL §8 forbids committing personal info from local paths. It stays in the working folder.
- **Stack: Vite + TypeScript + three.js + Preact (+ signals) for UI.** Static only, small runtime,
  matches the reference site's architecture. Data pipeline is Node/TS scripts run with `tsx`; unit
  tests with Vitest; e2e with Playwright.
- **Vite `base` is `/UoA-world-model/`** (override with `BASE_PATH`). Needed for the Pages subpath.
- **Line endings:** `.gitattributes` forces LF; local `core.autocrlf=false`.
- **Raw snapshots:** `data/raw/` is gitignored except `data/raw/osm/`. Provenance in `data/sources.json`.
- **All network fetching goes through `scripts/lib/snapshot.ts`** (cache-first, ≥1.1 s between
  requests, honest User-Agent). Never fetch a URL that already has a snapshot unless `--refresh`.
- **Playwright on this Windows machine:** launch Chromium with
  `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` to get the real GPU; the default headless
  shell falls back to SwiftShader, which is too slow for heavy scenes (the reference site timed out)
  but is fine for ours and is what Linux CI will use.
- **Python on this machine:** use `python -I -X utf8` for ad-hoc inspection (console is cp1252).

## Tried and did not work

- Screenshotting the reference site with SwiftShader: `page.screenshot` timed out. Fixed by using the
  real GPU (flags above).
- `study.auckland.ac.nz` browse pages via plain HTTP: the course lists are lazy-loaded by APEX AJAX, so
  the HTML has no course codes. Would need a browser session; deferred.

## Needs the user

1. **A Classes API key (this is what unlocks "which class is in this room now").**
   Sign in at https://developer.auckland.ac.nz/prd with your UoA account, create an application
   client and subscribe it to "Classes Api V2" (guides: *Creating application client*,
   *Calling API using Client Credential flow* on that portal). Then run the classes fetch with the
   credential in an environment variable (exact command will be documented in README once the
   script exists). Nothing else is required; the site rebuilds from the snapshot.
   Note: check the portal's terms for whether republishing class times on a public site is allowed.
