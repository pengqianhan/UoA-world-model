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
- **Signs on the floor plan** for stairs, lifts, toilets, accessible toilets and showers. A room
  found by its code outlines the shape it stands on, and its card shows that shape's type (#21).

### Documents

- The porting skill and `PROGRESS.md` caught up with the work of 14 and 15 October (#28).
- This changelog, and a "What's new" section at the top of the README, which is also laid out
  afresh with its text unchanged (#29).

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
