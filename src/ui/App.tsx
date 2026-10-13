// Page layout and the pieces that are always present.
import { useEffect } from "preact/hooks";
import { pick, t, tn } from "../app/i18n.ts";
import { busyBuildings, data, goHome, loadError, marker, night, panel, selBuilding, selCampus, selRoom, sessionsNow, webglFailed } from "../app/state.ts";
import { AboutPanel } from "./AboutPanel.tsx";
import { BuildingView } from "./BuildingView.tsx";
import { SceneHost } from "./SceneHost.tsx";
import { SearchPanel } from "./SearchPanel.tsx";
import { TimePanel, notTeachingReason, previewTeachingDay } from "./TimePanel.tsx";
import { TopBar, statusLine } from "./TopBar.tsx";
import { TravelOverlay, Worlds, cancelTravel, travel } from "./Travel.tsx";

/** Campus-level summary: where we are in the academic year and what is timetabled right now. */
function StatusStrip() {
  const d = data.value;
  if (!d || selBuilding.value) return null;
  const reason = notTeachingReason();
  const count = sessionsNow.value.length;
  return (
    <section class="status" id="status-strip" aria-live="polite">
      <p class="status-term">{statusLine()}</p>
      {!d.schedule.available ? (
        <p class="status-detail">
          {t("status.noTimetable")}{" "}
          <button type="button" class="link" onClick={() => (panel.value = "about")}>
            {t("status.why")}
          </button>
        </p>
      ) : reason ? (
        <p class="status-detail">
          {reason}{" "}
          <button type="button" class="link" onClick={previewTeachingDay}>
            {t("time.jumpToTeaching")}
          </button>
        </p>
      ) : count === 0 ? (
        <p class="status-detail">{t("status.noneNow")}</p>
      ) : (
        <p class="status-detail">
          {tn("status.classes", count)} · {tn("status.buildings", busyBuildings.value.size)}
        </p>
      )}
      <p class="status-hint">{t("status.hintCampus")}</p>
      <div class="campus-tabs" role="group" aria-label={t("campus.label")}>
        {d.campus.campuses
          .filter((c) => c.onMap)
          .map((c) => (
            <button type="button" class={c.id === selCampus.value ? "on" : ""} aria-pressed={c.id === selCampus.value} data-campus={c.id} onClick={() => goHome(c.id)}>
              {pick(c.name)}
            </button>
          ))}
      </div>
      <Worlds />
    </section>
  );
}

function Attribution() {
  return (
    <button type="button" class="attribution" id="attribution" onClick={() => (panel.value = "about")} title={t("attribution.open")}>
      {t("attribution.short")}
    </button>
  );
}

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");
      if (e.key === "Escape") {
        if (travel.value) cancelTravel();
        else if (panel.value !== "none") panel.value = "none";
        else if (selRoom.value) {
          selRoom.value = undefined;
          marker.value = undefined;
        } else if (selBuilding.value) goHome();
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        panel.value = "search";
      }
    };
    // Coming back with the browser's Back button can restore the page as it was left: mid-flight.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) travel.value = undefined;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  const loaded = !!data.value;
  return (
    <div class={`app ${selBuilding.value ? "in-building" : "in-campus"} ${night.value > 0.5 ? "is-night" : "is-day"} panel-${panel.value} ${travel.value ? "travelling" : ""}`}>
      <SceneHost />
      <TopBar />
      {!loaded && (
        <div class="splash" role="status">
          {loadError.value ? t("app.loadError") : t("app.loading")}
        </div>
      )}
      {webglFailed.value && (
        <div class="notice" role="alert" id="webgl-notice">
          {t("app.noWebgl")}
        </div>
      )}
      <StatusStrip />
      <BuildingView />
      {panel.value === "search" && <SearchPanel />}
      {panel.value === "time" && <TimePanel />}
      {panel.value === "about" && <AboutPanel />}
      <Attribution />
      <TravelOverlay />
    </div>
  );
}
