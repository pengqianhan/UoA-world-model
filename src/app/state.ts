// Application state as signals, plus the mapping between that state and the page URL.
// Everything a visitor can select (building, floor, room, time settings, language) lives in the
// query string, so copying the address bar reproduces the view exactly.
import { batch, computed, effect, signal } from "@preact/signals";
import { nextTeachingDay, representativeTeachingDate, termStatus } from "../shared/calendar.ts";
import { nightAmount, sunAt } from "../shared/daylight.ts";
import type { SceneWeather } from "../scene/CampusScene.ts";
import { weather, type Weather } from "../ui/weather.ts";
import { codeKey, inferFloor, parseRoomCode } from "../shared/roomcode.ts";
import { sessionsAt } from "../shared/schedule.ts";
import { aucklandWallTime, formatMinutes, isoWeekday, parseIsoDate, parseTimeOfDay, type WallTime } from "../shared/time.ts";
import type { Building, FloorPlans, Session, SpaceType } from "../shared/types.ts";
import { findIndexedRoom, loadRoomIndex, type AppData } from "./data.ts";
import { DEFAULT_LANG, lang, languages, setLang } from "./i18n.ts";

export type PanelId = "none" | "search" | "about" | "time";
export type LightMode = "auto" | "day" | "night";

/** A room that is not drawn as an outline: located as a point, a floor or only a building. */
export interface Marker {
  code: string;
  building: string;
  floor?: number;
  /** [east, north] in metres, when the campus map knows the room. */
  at?: [number, number];
  precision: "indexed" | "floor" | "building";
}

export const data = signal<AppData | null>(null);
export const loadError = signal(false);
export const webglFailed = signal(false);

export const selCampus = signal("city");
export const selBuilding = signal<string | undefined>(undefined);
export const selFloor = signal<number | undefined>(undefined);
export const selRoom = signal<string | undefined>(undefined);
export const marker = signal<Marker | undefined>(undefined);
/** The floor plans of the buildings opened so far, as they arrive. */
export const plansLoaded = signal<ReadonlyMap<string, FloorPlans>>(new Map());
/** An unnamed space on the open floor under the pointer, or tapped, and where on the page. */
export const spaceTip = signal<{ type: SpaceType; x: number; y: number } | undefined>(undefined);
/** Bumped to ask the scene to re-frame the current selection or campus. */
export const frameRequest = signal(0);

export const panel = signal<PanelId>("none");
export const timeMode = signal<"now" | "preview">("now");
export const previewDate = signal("");
export const previewMinutes = signal(600);
export const lightMode = signal<LightMode>("auto");
export const clock = signal<WallTime>(aucklandWallTime());

/** The date and time the map is showing: the Auckland clock in Now mode, the chosen moment in Preview. */
export const shown = computed<WallTime>(() => {
  if (timeMode.value === "now" || !parseIsoDate(previewDate.value)) return clock.value;
  return { date: previewDate.value, minutes: previewMinutes.value, weekday: isoWeekday(previewDate.value) };
});

export const status = computed(() => {
  const d = data.value;
  return d ? termStatus(d.calendar, shown.value.date) : undefined;
});

/** Sessions in progress at the shown time. Empty while no timetable is loaded. */
export const sessionsNow = computed<Session[]>(() => {
  const d = data.value;
  if (!d || !d.schedule.available) return [];
  return sessionsAt(d.schedule.sessions, shown.value.date, shown.value.minutes, d.calendar);
});

export const busyRooms = computed(() => {
  const m = new Map<string, number>();
  for (const s of sessionsNow.value) if (s.room) m.set(s.room, (m.get(s.room) ?? 0) + 1);
  return m;
});

export const busyBuildings = computed(() => {
  const m = new Map<string, number>();
  for (const s of sessionsNow.value) if (s.building) m.set(s.building, (m.get(s.building) ?? 0) + 1);
  return m;
});

export const night = computed(() => {
  if (lightMode.value === "day") return 0;
  if (lightMode.value === "night") return 1;
  return nightAmount(shown.value.date, shown.value.minutes);
});

/**
 * The sun over the campus at the time shown. When daylight is forced while the real sun is down,
 * there is no real sun to draw, so none is given and the scene keeps its own afternoon light.
 */
export const sun = computed(() => {
  const s = sunAt(shown.value.date, shown.value.minutes);
  return lightMode.value === "day" && s.elevation < 0 ? undefined : s;
});

/** How hard it is raining, 0-1, for the kinds of weather that bring rain. */
export const RAIN: Partial<Record<Weather["kind"], number>> = { drizzle: 0.55, rain: 1, showers: 0.85, thunder: 1, snow: 1 };

/**
 * The weather the scene draws: Open-Meteo's current conditions, only while the time shown is now
 * and the light follows it. Past or future weather is not known here, so Preview stays clear.
 */
export const sceneWeather = computed<SceneWeather | undefined>(() => {
  const w = weather.value;
  if (!w || timeMode.value !== "now" || lightMode.value !== "auto") return undefined;
  const rain = RAIN[w.kind] ?? 0;
  return {
    cloud: Math.max(w.cloud, rain ? 0.85 : 0, w.kind === "fog" ? 0.9 : 0),
    wet: rain,
    fog: w.kind === "fog" ? 1 : 0,
  };
});

// ---------------------------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------------------------

export function floorByName(b: Building, name: string): number | undefined {
  const n = name.trim().toUpperCase();
  return b.floors.find((f) => f.name.toUpperCase() === n)?.i;
}

export function floorName(b: Building | undefined, index: number | undefined): string {
  return b?.floors.find((f) => f.i === index)?.name ?? "";
}

/** The floor to show when a building is opened without one: the lowest entry-level floor with learning spaces. */
export function defaultFloor(d: AppData, b: Building): number {
  const rooms = d.roomsByBuilding.get(b.id) ?? [];
  const withRooms = new Set(rooms.map((r) => r.f));
  const candidates = b.floors.filter((f) => withRooms.has(f.i));
  const pick = candidates.find((f) => f.i >= 0) ?? candidates[0] ?? b.floors.find((f) => f.i >= 0) ?? b.floors[0];
  return pick?.i ?? 0;
}

export function goHome(campus?: string): void {
  batch(() => {
    if (campus) selCampus.value = campus;
    selBuilding.value = undefined;
    selFloor.value = undefined;
    selRoom.value = undefined;
    marker.value = undefined;
    frameRequest.value++;
  });
}

export function openBuilding(id: string, floor?: number): void {
  const d = data.value;
  const b = d?.buildingById.get(id);
  if (!d || !b) return;
  batch(() => {
    selCampus.value = b.campus;
    selBuilding.value = id;
    selFloor.value = floor !== undefined && b.floors.some((f) => f.i === floor) ? floor : defaultFloor(d, b);
    selRoom.value = undefined;
    marker.value = undefined;
  });
}

export function openFloor(index: number): void {
  const d = data.value;
  const b = selBuilding.value ? d?.buildingById.get(selBuilding.value) : undefined;
  if (!d || !b || !b.floors.some((f) => f.i === index)) return;
  batch(() => {
    selFloor.value = index;
    const room = selRoom.value ? d.roomByCode.get(selRoom.value) : undefined;
    if (!room || room.f !== index) {
      selRoom.value = undefined;
      marker.value = undefined;
    }
  });
}

/** Opens a room that has a published outline. */
export function openRoom(code: string): void {
  const d = data.value;
  const r = d?.roomByCode.get(code);
  if (!d || !r) return;
  const b = d.buildingById.get(r.b);
  batch(() => {
    if (b) selCampus.value = b.campus;
    selBuilding.value = r.b;
    selFloor.value = r.f;
    selRoom.value = r.code;
    marker.value = undefined;
  });
}

/** Opens a room that is known only as a point, a floor or a building. */
export function openMarker(m: Marker): void {
  const d = data.value;
  const b = d?.buildingById.get(m.building);
  if (!d || !b) return;
  batch(() => {
    selCampus.value = b.campus;
    selBuilding.value = m.building;
    selFloor.value = m.floor ?? defaultFloor(d, b);
    selRoom.value = m.code;
    marker.value = m;
  });
}

/**
 * Resolves a room code to the best location available: a published room, a point from the campus
 * map's room index, a floor inferred from the room number, or just the building.
 */
export async function resolveRoom(text: string): Promise<{ room?: string; marker?: Marker } | undefined> {
  const d = data.value;
  if (!d) return undefined;
  const parsed = parseRoomCode(text, d.buildingIds);
  if (!parsed) return undefined;
  const b = d.buildingById.get(parsed.building);
  if (!b) return undefined;
  const published = d.roomByKey.get(codeKey(parsed.code));
  if (published) return { room: published.code };
  try {
    const hit = findIndexedRoom(await loadRoomIndex(), parsed.building, parsed.room);
    if (hit) return { marker: { code: hit.code, building: hit.building, floor: hit.floor, at: hit.at, precision: "indexed" } };
  } catch {
    // The index is optional; fall through to inference.
  }
  const floor = inferFloor(b.floors, parsed.room);
  if (floor) return { marker: { code: parsed.code, building: b.id, floor: floor.i, precision: "floor" } };
  return { marker: { code: parsed.code, building: b.id, precision: "building" } };
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

/** Switches to Preview, choosing a representative teaching day the first time. */
export function enterPreview(date?: string, minutes?: number): void {
  const d = data.value;
  batch(() => {
    if (date && parseIsoDate(date)) previewDate.value = date;
    else if (!parseIsoDate(previewDate.value)) {
      previewDate.value = d ? representativeTeachingDate(d.calendar, clock.value.date) : clock.value.date;
    }
    if (minutes !== undefined) previewMinutes.value = minutes;
    else if (timeMode.value === "now") {
      // Carry the current time of day over when it is within teaching hours, otherwise use 10:00.
      const m = clock.value.minutes;
      previewMinutes.value = m >= 8 * 60 && m <= 18 * 60 ? Math.round(m / 5) * 5 : 600;
    }
    timeMode.value = "preview";
  });
}

export function nextTeachingDate(): string | undefined {
  const d = data.value;
  return d ? nextTeachingDay(d.calendar, shown.value.date) : undefined;
}

// ---------------------------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------------------------

/** Applies the query string to the state. Call once after the data has loaded. */
export function readUrl(d: AppData): void {
  const q = new URLSearchParams(location.search);
  setLang(q.get("lang"));

  const mode = q.get("time");
  const date = q.get("date");
  const tod = q.get("t") ? parseTimeOfDay(q.get("t")!) : null;
  if (date && parseIsoDate(date)) previewDate.value = date;
  if (tod !== null) previewMinutes.value = Math.min(tod, 1439);
  if (mode === "preview" || (mode !== "now" && (date || tod !== null))) enterPreview(previewDate.value || undefined, previewMinutes.value);
  const light = q.get("light");
  if (light === "day" || light === "night") lightMode.value = light;

  const p = q.get("panel");
  if (p === "about" || p === "search" || p === "time") panel.value = p;

  const campus = q.get("campus");
  if (campus && d.campusById.has(campus)) selCampus.value = campus;

  const roomParam = q.get("room");
  const buildingParam = q.get("building");
  const floorParam = q.get("floor");
  const room = roomParam ? d.roomByCode.get(roomParam.toUpperCase()) : undefined;
  if (room) {
    openRoom(room.code);
    return;
  }
  const parsed = roomParam ? parseRoomCode(roomParam, d.buildingIds) : null;
  const b = d.buildingById.get((buildingParam ?? parsed?.building ?? "").toUpperCase());
  if (!b) return;
  openBuilding(b.id, floorParam ? floorByName(b, floorParam) : undefined);
  if (roomParam) {
    // Not a published room: find the best available location without blocking the first render.
    void resolveRoom(roomParam).then((r) => {
      if (selBuilding.value !== b.id) return;
      if (r?.room) openRoom(r.room);
      else if (r?.marker) openMarker(r.marker);
    });
  }
}

export function currentUrl(): string {
  const d = data.value;
  const q = new URLSearchParams();
  const b = selBuilding.value ? d?.buildingById.get(selBuilding.value) : undefined;
  if (!b && selCampus.value !== "city") q.set("campus", selCampus.value);
  if (b) {
    q.set("building", b.id);
    const name = floorName(b, selFloor.value);
    if (name) q.set("floor", name);
    if (selRoom.value) q.set("room", selRoom.value);
  }
  if (timeMode.value === "preview") {
    q.set("time", "preview");
    q.set("date", previewDate.value);
    q.set("t", formatMinutes(previewMinutes.value));
  }
  if (lightMode.value !== "auto") q.set("light", lightMode.value);
  if (panel.value === "about") q.set("panel", "about");
  if (lang.value !== DEFAULT_LANG || languages.length > 1) q.set("lang", lang.value);
  const qs = q.toString().replace(/%3A/g, ":");
  return `${location.pathname}${qs ? `?${qs}` : ""}`;
}

/** Keeps the address bar in step with the state. Call once after readUrl. */
export function startUrlSync(): void {
  effect(() => {
    const url = currentUrl();
    if (url !== `${location.pathname}${location.search}`) history.replaceState(null, "", url);
  });
}

/** Keeps the Auckland clock current while the page is open. */
export function startClock(): void {
  const tick = () => {
    const now = aucklandWallTime();
    const cur = clock.value;
    if (now.date !== cur.date || now.minutes !== cur.minutes) clock.value = now;
  };
  setInterval(tick, 10_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
}
