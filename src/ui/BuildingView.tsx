// Controls shown while a building is open: the floor list, the building bar with the room
// selector, and the card describing the selected room and what is timetabled in it.
import { useEffect } from "preact/hooks";
import type { AppData } from "../app/data.ts";
import { formatDate, pick, t, tn } from "../app/i18n.ts";
import {
  busyRooms,
  data,
  floorName,
  marker,
  openFloor,
  openRoom,
  panel,
  selBuilding,
  selFloor,
  selRoom,
  shown,
  timeMode,
} from "../app/state.ts";
import { sessionsOnDate } from "../shared/schedule.ts";
import { formatMinutes } from "../shared/time.ts";
import type { Building, Session } from "../shared/types.ts";
import { buildingTitle, campusName, componentName, sessionTimes } from "./common.tsx";
import { notTeachingReason } from "./TimePanel.tsx";

function FloorList({ d, b }: { d: AppData; b: Building }) {
  const rooms = d.roomsByBuilding.get(b.id) ?? [];
  const counts = new Map<number, number>();
  for (const r of rooms) counts.set(r.f, (counts.get(r.f) ?? 0) + 1);
  const busyOn = new Map<number, number>();
  for (const r of rooms) if (busyRooms.value.has(r.code)) busyOn.set(r.f, (busyOn.get(r.f) ?? 0) + 1);
  const current = selFloor.value;
  // Tall buildings have more floors than fit; keep the current one in view.
  useEffect(() => {
    document.querySelector(".floor.on")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [b.id, current]);
  return (
    <nav class="floors" aria-label={t("building.floorList")}>
      <span class="floors-title">{t("building.floorList")}</span>
      <ol>
        {/* Lowest floor first in the document; CSS stacks the list bottom-up on wide screens. */}
        {b.floors.map((f) => {
          const count = counts.get(f.i) ?? 0;
          const on = f.i === selFloor.value;
          return (
            <li>
              <button
                type="button"
                class={`floor ${on ? "on" : ""} ${count ? "has-rooms" : ""}`}
                aria-current={on ? "true" : undefined}
                data-floor={f.name}
                title={`${t("building.floor", { name: f.name })}${count ? ` · ${tn("building.floorHasRooms", count)}` : ""}`}
                onClick={() => openFloor(f.i)}
              >
                <span class="floor-name">{f.name}</span>
                {count > 0 && <span class="floor-count">{count}</span>}
                {busyOn.has(f.i) && <span class="floor-busy" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SessionRow({ d, s, live }: { d: AppData; s: Session; live: boolean }) {
  const course = d.schedule.courses[s.course];
  return (
    <li class={`class-row ${live ? "live" : ""}`}>
      <span class="class-time">{sessionTimes(s)}</span>
      <span class="class-course">
        <b>{course?.code}</b> {pick(course?.title)}
      </span>
      <span class="class-kind">
        {componentName(s.component)}
        {s.section ? ` · ${s.section}` : ""}
      </span>
    </li>
  );
}

function RoomSchedule({ d, code }: { d: AppData; code: string }) {
  if (!d.schedule.available) {
    return (
      <div class="room-schedule none" id="no-timetable">
        <strong>{t("room.noTimetable")}</strong>
        <p>{t("room.noTimetableWhy")}</p>
        <button type="button" class="link" onClick={() => (panel.value = "about")}>
          {t("nav.about")}
        </button>
      </div>
    );
  }
  const w = shown.value;
  const all = sessionsOnDate(d.sessionsByRoom.get(code) ?? [], w.date, d.calendar);
  const live = all.filter((s) => w.minutes >= s.start && w.minutes < s.end);
  const later = all.filter((s) => s.start > w.minutes);
  const reason = notTeachingReason();
  return (
    <div class="room-schedule">
      <h4>{timeMode.value === "now" ? t("room.classesNow") : t("room.classesAt", { time: `${formatDate(w.date)} ${formatMinutes(w.minutes)}` })}</h4>
      {live.length ? (
        <ul class="classes">
          {live.map((s) => (
            <SessionRow d={d} s={s} live />
          ))}
        </ul>
      ) : (
        <p class="empty">{reason || t("room.noneNow")}</p>
      )}
      {later.length > 0 && (
        <>
          <h4>{t("room.classesToday")}</h4>
          <ul class="classes">
            {later.map((s) => (
              <SessionRow d={d} s={s} live={false} />
            ))}
          </ul>
        </>
      )}
      <p class="fineprint">{t("room.scheduledNotOccupied")}</p>
    </div>
  );
}

function RoomCard({ d, b }: { d: AppData; b: Building }) {
  const code = selRoom.value;
  if (!code) return null;
  const room = d.roomByCode.get(code);
  const m = marker.value;
  const floor = room ? room.f : m?.floor;
  const precision = room ? "room" : (m?.precision ?? "building");
  return (
    <section class="room-card" aria-live="polite" id="room-card">
      <header>
        <span class={`kind-dot kind-${room?.kind ?? "other"}`} aria-hidden="true" />
        <h3>
          <b>{code}</b>
          <span>{room ? pick(room.name) : t("search.kind.room")}</span>
        </h3>
      </header>
      <p class="room-facts">
        {room && <span>{t(`room.kind.${room.kind}`)}</span>}
        {floor !== undefined && <span>{t("room.floor", { name: floorName(b, floor) })}</span>}
        {room && room.area > 0 && <span>{t("room.area", { area: room.area })}</span>}
      </p>
      <p class={`precision precision-${precision}`} id="precision-note">
        {t(`room.precision.${precision}`)}
      </p>
      <RoomSchedule d={d} code={code} />
    </section>
  );
}

export function BuildingView() {
  const d = data.value;
  const b = d && selBuilding.value ? d.buildingById.get(selBuilding.value) : undefined;
  if (!d || !b) return null;
  const rooms = d.roomsByBuilding.get(b.id) ?? [];
  const onFloor = rooms.filter((r) => r.f === selFloor.value);
  const title = buildingTitle(b);
  const floorsWithRooms = b.floors.filter((f) => rooms.some((r) => r.f === f.i));
  const kinds = [...new Set(rooms.map((r) => r.kind))];

  return (
    <>
      <FloorList d={d} b={b} />
      <div class="dock">
        <RoomCard d={d} b={b} />
        <div class="building-bar" id="building-bar">
          <div class="building-id">
            <b>{b.id}</b>
            <span class="building-name">{title || t("building.number", { id: b.id })}</span>
            <small>
              {campusName(d, b.campus)} · {tn("building.floors", b.floors.length)} · {tn("building.rooms", rooms.length)}
            </small>
          </div>
          {rooms.length > 0 ? (
            <label class="room-select">
              <span class="sr-only">{t("building.roomSelect")}</span>
              <select
                id="room-select"
                value={selRoom.value && d.roomByCode.has(selRoom.value) ? selRoom.value : ""}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  if (v) openRoom(v);
                }}
              >
                <option value="">{t("building.chooseRoom")}</option>
                {floorsWithRooms.map((f) => (
                  <optgroup label={t("building.floor", { name: f.name })}>
                    {rooms
                      .filter((r) => r.f === f.i)
                      .map((r) => (
                        <option value={r.code}>
                          {r.code} · {pick(r.name)}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : (
            <p class="bar-note">{t("building.noRooms")}</p>
          )}
          {kinds.length > 0 && (
            <ul class="legend" aria-label={t("building.legend")}>
              {kinds.map((k) => (
                <li>
                  <span class={`kind-dot kind-${k}`} aria-hidden="true" />
                  {t(`room.kind.${k}`)}
                </li>
              ))}
            </ul>
          )}
          {rooms.length > 0 && onFloor.length === 0 && !marker.value && <p class="bar-note">{t("building.noRoomsOnFloor")}</p>}
          {b.offMap && <p class="bar-note">{t("building.offMap")}</p>}
        </div>
      </div>
    </>
  );
}
