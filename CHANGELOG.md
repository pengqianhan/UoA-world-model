# Changelog

What changed on the site, newest first. Every merge into `main` is published straight away, so
entries are dated (New Zealand time) rather than numbered as versions. Numbers in brackets are pull
requests.

A change to what the site does or shows adds its line here, and the README's
[What's new](README.md#whats-new) says it in a few words (see [docs/standards.md](docs/standards.md)).

## Held back

- **Course catalogue.** Search for all 6,982 courses of the 2026 Curriculum Catalogue by code or
  title, with the terms and campuses each is offered in (#24). Built, and kept out of `main` until
  the Classes API key arrives, so that what the timetable and the catalogue each supply can be
  settled with both in hand.

## 2026-10-17

### Added

- **A walker on the map.** "Take a walk" puts a small made-up person near the Clock Tower, to walk
  with the keyboard or the arrows on a phone. Its body, which walks, runs and stands at ease, is
  Quaternius's "Animated Human", given to the public domain (CC0). Its walks keep round the
  buildings, water and tree trunks and to OpenStreetMap's paths and streets, and end beside a
  building's nearest wall, as doors are not mapped. It goes into a building at street level, takes
  the nearest stairs or lift, and walks to a room keeping to corridors where it can, the building
  view following it. It can wander on its own from building to building. It is seen from above, from
  behind or through its eyes, says things in a bubble that other walkers near it hear, and opens an
  umbrella when Open-Meteo reports rain. Every walker looks the same: a student in a long-sleeved
  top and trainers, with a backpack on both shoulders, with nothing meant to mark a sex or a gender.
  Behind it, the camera stops in front of a wall, and where a building or a tree hides it, its shape
  shows through. Claude Code and other agents steer it with `npm run walker`, an MCP server or the
  `campus-walker` skill, all on the user's own computer (#40).

### Changed

- **The map has the screen.** The panel in the bottom-left corner (the term, the campuses, Take a
  walk and Other worlds) starts shut, as a small button with the campus's name, and opens when it
  is clicked or tapped; choosing a campus, opening a building, taking a walk or Escape shuts it
  again. On a phone or tablet a walk is steered as in a game: a stick in the bottom-left corner
  walks and turns the walker under the left thumb, the other thumb drags the view round, and as it
  walks the view comes back round behind it. The walk starts from behind the walker there; its
  panel is a slim bar under the top bar, with walking to a place and wandering behind a "⋯" button,
  and the ways into and out of a building are buttons in the bottom-right corner, above the
  building's card. Before, on a phone, the panel and its arrows covered half the screen and the
  floor list. A phone held sideways gets the same, and the top bar, the stick and the buttons keep
  clear of a notch (#47).
- **The walk folds away on a phone too.** On a touch screen the walker's bar (where it is, Map,
  Behind and Eyes) starts folded into a small "Walker" button under the top bar, and opens when
  tapped; its ⌃ folds it again. Each walk starts folded, and the panel opens by itself to say what
  went wrong when a way in or out fails (#49).

### Fixed

- **A walker's name stayed on the map after the walk.** Closing the walk, or an agent taking the
  last walker away, left the walker's name, and anything it was saying, where it had stood, over the
  building names round it, until something else redrew the labels. They now go with the last
  walker (#46).
- **About said the site has no analytics.** At campusworldmodel.com, Cloudflare, which serves the
  site, has counted page views and visits with its Web Analytics since the domain was set up. About
  now says so, and what it does not record (#45).

## 2026-10-15

### Added

- **Every campus on the map.** 55 more buildings, at Tai Tokerau, Tai Tonga, Leigh, Waiheke, Ardmore
  and 18 Carrick Place, each standing in OpenStreetMap surroundings of its own: 194 buildings in
  all, up from 139. Pick one from "Other campuses…" and the camera jumps there (#23).
- **The ground's real heights,** from the LINZ 8 m elevation model. The City Campus stands on its
  ridge above Grafton Gully, and buildings, streets, parks and trees stand on the ground. The
  attribution line credits LINZ (#27).
- **The real sun, the current weather and the seasons.** The sun stands where it does at the date
  and time shown. In Now mode the cloud, rain and fog follow Open-Meteo's current weather. The 21
  trees that OpenStreetMap tags as deciduous turn in autumn and stand bare in winter (#22).
- **Floors under the ground, seen through it.** In a building, the floors below the one at street
  level lie under the ground, and the floor list draws the ground as a dashed line between them.
  Open one and the ground turns see-through over it (#32).
- **Signs on the floor plan** for stairs, lifts, toilets, accessible toilets and showers. A room
  found by its code outlines the shape it stands on, and its card shows that shape's type (#21).

### Changed

- **A building opens on the floor at street level,** the one a visitor walks in on, and that floor
  stands on the ground. Before, a building opened on its lowest floor with learning spaces, and the
  whole building was lifted so that its lowest floor stood on the ground (#32).

### Fixed

- **The Southern Underpass stood on Symonds Street.** Building 331 runs under the street, but the
  campus map draws its ground floor as its two stairways joined by a strip about 0.1 m wide, and
  that strip stood across the road as a storey with windows, over a footing as long as the passage.
  A strip of floor no thicker than a wall is no longer drawn as a storey (13 buildings, under 5 m²
  from any one floor), and a footing goes only under what stands on the ground (#31).
- **Opened, the Southern Underpass's ground floor still had its strip,** running down Symonds
  Street as a slab, and no outer walls, not even round its stairways. Building view now leaves
  such strips out too (15 floors in 13 buildings). In all, 40 floors had no outer walls when opened:
  their outline could not be inset, and the thin walls meant to stand in were never drawn. 14 now
  have walls with windows and 26 the thin ones (#33).
- **About had the far campuses' error the wrong way round.** Shapes at Tai Tokerau are drawn about
  1.4% narrower east to west than they are, not 1% wider (#30).

### Documents

- The porting skill and `PROGRESS.md` caught up with the work of 14 and 15 October (#28).
- This changelog, and a "What's new" section at the top of the README, which is also laid out
  afresh with its text unchanged (#29).
- The README's pictures retaken from the live site, on the ground's heights and with every campus,
  and its counts brought up to date: 14,862 other spaces, 98 bare floors and 35 partly drawn
  (#30).
- Every pull request says how it was made: the model, the harness with its version and the
  thinking effort. The form asks for them and CI checks they are given (#34).
- Ready for other contributors and their agents: only the maintainer rebuilds `public/data/`, and
  a fresh clone is told why; `PROGRESS.md` says who "the user" is; the end-to-end tests suit macOS
  and Linux; the research browser keeps to one request a second and the hosts being studied (#37).

## 2026-10-14

### Added

- **Every space on a floor shows its type.** The shapes a floor plan draws without a name take the
  campus map's type, tinted by group: office, other lab, toilet or shower, stairs or lift, service,
  learning space not listed, other area. A legend lists the groups on the open floor, and pointing
  at a shape shows the type in the campus map's own words (#20).
- **Rooms stand as walls on their outlines.** In building view the facade, with its windows, stays
  below the open floor, and the camera frames the floor to fill the screen (#17, #18, which reached
  `main` through #19).
- **Floors the campus map leaves bare are marked.** 96 floors with nothing drawn and 34 with only a
  few spaces are marked in the floor list, and the building bar says so (#16).
- **Other worlds.** A link to the Tsinghua World Model, the project that inspired this one, with a
  2.2-second flight through space on the way. About and the README credit it (#8, #9).
- A GitHub button beside About, linking to the source code (#7).

### Changed

- **Buildings read as buildings:**
  - roofs have a colour of their own (#10);
  - floors that are alike are drawn as one block, 471 blocks down to 303 (#11);
  - a rim runs round every roof in the open, and edges are firmer (#12);
  - walls have storeys and windows, with a darker ground storey (#13);
  - trees have a crown and a trunk, and streets have an edge; the README pictures are new (#14).

### Documents

- The porting skill caught up with the look, the other worlds and what CI taught (#15).

## 2026-10-13

### Added

- **First release.** It has:
  - a 3D City, Grafton and Newmarket campus from the University's public campus map and
    OpenStreetMap;
  - a cut-away view of each building, floor by floor, with its learning spaces;
  - search for room codes, buildings and subject codes;
  - "Now" and "Preview" with the 2026 academic calendar;
  - day and night lighting, with the current temperature from Open-Meteo;
  - About with every source and its licence, and a phone layout;
  - unit and end-to-end tests, and publishing to GitHub Pages.
- **The rest of each floor** is drawn as plain shapes without names: 14,508 shapes on 490 floors
  (#3).
- **Each building is stacked floor by floor** from the campus map's outlines, so podiums, towers,
  setbacks and courtyards show (#4).
- **The city round the campus** is drawn with OpenStreetMap's building parts and roof shapes, with
  the Sky Tower at its full height (#5).
- A second copy of the site at <https://campusworldmodel.com/uoa/>. The repository is renamed
  `campus-world-model`.
- The porting skill, for taking the project to another university.

### Fixed

- Nine floors whose outline on the campus map belongs to another building are now drawn over their
  own building's footprint, and the building bar says so (#2).

### Documents

- `AGENTS.md`, `docs/standards.md`, `CONTRIBUTING.md` and the issue and pull-request forms: the rules
  and checks every change follows. A deploy now waits for the end-to-end tests (#1).
- The porting skill caught up, and the decision that a University building takes its shape from the
  campus map alone is recorded (#6).
