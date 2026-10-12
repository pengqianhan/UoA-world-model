// Search drawer: rooms, buildings, courses, subjects and campuses.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AppData } from "../app/data.ts";
import { pick, t, tn } from "../app/i18n.ts";
import { browseBuildings, runSearch, type SearchItem } from "../app/searchIndex.ts";
import {
  clock,
  data,
  enterPreview,
  floorName,
  goHome,
  openBuilding,
  openMarker,
  openRoom,
  panel,
  resolveRoom,
  selCampus,
  selRoom,
  shown,
} from "../app/state.ts";
import { representativeTeachingDate } from "../shared/calendar.ts";
import { runsOnDate } from "../shared/schedule.ts";
import { addDays, mondayOf } from "../shared/time.ts";
import type { Session } from "../shared/types.ts";
import { Icon, IconButton, buildingTitle, campusName, componentName, sessionDates, sessionDay, sessionTimes } from "./common.tsx";

/** Query text survives closing and reopening the panel. */
let lastQuery = "";

function choose(item: SearchItem): void {
  switch (item.type) {
    case "building":
      openBuilding(item.building.id);
      break;
    case "room":
      openRoom(item.room.code);
      break;
    case "marker":
      openMarker(item.marker);
      break;
    case "campus":
      if (item.campus.onMap) goHome(item.campus.id);
      else return;
      break;
    default:
      return;
  }
  panel.value = "none";
}

/** A date on which the session actually runs: this week if possible, else a typical teaching week. */
function sessionDate(d: AppData, s: Session): string {
  const inWeekOf = (anchor: string) => {
    const date = addDays(mondayOf(anchor), s.day - 1);
    return runsOnDate(s, date, d.calendar) ? date : undefined;
  };
  const viaWeek = inWeekOf(shown.value.date) ?? inWeekOf(representativeTeachingDate(d.calendar, clock.value.date));
  if (viaWeek) return viaWeek;
  let date = addDays(mondayOf(s.startDate), s.day - 1);
  if (date < s.startDate) date = addDays(date, 7);
  for (let c = date; c <= s.endDate; c = addDays(c, 7)) if (runsOnDate(s, c, d.calendar)) return c;
  return date;
}

/** Shows a timetabled session on the map and moves Preview to a day and time when it runs. */
function goToSession(d: AppData, s: Session): void {
  if (!s.building) return;
  enterPreview(sessionDate(d, s), s.start);
  if (s.room && d.roomByCode.has(s.room)) openRoom(s.room);
  else if (s.room) {
    const precision = s.precision === "room" ? "indexed" : s.precision === "floor" ? "floor" : "building";
    openMarker({ code: s.room, building: s.building, floor: s.floor, precision });
    // The campus map may know where the room is even though its outline is not published.
    if (precision === "indexed") {
      void resolveRoom(s.room).then((r) => {
        if (r?.marker && selRoom.value === s.room) openMarker(r.marker);
      });
    }
  } else openBuilding(s.building, s.floor);
  panel.value = "none";
}

function SessionList({ d, sessions }: { d: AppData; sessions: Session[] }) {
  return (
    <ul class="sessions">
      {sessions.map((s) => {
        const b = s.building ? d.buildingById.get(s.building) : undefined;
        return (
          <li>
            <button type="button" class="session" onClick={() => goToSession(d, s)} title={t("search.sessionGo")}>
              <span class="session-when">
                {sessionDay(s)} · {sessionTimes(s)} · {componentName(s.component)}
              </span>
              <span class="session-where">
                {s.room ?? s.sourceText}
                {b ? ` · ${buildingTitle(b) || t("building.number", { id: b.id })}` : ""}
              </span>
              <span class="session-note">
                {sessionDates(s)} · {t(`room.precision.${s.precision === "room" && s.room && !d.roomByCode.has(s.room) ? "indexed" : s.precision === "none" || s.precision === "campus" ? "building" : s.precision}`)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Result({ d, item, active, onHover }: { d: AppData; item: SearchItem; active: boolean; onHover: () => void }) {
  const [open, setOpen] = useState(false);
  let kind = "";
  let title = "";
  let code = "";
  let meta = "";
  let note = "";
  let detail = null;
  let disabled = false;
  switch (item.type) {
    case "building": {
      const b = item.building;
      kind = t("search.kind.building");
      code = b.id;
      title = buildingTitle(b) || t("building.number", { id: b.id });
      const campus = campusName(d, b.campus);
      meta = b.roomCount ? tn("search.buildingMeta", b.roomCount, { campus }) : t("search.buildingMetaNone", { campus });
      if (b.offMap) note = t("campus.notOnMap");
      break;
    }
    case "room": {
      const r = item.room;
      const b = d.buildingById.get(r.b);
      kind = t(`room.kind.${r.kind}`);
      code = r.code;
      title = pick(r.name);
      meta = t("search.roomMeta", { building: (b && buildingTitle(b)) || t("building.number", { id: r.b }), floor: floorName(b, r.f) });
      if (b?.offMap) note = t("campus.notOnMap");
      break;
    }
    case "marker": {
      const m = item.marker;
      const b = d.buildingById.get(m.building);
      kind = t("search.kind.room");
      code = m.code;
      title = (b && buildingTitle(b)) || t("building.number", { id: m.building });
      meta = m.floor !== undefined ? t("room.floor", { name: floorName(b, m.floor) }) : "";
      note =
        m.precision === "indexed"
          ? t("search.roomIndexed")
          : m.precision === "floor"
            ? t("search.roomInferredFloor", { floor: floorName(b, m.floor) })
            : t("search.roomBuildingOnly");
      break;
    }
    case "course": {
      const sessions = d.sessionsByCourse.get(item.index) ?? [];
      kind = t("search.kind.course");
      code = item.course.code;
      title = pick(item.course.title);
      meta = tn("search.courseSessions", sessions.length);
      detail = open ? <SessionList d={d} sessions={sessions} /> : null;
      break;
    }
    case "subject": {
      const s = item.subject;
      const courses = d.schedule.courses.filter((c) => c.subject === s.code).length;
      kind = t("search.kind.subject");
      code = item.asked ?? s.code;
      title = pick(s.name);
      meta = t("search.subjectMeta", { faculty: pick(s.faculty) });
      note = courses ? tn("search.subjectCourses", courses) : t("search.subjectNoTimetable");
      disabled = true;
      break;
    }
    case "campus": {
      kind = t("search.kind.campus");
      title = pick(item.campus.name);
      meta = tn("building.rooms", d.campus.rooms.filter((r) => d.buildingById.get(r.b)?.campus === item.campus.id).length);
      if (!item.campus.onMap) {
        note = t("campus.notOnMapLong");
        disabled = true;
      }
      break;
    }
  }
  const expandable = item.type === "course";
  return (
    <li class={`result ${active ? "active" : ""} type-${item.type}`} onMouseEnter={onHover}>
      <button
        type="button"
        class="result-main"
        aria-disabled={disabled}
        aria-expanded={expandable ? open : undefined}
        data-result={code || title}
        onClick={() => (expandable ? setOpen(!open) : choose(item))}
      >
        <span class="result-kind">{kind}</span>
        <span class="result-title">
          {code && <b>{code}</b>}
          <span>{title}</span>
        </span>
        {meta && <span class="result-meta">{meta}</span>}
        {note && <span class="result-note">{note}</span>}
      </button>
      {detail}
    </li>
  );
}

export function SearchPanel() {
  const d = data.value;
  const [query, setQuery] = useState(lastQuery);
  const [active, setActive] = useState(0);
  const [extra, setExtra] = useState<SearchItem | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const results = useMemo(() => (d && query.trim() ? runSearch(d, query) : undefined), [d, query]);

  useEffect(() => {
    lastQuery = query;
    setActive(0);
    setExtra(undefined);
    const p = results?.pendingRoom;
    setPending(!!p);
    if (!p) return;
    let cancelled = false;
    void p.then((item) => {
      if (cancelled) return;
      setExtra(item);
      setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [results]);

  if (!d) return null;
  const items = results ? (extra ? [extra, ...results.items] : results.items) : [];
  const browse = browseBuildings(d, selCampus.value);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(active + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      choose(items[active]);
    }
  };

  return (
    <aside class="panel search-panel" role="search" aria-label={t("search.title")}>
      <div class="panel-head">
        <h2>{t("search.title")}</h2>
        <IconButton icon="close" label={t("nav.close")} class="ghost" onClick={() => (panel.value = "none")} />
      </div>
      <label class="search-field">
        <Icon name="search" />
        <input
          ref={input}
          id="search-input"
          type="search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          enterkeyhint="search"
          placeholder={t("search.placeholder")}
          aria-label={t("search.title")}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={onKey}
        />
      </label>
      <div class="panel-body" aria-live="polite">
        {!query.trim() && (
          <>
            <p class="hint">{t("search.hint")}</p>
            {!d.schedule.available && <p class="hint warn">{t("room.noTimetableWhy")}</p>}
            <h3 class="list-title">{t("search.browseTitle")}</h3>
            <ul class="results">
              {browse.map((b) => (
                <Result d={d} item={{ type: "building", building: b }} active={false} onHover={() => {}} />
              ))}
            </ul>
          </>
        )}
        {query.trim() && (
          <>
            <p class="count">
              {pending ? t("search.lookingUp") : items.length ? tn("search.resultsCount", items.length) : t("search.noResults", { query: query.trim() })}
            </p>
            {!items.length && !pending && <p class="hint">{t("search.noResultsHint")}</p>}
            <ul class="results">
              {items.map((item, i) => (
                <Result d={d} item={item} active={i === active} onHover={() => setActive(i)} />
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
