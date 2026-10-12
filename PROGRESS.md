# PROGRESS

Handover notes for whoever (probably a future session of the same agent) picks this up next.
Read `GOAL.md` (local only, not committed) first, then this file, then `git status` / `git log`.

Last updated: 2026-10-13, about 01:30 NZDT (session 1)

## Now working on

Everything in GOAL §2 that can be done without a timetable source is done and verified on the live
site (see "Acceptance criteria" below). What remains is optional polish.

**If you are a new session:** check `gh run list --limit 3` is green, run
`E2E_BASE_URL=https://pengqianhan.github.io/UoA-world-model/ npm run e2e`, then either pick a bonus
item below or, if the user has added a timetable snapshot, follow README "Adding the class timetable".

Bonus ideas, in rough order of value (none started unless noted under "Done"):

1. Illustrative room interior for the selected room (walls + seat rows), clearly labelled illustrative.
2. Terrain from open elevation tiles (large change: everything has to be draped).
3. Course-level catalogue (titles for course codes) from the University Calendar.
4. Remote campuses in 3D (building data exists; no OSM context fetched for them).

## Acceptance criteria (GOAL §2): status and evidence

Verified 2026-10-13 against https://pengqianhan.github.io/UoA-world-model/ at commit `484e2bc` with
`E2E_BASE_URL=... npm run e2e` (11/11 passed) plus screenshots read by eye.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | 3D City Campus, labelled buildings, rotate and zoom | Met | e2e "1."; canvas sampled for a real picture; `docs/campus-day.jpg` |
| 2 | Click a building, switch floors, see rooms, room shows classes at the selected time | Met for buildings, floors and rooms. **Classes: not met with real data** (no public timetable); the room card says so. The class display itself works, shown with a fixture | e2e "2." and "timetable features…"; `docs/room.jpg` |
| 3 | Search by course code, room number, building name; camera goes there | Met for rooms and buildings. **Course codes: partly** — only the subject is recognised (e.g. COMPSCI 101 -> Computer Science) with a note that class times are not public; there is no room to fly to | e2e "3." |
| 4 | Now (Pacific/Auckland) and Preview; non-teaching periods explained | Met | e2e "4.", "4b."; unit tests for daylight-saving days |
| 5 | URL restores building, floor, room and time | Met | e2e "5." |
| 6 | 390 px phone: search, building and class info | Met (class info = the "not shown" note) | e2e "6." (mobile project) |
| 7 | About: unofficial notice, sources with links and snapshot dates, OSM attribution, limitations | Met | e2e "7." |
| 8 | All text from locale files; `?lang=`; a new language is one new file | Met | e2e "8."; `tests/i18n.test.ts` |
| 9 | Repo pushed, CI green on `main`, README covers running, refreshing data, adding a language | Met | run 38248478054: build, e2e, deploy all success |
| 10 | Coverage numbers in the final report | See "Coverage" | `public/data/meta.json` |

## Coverage (snapshot 2026-10-13)

- Courses with timetable data: **0**. Scheduled classes: **0**. Share located to building / floor /
  room: **not applicable** (nothing to locate).
- What is covered instead: 194 buildings (139 on the 3D map); 786 learning spaces with outlines, every
  one tied to a building and a floor from the official campus map; 4,668 further rooms locatable as a
  point on their floor; 251 subject codes; the 2026 academic calendar.

## Done (with evidence)

- Local toolchain: Vite 8 + TypeScript 7 + Preact 11 + three 0.186 + Vitest 5 + Playwright 1.64.
- GitHub repo `pengqianhan/UoA-world-model` (public), Pages enabled with `build_type=workflow`,
  workflow `.github/workflows/deploy.yml` (typecheck, unit tests, build, deploy; separate e2e job).
- Cron job `17 */5 * * *` created in session 1 (id 233af833). Session-only; re-check with CronList on
  every wake-up and recreate if missing or older than 6 days.
- Data feasibility research finished (see "Data sources").
- Data pipeline (`npm run data:fetch`, `npm run data:build`) writes `public/data/*.json`:
  194 buildings (139 on the 3D map), 786 learning spaces with outlines, 4,668 further rooms in a lazy
  index, 251 subject codes, the 2026 academic calendar, OSM context (2,525 buildings, 4,380 road
  segments, 563 green/water areas, 1,819 trees). Schedule is empty (`available: false`).
- App: three.js orthographic campus, building cut-away with floors and rooms, search, Now/Preview time
  panel, About, status strip, URL state, English locale file, phone layout, day/night lighting,
  Open-Meteo temperature in the time chip.
- Tests: 66 unit tests (`npm test`), 11 Playwright tests (`npm run e2e`, 10 desktop + 1 phone) green
  locally on the real GPU, on SwiftShader (`E2E_GL=swiftshader`), in CI, and against the live site.
  Screenshots were inspected by eye: the canvas shows the campus, the floor view, the pin for
  outline-less rooms, the phone layout.
- README written (running, refreshing data, adding the timetable, adding a language, licences).
- `scripts/fetch-classes.ts` written from the OpenAPI document; untested against the live API.
- Looked at the reference site with Playwright (campus + classroom screenshots, local only).

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

**Decision:** follow GOAL §12. Ship with real buildings/rooms and no fabricated classes; the whole
timetable pipeline and UI exist and are tested with a fixture, so they light up the moment a real
snapshot is supplied. See "Needs the user".

Do not retry the dead routes; do not try to get around the reset/401 (they are deliberate).

### Buildings, floors, rooms: official public campus map

`maps.auckland.ac.nz` is a public MapsIndoors app (solution id `auckland`). The same anonymous JSON
requests the page makes give venues (8 campuses), buildings (209, with per-floor outlines) and
locations (26,521 rooms with `externalId` = room code, floor, type, polygon).
Snapshot: `data/raw/mapsindoors/*.json` (gitignored; URL/date/sha256 in `data/sources.json`).

**Decisions:**
- Publish outlines only for learning-space types (lecture theatres, teaching spaces, computer labs,
  laboratories, study spaces, library, student hubs). Other searchable rooms go into
  `rooms-index.json` as code + floor + one point. Residential rooms, parking, plant, toilets, lifts and
  anything the source marks non-searchable (`status != 3`) are not published at all.
- Room codes are `<building>-<room>`; the true floor comes from the map. Inference from the room
  number (agrees with the map for >85% of rooms, see `tests/roomcode.test.ts`) is only the fallback
  for unknown codes and is labelled "inferred" in the UI.
- Building height = (levels at or above index 0) × 3.6 m. Not surveyed; said so in About.

### Other sources

- Academic calendar: hand-transcribed into `data/academic-calendar.json` from the official 2026
  key-dates PDF (snapshot `data/raw/uoa-calendar/2026-key-dates.pdf`). 2027 only had start dates.
- Subject list: parsed from the Calendar's "course codes by faculty" page (251 subjects).
- Context: OpenStreetMap via one Overpass query (`data/raw/osm/context.json`, committed, ODbL).
- Weather: Open-Meteo, fetched by the visitor's browser in Now mode; optional.
- Not done: course-level catalogue (the Curriculum Catalogue's lists are lazy-loaded APEX regions;
  many requests for little value while there is no timetable). Terrain (AWS open "terrarium" tiles
  need no key) is a possible bonus.

## Decisions (and why) — do not re-litigate without new information

- **GOAL.md is gitignored.** It contains the local working-directory path (with a username).
- **Stack:** Vite + TypeScript + three.js + Preact (+ signals). Shared pure-TS modules in
  `src/shared` are used by both the pipeline and the app.
- **Ports:** dev server 5273, preview 4273 (`vite.config.ts`). Port 5173 on this machine belongs to
  another project of the user's; never touch that process.
- **Vite `base` is `/UoA-world-model/`** (override with `BASE_PATH`).
- **All network fetching goes through `scripts/lib/snapshot.ts`** (cache-first, ≥1.1 s between
  requests, honest User-Agent). Never fetch a URL that already has a snapshot unless `--refresh`.
- **Labels are HTML, hit-tested by the scene** (`pointer-events: none`) so that a drag starting on a
  label still rotates the map.
- **Building view = cut-away:** floors above the selected one are hidden, floors below are a solid
  base, neighbours sink to footprints. The stack is lifted so the lowest floor sits on the ground.
- **Timetable features are tested with a fixture served only inside Playwright**
  (`e2e/helpers.ts`, courses named "TESTFIX … (not a real course)"). Nothing synthetic is ever
  written to `public/data`; `tests/search-classes-data.test.ts` asserts the published schedule is
  empty unless a real snapshot produced it.
- **Playwright on this Windows machine:** Chromium flags `--use-angle=d3d11 --enable-gpu
  --ignore-gpu-blocklist` give the real GPU; CI uses SwiftShader. `E2E_GL=swiftshader` reproduces CI.
- **Shell quirks here:** Git Bash heredocs break on non-ASCII text, so write source files with the
  Write tool; use `python -I -X utf8` for ad-hoc scripts; Python `\b` in a non-raw string is a
  backspace (it corrupted a regex once).

## Tried and did not work

- Screenshotting the reference site with SwiftShader: timed out. The real GPU works.
- `study.auckland.ac.nz` browse pages via plain HTTP: course lists are lazy-loaded, HTML has none.
- "Ghosting" neighbouring buildings (transparent) in building view: they overlapped the open floor.
  Replaced by sinking them to footprints.
- One CI run failed (commit 4d97b04) because scripts imported `./x.ts` before
  `allowImportingTsExtensions` was set. Always run `npm run typecheck && npm test` before pushing.
- The first CI e2e run failed on the phone test: the floor strip used `row-reverse` with
  `justify-content: flex-end`, which put the higher floors in overflow that cannot be scrolled to. It
  only showed up with Linux's wider fonts. Fixed (plain `row`), and the phone test now taps floor 7.

## Needs the user

1. **A Classes API key: this is what unlocks "which class is in this room now".**
   Sign in at https://developer.auckland.ac.nz/prd with your UoA account, create an application
   client and subscribe it to "Classes Api V2" (guides on that portal: *Creating application client*,
   *Calling API using Client Credential flow*). Then follow the README section "Adding the class
   timetable". Check the portal's terms for whether republishing class times on a public site is
   allowed before doing so.
