// Time controls: Now (Auckland clock) or Preview (any day and time), plus lighting.
import { formatDate, pick, t } from "../app/i18n.ts";
import {
  clock,
  data,
  enterPreview,
  lightMode,
  nextTeachingDate,
  panel,
  previewDate,
  previewMinutes,
  sessionsNow,
  shown,
  status,
  timeMode,
  type LightMode,
} from "../app/state.ts";
import { representativeTeachingDate } from "../shared/calendar.ts";
import { WEEKDAY_KEYS, addDays, formatMinutes, mondayOf, parseIsoDate, parseTimeOfDay } from "../shared/time.ts";
import { IconButton } from "./common.tsx";
import { statusLine } from "./TopBar.tsx";

/** Why no classes run at the shown moment, in words. Empty string when classes can run. */
export function notTeachingReason(): string {
  const s = status.value;
  const d = data.value;
  if (!s || !d) return "";
  const term = pick(s.term?.name);
  if (s.holiday) return t("time.notTeachingWhy.holiday", { name: pick(s.holiday) });
  if (s.phase === "break") {
    const next = nextTeachingDate();
    return t("time.notTeachingWhy.break", { name: pick(s.breakName), date: next ? formatDate(next) : "" });
  }
  if (s.phase === "studyBreak") return t("time.notTeachingWhy.studyBreak", { term });
  if (s.phase === "exams") return t("time.notTeachingWhy.exams", { term });
  if (s.phase === "betweenTerms") {
    const next = nextTeachingDate();
    return next ? `${t("time.notTeachingWhy.betweenTerms")} ${t("time.notTeachingWhy.resume", { date: formatDate(next) })}` : t("time.calendarEnds");
  }
  if (s.weekend) return t("time.notTeachingWhy.weekend");
  return "";
}

export function previewTeachingDay(): void {
  const d = data.value;
  if (!d) return;
  enterPreview(representativeTeachingDate(d.calendar, clock.value.date), 600);
}

function Segmented<T extends string>(props: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div class="segmented" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button type="button" class={o.value === props.value ? "on" : ""} aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TimePanel() {
  const d = data.value;
  if (!d) return null;
  const w = shown.value;
  const preview = timeMode.value === "preview";
  const reason = notTeachingReason();
  const setDate = (date: string) => {
    if (parseIsoDate(date)) previewDate.value = date;
  };
  const range = d.calendar.terms.reduce(
    (acc, term) => ({ min: term.start < acc.min ? term.start : acc.min, max: term.end > acc.max ? term.end : acc.max }),
    { min: "9999-12-31", max: "0000-01-01" },
  );

  return (
    <div class="panel time-panel" role="dialog" aria-label={t("nav.time")}>
      <div class="panel-head">
        <h2>{t("time.modeLabel")}</h2>
        <IconButton icon="close" label={t("nav.close")} class="ghost" onClick={() => (panel.value = "none")} />
      </div>
      <div class="panel-body">
        <Segmented
          label={t("time.modeLabel")}
          value={timeMode.value}
          options={[
            { value: "now", label: t("time.now") },
            { value: "preview", label: t("time.preview") },
          ]}
          onChange={(v) => (v === "preview" ? enterPreview() : (timeMode.value = "now"))}
        />
        <p class="hint">{preview ? t("time.previewHelp") : t("time.nowHelp")}</p>

        <p class="big-time" aria-live="polite">
          <b>{formatMinutes(w.minutes)}</b>
          <span>{formatDate(w.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
          <small>{t("time.auckland")}</small>
        </p>
        <p class="status-line">{statusLine()}</p>
        {reason && <p class="hint warn">{reason}</p>}
        {!d.schedule.available && <p class="hint">{t("time.timetableMissing")}</p>}
        {d.schedule.available && !reason && sessionsNow.value.length === 0 && <p class="hint warn">{t("time.notTeaching")}</p>}
        {reason && (
          <button type="button" class="btn wide" id="preview-teaching-day" onClick={previewTeachingDay}>
            {t("time.jumpToTeaching")}
          </button>
        )}

        {preview && (
          <div class="fields">
            <label>
              <span>{t("time.date")}</span>
              <input
                id="preview-date"
                type="date"
                value={previewDate.value}
                min={range.min}
                max={range.max}
                onInput={(e) => setDate((e.target as HTMLInputElement).value)}
              />
            </label>
            <div class="weekdays" role="group" aria-label={t("time.weekday")}>
              {WEEKDAY_KEYS.map((k, i) => (
                <button
                  type="button"
                  class={w.weekday === i + 1 ? "on" : ""}
                  aria-pressed={w.weekday === i + 1}
                  title={t(`time.daysLong.${k}`)}
                  onClick={() => setDate(addDays(mondayOf(previewDate.value), i))}
                >
                  {t(`time.days.${k}`)}
                </button>
              ))}
            </div>
            <label>
              <span>{t("time.timeOfDay")}</span>
              <input
                id="preview-time"
                type="time"
                step={300}
                value={formatMinutes(previewMinutes.value)}
                onInput={(e) => {
                  const m = parseTimeOfDay((e.target as HTMLInputElement).value);
                  if (m !== null) previewMinutes.value = Math.min(m, 1439);
                }}
              />
            </label>
            <input
              class="slider"
              type="range"
              min={7 * 60}
              max={21 * 60}
              step={5}
              aria-label={t("time.timeOfDay")}
              value={Math.max(420, Math.min(1260, previewMinutes.value))}
              onInput={(e) => (previewMinutes.value = Number((e.target as HTMLInputElement).value))}
            />
            <div class="slider-scale" aria-hidden="true">
              <span>07:00</span>
              <span>14:00</span>
              <span>21:00</span>
            </div>
          </div>
        )}

        <h3 class="list-title">{t("time.light")}</h3>
        <Segmented<LightMode>
          label={t("time.light")}
          value={lightMode.value}
          options={[
            { value: "auto", label: t("time.lightAuto") },
            { value: "day", label: t("time.lightDay") },
            { value: "night", label: t("time.lightNight") },
          ]}
          onChange={(v) => (lightMode.value = v)}
        />
        <p class="hint">{t("time.lightNote")}</p>
      </div>
    </div>
  );
}
