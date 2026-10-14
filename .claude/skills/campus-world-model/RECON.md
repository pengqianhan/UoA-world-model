# Recon

Reference for step 2 of [SKILL.md](SKILL.md): where each layer of the contract can come from, and how
to record what you find.

## Verdicts

Recon ends with one verdict per layer under "Data sources" in `PROGRESS.md`:

- **usable**: public, no login, and the terms allow republishing derived facts. Record the exact
  requests that return the data, how many there are, the licence line About will show, and what the
  host's terms say about reuse, in their words. Terms that allow non-commercial reuse make the
  verdict hold only while the site carries no advertising; write that condition down.
- **needs the user**: the data exists behind a credential, an approval or a permission. Record what
  the person must obtain and from whom.
- **not published**: every route listed below for that layer was tried and none has it.

A layer whose verdict is not "usable" ships absent. Every route tried gets a row: URL, what came back
(status, shape, size), date. Before fetching from a
host, read its `robots.txt` and its terms page. Before fetching in bulk, count the requests it will
take.

## Layers

### 1. Footprints and surroundings

OpenStreetMap through Overpass: `scripts/fetch-osm.ts` with the new bounding box. Usable everywhere
under ODbL, with attribution in About. The one query also brings building parts and roof shapes,
which the pipeline draws for the city around the campus. Note what the campus buildings carry
(`name`, `ref`, `building:levels`, `height`): they are the fallback for building names and heights
when the indoor layer is thin.

### 2. Indoor: buildings, floors, rooms

1. **The campus map's own requests.** The school's public campus map has to download buildings and
   rooms to draw them, which makes it the richest source. `node scripts/research/sniff.mjs <map URL>
   <out prefix>` opens the page headless and lists every request. Look for JSON, GeoJSON or vector
   tiles from an indoor-mapping vendor (MapsIndoors, MazeMap, Concept3D, Mappedin, ArcGIS Indoors,
   Pointr) or from the school's own endpoint. Requests the page makes anonymously are the source.
2. **A room or teaching-space directory**: pages listing rooms with building, floor, capacity, type.
   Codes and floors, without outlines.
3. **Open data**: the school's or the city's open-data portal, a facilities GIS service.
4. **Floor-plan PDFs**: record that they exist. They hold no machine-readable outlines.

Capture the building identifier used in room codes, each floor's outline and name, and for each room
its code, type, polygon or point, and the source's own "public" or "searchable" flag. Capture the
spaces that are not rooms too (corridors, stairs, offices), with their types: they become the
unnamed shapes of each floor plan, each showing its type, and the types tell which floors to leave
blank.

With this layer absent, rooms come only from the timetable's location text: the building view shows
floors without room outlines, and every floor is inferred and labelled so.

### 3. Timetable: class times and rooms

The layer most often closed, and the one the site's second question depends on.

1. **A public class search**: "class search", "schedule of classes", "course timetable", "browse
   classes", or a guest mode of the student system. Platforms that often have a public mode:
   PeopleSoft guest class search, Banner "Browse Classes", Scientia Syllabus Plus web timetables,
   CELCAT calendars, MyTimetable, UniTime.
2. **Published files**: timetable CSV, JSON or ICS on an open-data portal or department pages;
   per-room or per-course ICS feeds.
3. **An official API**: read its documentation. A key that needs sign-in or approval makes the layer
   "needs the user".
4. **Earlier student projects**: search GitHub for the school's name with "timetable" or "course
   planner", and for the hostnames found above. Their code shows where the data lived. Test whether
   that source still answers, because these go stale.

Capture per class meeting: course code and title, class type and section, day, start and end (clock
times, or period numbers plus the official period table), the dates or weeks it runs, and the
location text exactly as printed. Prefer listing endpoints, one request per subject or term, over
one page per class.

### 4. Academic calendar

The official key-dates page or PDF: terms, teaching weeks, breaks, exam periods and public holidays
for the current and the next year. Snapshot it, then transcribe it by hand into
`data/academic-calendar.json` with the source URL and the date checked.

### 5. Subjects and courses

A public list of subject or course codes with names, usually in the calendar or the course catalogue.
It lets search recognise a course code while the timetable is absent.

## When the person offers their own login

This branch opens only at the person's request, with them present. They sign in in their own
browser; you read the documentation. Run each test request inside the page and bring back status
codes only, so that no secret enters the conversation or the disk. Delete test credentials
afterwards. A token that the data route rejects is closed. Data obtained with a personal credential
is republished only with the owner's permission, which the person asks for.

## Worked example: Auckland, October 2026

| Layer | Verdict | What decided it |
| --- | --- | --- |
| Footprints | usable | One Overpass query, 9 MB |
| Indoor | usable | The campus map is a MapsIndoors app; four anonymous requests return 209 buildings with per-floor outlines and 26,521 rooms with code, floor, type and polygon |
| Timetable | needs the user | Official API answers 401 and its key needs approval by the owning team; the legacy API of 2018 drops connections; the guest class search is retired; the student system redirects to login |
| Calendar | usable | Key-dates PDF, transcribed by hand |
| Subjects | usable | 251 codes from the calendar's "course codes by faculty" page |

The site shipped with buildings, floors and rooms and no class times, and says so in the room card,
the status strip, Search and About.

The indoor verdict has a condition. The University's copyright page, read on 2026-10-14, allows its
material for not-for-profit educational use, unaltered and acknowledged, and puts commercial use
behind written permission. The site simplifies what it takes, so it stands on being non-commercial,
crediting the University and offering to remove anything on request, and has no written permission.
