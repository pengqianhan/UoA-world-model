# PROGRESS

Handover notes for whoever (probably a future session of the same agent) picks this up next.
Read `AGENTS.md` first, then this file, then `git status` / `git log`. `GOAL.md`, the original brief,
is local only; its rules now live in `AGENTS.md`.

Last updated: 2026-10-13, evening NZDT

## Now working on

The build is finished: everything in GOAL §2 that can be done without a timetable source is done and
verified on the live site (see "Final report" and "Acceptance criteria").

The project is moving to being maintained by coding agents, in three stages agreed with the user on
2026-10-13:

1. **Rules without automation (this stage).** `AGENTS.md`, `docs/standards.md`, `CONTRIBUTING.md`,
   issue and pull-request forms; end-to-end tests gate the deploy; `main` is protected and takes
   changes only through pull requests that the user merges.
2. **Agents write and review, the user merges.** From here a `LESSONS.md` records what had to be
   fixed twice, what should not have merged and what was verified too thinly; a lesson seen on three
   separate days moves into `docs/standards.md`. How the agents are triggered and paid for is not
   decided.
3. **Automatic merging for low-risk changes** (documents, tests, sourced data corrections). The gates
   in `AGENTS.md` keep waiting for the user.

Not built yet, and wanted by stage 2: a place for sourced corrections that the pipeline applies, so
that a fault in a source can be fixed without a hand edit to `public/data/`.

**If you are a new session:** check `gh run list --limit 3` is green, run
`E2E_BASE_URL=https://campusworldmodel.com/uoa/ npm run e2e`, then take up an open issue, pick a bonus
item below or, if the user has added a timetable snapshot, follow README "Adding the class timetable".

Bonus ideas not done, in rough order of value:

1. Terrain from open elevation tiles (large change: everything has to be draped over it).
2. Course-level catalogue (titles for course codes). Checked 2026-10-13: the 2026 Calendar no longer
   prints course prescriptions (its "Course codes by faculty" page points to the Curriculum
   Catalogue), so the only source is the APEX app at `study.auckland.ac.nz`, whose lists are
   lazy-loaded and whose course pages are about 240 KB each. Not worth thousands of requests while
   there is no timetable to attach the courses to.
3. Remote campuses in 3D (building data exists; no OSM context fetched for them).
4. On the floor plans: mark stairs, lifts and toilets, and outline the shape a pinned room stands
   on. Both give a plain shape a meaning, so both reopen the "Places, not people" rule (a gate).
5. Seasons and weather effects in the scene.

## Final report (2026-10-13)

- Live site: https://pengqianhan.github.io/campus-world-model/
- Repository: https://github.com/pengqianhan/campus-world-model (public, MIT for code)
- Verified at commit `435a4e0`: CI run green (build, e2e on software WebGL, deploy); the same 11
  Playwright tests pass against the live URL; screenshots read by eye (`docs/*.jpg` are taken from
  the live site).
- Data snapshots: campus map, OpenStreetMap and University Calendar all taken 2026-10-13
  (Pacific/Auckland); recorded with hashes in `data/sources.json` and shown in About.
- **Not achieved: class times.** No public, no-login source exists (table under "Data sources").
  Courses 0, scheduled classes 0, so the building/floor/room location percentages do not apply.
  Criteria 2 and 3 are therefore only partly met: rooms, floors and buildings work with real data,
  but a room cannot show real classes and a course code resolves only to its subject. The site says
  this plainly in the room card, the status strip, Search and About, and shows nothing invented.
- Done beyond the minimum: Grafton and Newmarket in the same scene, day/night lighting with lit
  windows, Open-Meteo temperature, illustrative room interiors (labelled as such), pins for rooms
  without an outline, e2e in CI.
- Not done: terrain (ground is flat), course-level catalogue, 3D for remote campuses, seasons,
  Chinese or other translations (structure only, as specified).

## Acceptance criteria (GOAL §2): status and evidence

Verified 2026-10-13 against https://pengqianhan.github.io/campus-world-model/ at commit `435a4e0` with
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
| 9 | Repo pushed, CI green on `main`, README covers running, refreshing data, adding a language | Met | latest runs on `main`: build, e2e, deploy all success |
| 10 | Coverage numbers in the final report | See "Coverage" | `public/data/meta.json` |

## Coverage (snapshot 2026-10-13)

- Courses with timetable data: **0**. Scheduled classes: **0**. Share located to building / floor /
  room: **not applicable** (nothing to locate).
- What is covered instead: 194 buildings (139 on the 3D map); 786 learning spaces with outlines, every
  one tied to a building and a floor from the official campus map; 4,668 further rooms locatable as a
  point on their floor; 251 subject codes; the 2026 academic calendar.
- What the campus map itself leaves out, of the 722 floors on the 3D map: 96 floors with no shape at
  all (`noPlan: "unmapped"`; 73 of them in halls of residence the source maps as a bare building),
  and 34 where its shapes cover under 30% of the floor (`partialPlan`; plant levels, mezzanines,
  split-level landings). The floor list marks both and the building bar says so.

## Done (with evidence)

- Local toolchain: Vite 8 + TypeScript 7 + Preact 11 + three 0.186 + Vitest 5 + Playwright 1.64.
- GitHub repo `pengqianhan/campus-world-model` (public), Pages enabled with `build_type=workflow`,
  workflow `.github/workflows/deploy.yml` (typecheck, unit tests, build, deploy; separate e2e job).
- Cron job `17 */5 * * *` was created at the start of session 1 (id 233af833) and deleted at the end
  of it, after the final report. It was session-only. A new session that has real work to continue
  (for example after the user supplies API credentials) should create a fresh one as GOAL §10 says.
- Data feasibility research finished (see "Data sources").
- Data pipeline (`npm run data:fetch`, `npm run data:build`) writes `public/data/*.json`:
  194 buildings (139 on the 3D map), 786 learning spaces with outlines, 4,668 further rooms in a lazy
  index, 251 subject codes, the 2026 academic calendar, OSM context (2,525 buildings, 4,380 road
  segments, 563 green/water areas, 1,819 trees). Schedule is empty (`available: false`).
- App: three.js orthographic campus, building cut-away with floors and rooms, illustrative interior
  for the selected room, search, Now/Preview time panel, About, status strip with campus buttons,
  URL state, English locale file, phone layout, day/night lighting, Open-Meteo temperature.
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
| `apis.auckland.ac.nz/classes/v2/classes` (official "Classes Api V2", documented at `developer.auckland.ac.nz/prd/documentation/api-classes-v2`) | HTTP 401 `Unauthorized` without credentials. Exactly the data we need: each class has `meetingPatterns[]` with `startDate, endDate, startTime, endTime, daysOfWeek, location`. Access needs an API key requested through the internal Athena tool and approved by the owning team; the Developer Portal's self-service OAuth credentials do not work (see "Tried and did not work"). |
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
- Name and make selectable only the learning-space types (lecture theatres, teaching spaces,
  computer labs, laboratories, study spaces, library, student hubs). Other searchable rooms go into
  `rooms-index.json` as code + floor + one point.
- Floor plans, since 2026-10-13 (the user chose this after comparing with the Tsinghua map, whose
  floors look complete): every other polygon on a floor of an on-map building is published as a bare
  shape in `public/data/plans/<building>.json`, with no code, name or type, and cannot be selected.
  That includes 2,086 rooms the source hides from its search (`status != 3`, mostly offices):
  drawn, never named. Left out, with `noPlan` on the floor and a note on screen: every floor holding
  student accommodation (139 floors) and the three childcare centres (255, 410, 511; matched by
  name, the source has no room type for them). Also left out: single parking bays, the source's
  "Void 2.0 test" records, shapes under 2 m², and three shapes that lie over a named room. 14,508
  shapes on 490 floors of 108 buildings, 950 KB in all, loaded one building at a time.
- Room codes are `<building>-<room>`; the true floor comes from the map. Inference from the room
  number (agrees with the map for >85% of rooms, see `tests/roomcode.test.ts`) is only the fallback
  for unknown codes and is labelled "inferred" in the UI.
- Building height = (levels at or above index 0) × 3.6 m. Not surveyed; said so in About.
- Building shape in the campus view, since 2026-10-13: the floors at or above entry level are
  stacked, each with the campus map's outline for that floor (`src/shared/massing.ts`), where it
  used to be the footprint raised to the full height. 91 of the 139 buildings on the map get more
  than one block. A mezzanine does not cut the storey it sits in. Windows are one pane per 3.2 m
  bay and storey, drawn by rule (`WINDOW_BAY` in `CampusScene.ts`); About says so.
- Nine floors in the 2026-10-13 snapshot carry the outline of a different building (floor 1 of 114
  has a basement 300 m away; the others are 301 B, 310 B1, 502 1, 507 -1, 901 4, 902 3 and two
  off the map). A floor outline with under 20% of its area over its own building's footprint is
  replaced by the footprint and marked `outlineFrom: "footprint"`; the building bar says so. Real
  outlines never score under 45%.

### Other sources

- Academic calendar: hand-transcribed into `data/academic-calendar.json` from the official 2026
  key-dates PDF (snapshot `data/raw/uoa-calendar/2026-key-dates.pdf`). 2027 only had start dates.
- Subject list: parsed from the Calendar's "course codes by faculty" page (251 subjects).
- Context: OpenStreetMap via one Overpass query (`data/raw/osm/context.json`, committed, ODbL).
  Since 2026-10-13 the pipeline also uses what that snapshot already held and had ignored: the
  `building:part` ways (341 drawn; they replace 20 outlines and stand on 74 others) with their
  `height` and `min_height`, and `roof:shape` on 212 buildings and parts, drawn as six simplified
  shapes (`MeshBuilder.roof`). A tower mapped in parts is drawn at its full height (the Sky Tower,
  328 m); a tower that is one outline is still cut to a 24 m podium. The 45 parts inside University
  footprints are dropped: University buildings take their shape from the campus map.
- Weather: Open-Meteo, fetched by the visitor's browser in Now mode; optional.
- Not done: course-level catalogue (the Curriculum Catalogue's lists are lazy-loaded APEX regions;
  many requests for little value while there is no timetable). Terrain (AWS open "terrarium" tiles
  need no key) is a possible bonus.

## Decisions (and why) — do not re-litigate without new information

- **One source for a University building (the user, 2026-10-13).** Its shape comes from the campus
  map alone. OpenStreetMap's copy stays dropped, although it tags a height on 9 of these buildings
  and maps the Clock Tower in 13 parts with a dome and pinnacles: the two sources disagree on
  height (building 405 is tagged 50 m and stands 32 m here from its floors), and mixing them would
  leave some buildings surveyed and their neighbours estimated. Reopen only if the user asks.
- **GOAL.md is gitignored.** It contains the local working-directory path (with a username).
- **Stack:** Vite + TypeScript + three.js + Preact (+ signals). Shared pure-TS modules in
  `src/shared` are used by both the pipeline and the app.
- **Ports:** dev server 5273, preview 4273 (`vite.config.ts`). Port 5173 on this machine belongs to
  another project of the user's; never touch that process.
- **Vite `base` is `/campus-world-model/`** (override with `BASE_PATH`).
- **The repository was renamed on 2026-10-13** from `UoA-world-model` to `campus-world-model`, to
  match the domain and because it is meant to hold several schools. GitHub redirects the old
  repository address. The old GitHub Pages address, `pengqianhan.github.io/UoA-world-model/`, does
  not redirect and answers 404; the evidence in this file that names a GitHub Pages address was
  gathered at that old address.
- **Two hosts since 2026-10-13.** GitHub Pages as before, and Cloudflare Pages project
  `campus-world-model` at <https://campusworldmodel.com/uoa/> (also reachable as
  `campus-world-model.pages.dev`), published by the `deploy-cloudflare` CI job (repository variable
  `CLOUDFLARE_PROJECT`, secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). Cloudflare
  because the user planned advertising at the time, which GitHub Pages' terms do not suit.
- **No advertising (the user, 2026-10-14).** The plan above is dropped: the site is a
  non-commercial open-source project. The University's copyright page
  (<https://www.auckland.ac.nz/en/copyright.html>) asks for written permission before any
  commercial use of its material, so if advertising is ever wanted the University is asked first.
- **One neutral address, one path per school.** The user plans to add other New Zealand universities
  and registered `campusworldmodel.com` with Cloudflare on 2026-10-13 (expires 2027-10-13,
  auto-renew off), with each school under its own path: `/uoa/` now, a school picker at the root
  later (today the root redirects to `/uoa/`, `cloudflare/_redirects`). Path names are each school's
  own short name, not its city: AUT is in Auckland too. Holding several schools in this one
  repository is a refactor that has not started. `www.campusworldmodel.com` is not set up.
- **Other worlds (the user, 2026-10-14).** The site names the Tsinghua World Model
  (`tsinghua-world-model.pages.dev`, an independent student project) as its inspiration, in About
  and in the README, and offers it on the campus view under "Other worlds". Following that link
  plays a 2.2 s flight through space, counting the great-circle distance from the City Campus,
  before the browser leaves for the other site; Escape or "Stay in Auckland" calls it off, and a
  visitor who asked for less motion gets a plain link. The other site is linked to and nothing is
  loaded from it. The list is `WORLDS` in `src/app/links.ts`; a school hosted here under its own
  path is meant to join the same row, which has not been built.
- **How a University building looks from outside (the user, 2026-10-14).** After comparing with
  the Tsinghua World Model the user asked for five changes, in this order: roofs in a colour of
  their own; floors that are alike drawn as one block; a rim and firmer edges on roofs; storeys and
  windows on the walls; fuller trees and ground. All five draw by rule from the campus-map outlines
  already in use, and none adds a data source. Floors are alike when their outlines share 95% of
  the area either covers (`STACK_OVERLAP` in `scripts/build-data.ts`), measured against the lowest
  floor of the run so that a slow drift up a tower still shows. The pipeline marks them
  (`Floor.stackWith`); inside a building each floor keeps its own outline. On the snapshot of
  2026-10-13 this takes the 139 buildings on the map from 471 blocks to 303.
- **All network fetching goes through `scripts/lib/snapshot.ts`** (cache-first, ≥1.1 s between
  requests, honest User-Agent). Never fetch a URL that already has a snapshot unless `--refresh`.
- **Labels are HTML, hit-tested by the scene** (`pointer-events: none`) so that a drag starting on a
  label still rotates the map.
- **Building view = cut-away:** floors above the selected one are hidden, floors below are a solid
  base, neighbours sink to footprints. The stack is lifted so the lowest floor sits on the ground.
  Since 2026-10-14 (the user, after comparing floors with the Tsinghua World Model): the base keeps
  the building's walls and windows, the open floor keeps its outer walls cut at the height of the
  rooms, rooms stand as walls on their outlines, and the camera frames the open floor to fill the
  screen beside the panels (`FLOOR_FILL` in `CampusScene.ts`).
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
- **Self-service OAuth credentials for Classes Api V2 (2026-10-13, in the user's own signed-in
  browser, at their request).** A credential made on the portal dashboard does get a token from
  the API's `/oauth2/token` endpoint (the scope it needs is not documented). `GET
  /classes/v2/classes` with that token still answers 401 `Unauthorized`, generated by the gateway
  itself and identical to the answer for no token or a made-up one. So the token is not what that
  route checks. Not pursued further; the test credential was deleted from the dashboard afterwards.
- The OAuth route the student project `SOFTENG310-G7/degree-planner` used in 2023-24 for Course
  Catalog Api V3 (`/courses/v3/oauth2/token`) now answers 401 as well.
- **Blurring the map during the flight to another world (2026-10-14).** A CSS `filter: blur()` on
  the WebGL canvas, and a radial gradient repainted on the star canvas every frame, were fine on a
  GPU and on SwiftShader on this machine. On CI's software renderer (2 cores) a flight that had run
  for about a second left the page producing almost no frames: after it was called off, the next
  flight got 1 frame in 1.5 s, and with the departure tied to a frame it never left. Now the map is
  only scaled, the glow is CSS, the star canvas is capped at 1.5 million pixels, and a timer sends
  the browser on its way. Two things the tests learned the same day: Playwright holds back every
  locator, `evaluate` and screenshot while the page has a navigation pending, so the page reports
  what it showed from its own `beforeunload`; and reading a canvas back there (`getImageData`)
  holds the departure up when the renderer is behind.

## Needs the user

1. **A Classes API key: this is what unlocks "which class is in this room now".**
   The API takes an API key, and keys are not self-service. The portal dashboard
   (https://developer.auckland.ac.nz/prd/dashboard) points to the internal Athena tool
   (`athena.auckland.ac.nz`, Consume), whose form needs a registered University project and is
   approved by the owning team. The API document names Student Recruitment
   (`student-recruitment@list.auckland.ac.nz`) as the contact. Ask them, and say that the class
   times will be republished on a public site. With a key, follow the README section "Adding the
   class timetable" (`UOA_API_KEY`).
