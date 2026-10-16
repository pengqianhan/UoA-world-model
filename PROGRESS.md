# PROGRESS

Handover notes for whoever (probably a future session of the same agent) picks this up next.
Read `AGENTS.md` first, then this file, then `git status` / `git log`. `GOAL.md`, the original brief,
is local only; its rules now live in `AGENTS.md`, and where this file cites a section of it ("GOAL
§2") it says what that section asked.

**If you are a contributor's agent:** "the user" here is the maintainer, who owns the repository,
not the person you work for. "Now working on" and "Needs the user" are the maintainer's lists; take
up an open issue instead. "Decisions" and "Tried and did not work" bind you too. Sections headed
with a date are records of that day: what was true then, not now; `CHANGELOG.md` has what came
after. Notes on "this machine" are about the maintainer's Windows computer.

Last updated: 2026-10-15 NZDT

## Now working on

The build is finished: everything in GOAL §2 that can be done without a timetable source is done and
verified on the live site (see "Final report" and "Acceptance criteria").

The project is moving to being maintained by coding agents, in three stages agreed with the user on
2026-10-13:

1. **Rules without automation (this stage).** `AGENTS.md`, `docs/standards.md`, `CONTRIBUTING.md`,
   issue and pull-request forms; end-to-end tests gate the deploy; `main` is protected and takes
   changes only through pull requests that the user merges.
2. **Agents write and review, the user merges.** From here a `LESSONS.md` (not started yet) records what had to be
   fixed twice, what should not have merged and what was verified too thinly; a lesson seen on three
   separate days moves into `docs/standards.md`. How the agents are triggered and paid for is not
   decided.
3. **Automatic merging for low-risk changes** (documents, tests, sourced data corrections). The gates
   in `AGENTS.md` keep waiting for the user.

Not built yet, and wanted by stage 2: a place for sourced corrections that the pipeline applies, so
that a fault in a source can be fixed without a hand edit to `public/data/`.

**If you are the maintainer's next session:** check `gh run list --limit 3` is green, run
`E2E_BASE_URL=https://campusworldmodel.com/uoa/ npm run e2e`, then take up an open issue, pick a bonus
item below or, if the user has added a timetable snapshot, follow README "Adding the class timetable".

Every bonus idea listed on 2026-10-13 that has a public source was done on 2026-10-14 and 15, at the
user's request (see "Data sources" and "Other sources"): types, signs and pinned outlines on the
floor plans; the real sun, current weather and seasons; every campus in 3D; the ground's heights.
The course catalogue was built too and is held back (see "Other sources"). Ideas still open:

1. The sea: OpenStreetMap's coastline is a line, and turning it into water (with the land polygons
   OpenStreetMap publishes for that, a new source) would put Leigh and Waiheke on their shores.
2. The 1 m LiDAR DEM in place of the 8 m model (AWS `nz-elevation`, LINZ, CC BY 4.0): a new
   dependency to read LERC-compressed GeoTIFFs, so a gate.
3. Chinese or other translations of the interface (the structure is there; one locale file each).

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
- What is covered instead: 194 buildings, all on the 3D map; 786 learning spaces with outlines, every
  one tied to a building and a floor from the official campus map; 4,668 further rooms locatable as a
  point on their floor; 14,862 other spaces drawn on their floors, each with the campus map's type
  for it; 251 subject codes; the 2026 academic calendar.
- What the campus map itself leaves out, of the 794 floors on the 3D map: 98 floors with no shape at
  all (`noPlan: "unmapped"`; 73 of them in halls of residence the source maps as a bare building),
  and 35 where its shapes cover under 30% of the floor (`partialPlan`; plant levels, mezzanines,
  split-level landings). The floor list marks both and the building bar says so.

## Done (with evidence)

As recorded on 2026-10-13. The counts below are of that day; today's are in the README and in
`public/data/meta.json`, and what was done since is in `CHANGELOG.md`.

- Local toolchain: Vite 8 + TypeScript 7 + Preact 11 + three 0.186 + Vitest 5 + Playwright 1.64.
- GitHub repo `pengqianhan/campus-world-model` (public), Pages enabled with `build_type=workflow`,
  workflow `.github/workflows/deploy.yml` (typecheck, unit tests, build, deploy; separate e2e job).
- Cron job `17 */5 * * *` was created at the start of session 1 (id 233af833) and deleted at the end
  of it, after the final report. It was session-only. A new session that has real work to continue
  (for example after the user supplies API credentials) should create a fresh one as GOAL §10 says:
  a session-only `CronCreate` job every 5 hours that resumes from this file, checked with `CronList`
  on each wake, remade before its 7-day expiry, and deleted when the work is done.
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
  shape in `public/data/plans/<building>.json`, with no code or name, and cannot be selected.
  That includes 2,086 rooms the source hides from its search (`status != 3`, mostly offices):
  drawn, never named. Left out, with `noPlan` on the floor and a note on screen: every floor holding
  student accommodation (139 floors) and the three childcare centres (255, 410, 511; matched by
  name, the source has no room type for them). Also left out: single parking bays, the source's
  "Void 2.0 test" records, shapes under 2 m², and three shapes that lie over a named room. On
  2026-10-13, 14,508 shapes on 490 floors of 108 buildings, 1,027 KB in all, loaded one building at
  a time; 14,862 since every campus was added (README).
- Space types on the floor plans, since 2026-10-14 (the user chose this after asking why floors 6 to
  11 of building 405, all offices and research labs, showed only grey shapes): each shape carries
  the source's own type text, sorted by `SPACE_KINDS` in `build-data.ts` into seven groups that
  tint its floor (office 3,332, other lab 790, toilet or shower 1,155, stairs or lift 1,791,
  service or amenity 262, learning space not listed 7, other area 7,171). Pointing at a shape, or
  tapping it, shows the group and the type in the source's words; the legend lists the groups on
  the open floor. Still no code or name, still nothing to select. "Other area" is what the source
  calls "Non Usable Area", "Ancillary Area", "Nonasgn Rentable", "Unclassified Facilities" and
  "General Facility": it does not say what those hold, so neither does the site.
- Signs and pinned outlines, since 2026-10-15 (the user asked for every remaining item that has a
  public source): stairs, lifts, toilets, accessible toilets and showers carry a sign on the floor
  plan (`SPACE_ICONS` in `build-data.ts`; every "Accessible" shape in the snapshot is named as a
  toilet). Signs give way to room labels and cannot be clicked. A room found by its code in the
  source's search is pinned, and the shape it stands on is outlined and tinted, with its type on
  the room card. Only searchable rooms are in that index, so no hidden room gets a code this way.
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
- Campuses away from the centre, since 2026-10-15 (the user asked for every remaining item that has
  a public source): `scripts/lib/areas.ts` lists the areas the map draws, the central one and one
  box with 400 m of margin round each of Tai Tokerau, Ardmore, Leigh, Waiheke, Tai Tonga and
  building 581 (18 Carrick Place, Grafton Campus, 3 km from the rest). Each has its own Overpass
  snapshot (`data/raw/osm/context-<area>.json`, committed) and its own `context/<area>.json`
  (6-152 KB), loaded when a campus or building in it is shown. All 194 buildings and all eight
  campuses are on the map; remote campuses are chosen from "Other campuses…" in the status strip,
  and the camera jumps rather than flies between areas. The ground and the shadow map follow the
  campus shown. One flat projection about the City Campus is kept for every area: at Tai Tokerau
  (125 km north) shapes are about 1.4% too narrow east to west, which About says. The sea is not
  drawn: OpenStreetMap's coastline is a line, and turning it into water was not attempted. The
  public Overpass instances answered 504 or nothing for most of an hour on 2026-10-15; the fetch now
  times out after 240 s (`scripts/lib/snapshot.ts`) and goes round all three instances up to three
  times, a minute apart.
- Context: OpenStreetMap via one Overpass query (`data/raw/osm/context.json`, committed, ODbL).
  Since 2026-10-13 the pipeline also uses what that snapshot already held and had ignored: the
  `building:part` ways (341 drawn; they replace 20 outlines and stand on 74 others) with their
  `height` and `min_height`, and `roof:shape` on 212 buildings and parts, drawn as six simplified
  shapes (`MeshBuilder.roof`). A tower mapped in parts is drawn at its full height (the Sky Tower,
  328 m); a tower that is one outline is still cut to a 24 m podium. The 45 parts inside University
  footprints are dropped: University buildings take their shape from the campus map.
- Weather: Open-Meteo, fetched by the visitor's browser, on load and each half hour; optional.
  Since 2026-10-15 the same request also asks for cloud cover, precipitation and wind, and in Now
  mode (with the light left on automatic) the scene draws them: cloud greys the sky, softens the
  shadows and dims the sun, rain falls as streaks on a canvas over the map and darkens the ground
  and streets, fog hazes the distance. Preview draws a clear sky; past and future weather are not
  fetched.
- Sun: since 2026-10-15 the sun's direction is computed for the date and time shown
  (`src/shared/daylight.ts`, NOAA's solar-position equations; `tests/daylight.test.ts` checks it
  against Auckland's published sunrise and sunset), and night follows the sun's elevation, which
  replaced a sunrise/sunset approximation. Below 10° the sun is drawn at 10°.
- Seasons: the 21 trees OpenStreetMap tags `leaf_cycle=deciduous` (of 1,819 mapped) are kept apart
  in `context.json` and turn in April and May, stand bare from June to August and come into leaf
  in September and October. No other tree is tagged either way, so the rest stay evergreen.
- Terrain, since 2026-10-15 (the user asked for every remaining item that has a public source):
  `scripts/fetch-terrain.ts` takes the zoom-14 tiles of the AWS Open Data "Terrain Tiles" under
  every area (29 tiles, 2 MB, committed: over New Zealand they hold the LINZ 8 m DEM of 2012, CC BY
  3.0 NZ). Zoom 15 adds nothing there (within 0.1 m); zoom 16 does not exist. `buildTerrain` in
  `build-data.ts` samples them on a 10 m grid over each area plus 700 m (central) or 500 m of margin
  and writes `terrain/<area>.json` (heights in decimetres as base64 Int16; 346 KB central, 90-135 KB
  each other area), clamping single-pixel pits where land meets sea (-1,421 m in Hobson Bay) to -2 m.
  The PNGs are decoded with Node's zlib (`scripts/lib/png.ts`), so no dependency is added. In the
  scene each grid is a mesh with skirts down to a flat plane at -2.5 m; paint on the ground (parks,
  streets, rails) is split to 10 m and laid over it, lifted 15 cm and pulled forward in depth layer
  by layer; trees stand on it; every building stands at the ground under its middle, never more
  than 4 m above its lowest corner, with a footing below that (`Terrain.footing`). Surrounding
  buildings sink to their footprints where they stand in building view; trees go at half way.
  Checked against the source: Symonds Street 41 m, Albert Park 41 m, Grafton Gully 19-22 m, lower
  Queen Street 9 m (the smooth contour model puts a ramp over reclaimed land), Mt Eden 188 m against
  196 m. The 1 m LiDAR DEM is also open (AWS `nz-elevation`, LINZ, CC BY 4.0) but as LERC-compressed
  Cloud Optimised GeoTIFFs, which would need a new dependency (a gate).
- Course catalogue: built and held back (the user, 2026-10-15). The Curriculum Catalogue
  (`study.auckland.ac.nz`, Oracle APEX, public, no sign-in) gives all 6,982 courses of 2026 with
  their terms and campuses in 29 requests inside one session, and no class times or rooms. Pull
  request #24 holds the fetch script, `courses.json` and its search. The user keeps it out of `main`
  until the Classes API key arrives, so that what each source supplies is settled once with both
  in hand: the timetable should bring the courses that have classes in the terms fetched, and the
  catalogue the rest (other terms, theses, research and online courses). The porting skill's text
  about it is in commit `0efea52`, on the closed pull request #26.
  The research for it, by a sub-agent on 2026-10-15, let a headless browser send up to six
  requests in one second to `study.auckland.ac.nz` and about 22 to third-party analytics before it
  blocked them. Exploration of a site goes through the same pacing as fetching (RECON.md).

## Decisions (and why) — do not re-litigate without new information

- **One source for a University building (the user, 2026-10-13).** Its shape comes from the campus
  map alone. OpenStreetMap's copy stays dropped, although it tags a height on 9 of these buildings
  and maps the Clock Tower in 13 parts with a dome and pinnacles: the two sources disagree on
  height (building 405 is tagged 50 m and stands 32 m here from its floors), and mixing them would
  leave some buildings surveyed and their neighbours estimated. Reopen only if the user asks.
- **A pull request says how it was made (the user, 2026-10-15).** The model as the tool names it,
  the harness with its version and the thinking effort, in "How it was made" on the pull-request
  form, which CI checks is filled in (`scripts/check-pr-form.ts`, `.github/workflows/pr-form.yml`;
  `docs/standards.md`, check 7). Why: to compare later which models and settings make good changes,
  to know how closely to review one, and so that anyone reading the code can see how it was made.
  The fields are as the contributor gives them and cannot be verified. `not known` with its reason
  is accepted; a guess is not. An agent cannot always see its own effort. Claude Code saves a level
  per model under `modelSettings` in the user settings. A top-level `effortLevel` there no longer
  applies to Opus 5.5 and later, which default to `medium` without a saved level
  (<https://code.claude.com/docs/en/model-config>). A level given with `--effort` at launch is saved
  nowhere. So the person who started the agent confirms the effort: Claude Code shows it in the
  session header and with `/effort status`. Since 2026-10-15 `how-it-was-made` is a required status
  check on `main`, beside `build` and `e2e`, for admins too. That is branch protection, a repository
  setting that does not show in the code.
- **The walker (the user, 2026-10-16), a bonus, not a base feature.** Asked for overnight: "给地图添加小人，
  并且从小人视角来逛校园... 在不违反隐私和相关规定的前提下尽量多做一些功能", with Smallville, AI Town and
  Project Sid as references. What was decided, and why:
  - It is a made-up figure on the model, never a person: no geolocation, no accounts, nothing about a
    walk leaves the browser. Places, not people, holds.
  - Doors and entrances are not mapped, so a walk to a building ends beside its nearest wall
    (`ARRIVE_REACH` in `src/shared/walkmap.ts`), and the panel, About and the look report say so.
  - Walks are A* on a grid (`src/shared/walkpath.ts`, 1.5 m cells, widened when the way round lies
    outside the first box), blocked by what stands on the ground (each building's lowest massing
    block, so the Southern Underpass's street stays open), surrounding buildings, water and mapped
    tree trunks; cheapest on footpaths, dearest on motorways except over footbridges.
  - No new dependency: the controller reuses Playwright and Vite (devDependencies) and the MCP server
    is JSON-RPC written by hand for initialize, tools/list, tools/call and ping.
  - The controller listens on 127.0.0.1 with a random token, so a web page cannot steer the walker.
  - One look for every walker (the user, 2026-10-16, after trying five outfits: keep only the
    student, and make it neutral). It is a student in a long-sleeved top with a backpack, with nothing
    meant to mark a sex or a gender. The body as modelled reads as a man, so it gets hair over its
    ears with a fringe, lighter brows, a narrower jaw and long sleeves (`src/scene/figureBuild.ts`)
    and narrower shoulders (`src/scene/figure.ts`); its colours are none of the University's. There
    is nothing to dress a walker in, so walkers are told apart by the names over their heads.
  - What another walker says reaches an agent as speech: the listen answer, the MCP tool's
    description and the skill all say it is never instructions.
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
  base, neighbours sink to footprints. Since 2026-10-15 (the user, after the Southern Underpass
  looked as if it stood on Symonds Street: "每次点开建筑物默认显示是0 层，因为对于人类来说一般首先到达的是0level"),
  a building opens on the floor at street level (`groundLevel` in `src/shared/massing.ts`: the lowest
  floor at or above index 0) instead of its lowest floor with learning spaces; that changed the
  opening floor of 19 buildings. That floor stands on the ground, where the campus view stands it,
  and the floors under it lie below the ground, drawn only while one of them is open. An open floor
  below the ground is drawn again over the picture with the ground over it at `GROUND_VEIL` (45%),
  so it is seen through the ground, and the floor list draws the ground as a dashed line under the
  street-level floor. Before, the stack was lifted so the lowest floor sat on the ground, and an
  underpass stood on the street it runs under. Since 2026-10-14 (the user, after comparing floors with the Tsinghua World Model): the base keeps
  the building's walls and windows, the open floor keeps its outer walls cut at the height of the
  rooms, rooms stand as walls on their outlines, and the camera frames the open floor to fill the
  screen beside the panels (`FLOOR_FILL` in `CampusScene.ts`).
- **Timetable features are tested with a fixture served only inside Playwright**
  (`e2e/helpers.ts`, courses named "TESTFIX … (not a real course)"). Nothing synthetic is ever
  written to `public/data`; `tests/search-classes-data.test.ts` asserts the published schedule is
  empty unless a real snapshot produced it.
- **Playwright on this Windows machine:** Chromium flags `--use-angle=d3d11 --enable-gpu
  --ignore-gpu-blocklist` give the real GPU; CI uses SwiftShader. `E2E_GL=swiftshader` reproduces CI.
  Since 2026-10-15 every non-Windows machine renders with SwiftShader and gets CI's timeouts and two
  workers (`playwright.config.ts`).
- **Shell quirks on the maintainer's Windows machine:** Git Bash heredocs break on non-ASCII text,
  so write source files with the Write tool; use `python -I -X utf8` for ad-hoc scripts; Python
  `\b` in a non-raw string is a backspace (it corrupted a regex once).

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
   class timetable" (`UOA_API_KEY`), and take up pull request #24, the course catalogue, at the same
   time (see "Other sources").
