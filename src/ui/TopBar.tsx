// The bar across the top: site name (click to return to the campus), the source code, About, Search, and the time chip.
import { formatDate, pick, t } from "../app/i18n.ts";
import { REPO } from "../app/links.ts";
import { data, goHome, panel, selBuilding, shown, status, timeMode, type PanelId } from "../app/state.ts";
import { formatMinutes } from "../shared/time.ts";
import { Icon, IconButton } from "./common.tsx";
import { weather } from "./weather.ts";

export function toggle(id: PanelId): void {
  panel.value = panel.value === id ? "none" : id;
}

/** One-line description of where the shown date falls in the academic year. */
export function statusLine(): string {
  const s = status.value;
  if (!s) return "";
  if (s.holiday) return t("time.holiday", { name: pick(s.holiday) });
  const term = pick(s.term?.name);
  switch (s.phase) {
    case "teaching":
      return s.week ? t("time.phase.teaching", { term, week: s.week }) : term;
    case "break":
      return t("time.phase.break", { term, name: pick(s.breakName) });
    case "studyBreak":
      return t("time.phase.studyBreak", { term });
    case "exams":
      return t("time.phase.exams", { term });
    default:
      return t("time.phase.betweenTerms");
  }
}

export function TopBar() {
  const w = shown.value;
  const s = status.value;
  const preview = timeMode.value === "preview";
  const wx = weather.value;
  return (
    <header class="topbar">
      <button type="button" class="brand" onClick={() => goHome()} title={t("nav.home")} aria-label={`${t("app.title")} — ${t("nav.home")}`}>
        <span class="brand-name">{t("app.title")}</span>
        <span class="brand-tag">{t("app.tagline")}</span>
      </button>
      {selBuilding.value && (
        <button type="button" class="btn back" onClick={() => goHome()}>
          <Icon name="back" />
          <span>{t("nav.backToCampus")}</span>
        </button>
      )}
      <div class="topbar-spacer" />
      <a class="btn square" id="repo-link" href={REPO} target="_blank" rel="noopener noreferrer" aria-label={t("about.repo")} title={t("about.repo")}>
        <Icon name="github" />
      </a>
      <IconButton icon="info" label={t("nav.about")} text={t("nav.about")} class="hide-text-sm" pressed={panel.value === "about"} onClick={() => toggle("about")} />
      <IconButton
        id="search-button"
        icon="search"
        label={t("nav.search")}
        text={t("nav.search")}
        class="primary hide-text-xs"
        pressed={panel.value === "search"}
        onClick={() => toggle("search")}
      />
      <button
        type="button"
        class={`btn chip ${preview ? "preview" : ""}`}
        aria-pressed={panel.value === "time"}
        aria-label={`${t("nav.time")}: ${formatDate(w.date)} ${formatMinutes(w.minutes)} · ${statusLine()}`}
        onClick={() => toggle("time")}
        disabled={!data.value}
      >
        <span class="chip-mode">{preview ? t("time.preview") : t("time.now")}</span>
        <span class="chip-date">{formatDate(w.date)}</span>
        <span class="chip-time">{formatMinutes(w.minutes)}</span>
        {s?.phase === "teaching" && s.week && !s.holiday && <span class="chip-week">{t("time.chipWeek", { week: s.week })}</span>}
        {!preview && wx && (
          <span class="chip-weather" title={`${t("weather.label")}: ${t(`weather.${wx.kind}`)} · ${t("weather.source")}`}>
            {Math.round(wx.temperature)}°
          </span>
        )}
      </button>
    </header>
  );
}
