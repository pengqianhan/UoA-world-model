// Page layout and the pieces that are always present.
import { effect, signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { pick, t, tn } from "../app/i18n.ts";
import { Icon, campusName } from "./common.tsx";
import { busyBuildings, data, goHome, loadError, marker, night, panel, selBuilding, selCampus, selRoom, sessionsNow, webglFailed } from "../app/state.ts";
import { AboutPanel } from "./AboutPanel.tsx";
import { BuildingView } from "./BuildingView.tsx";
import { SceneHost, isLite } from "./SceneHost.tsx";
import { SearchPanel } from "./SearchPanel.tsx";
import { TimePanel, notTeachingReason, previewTeachingDay } from "./TimePanel.tsx";
import { TopBar, statusLine } from "./TopBar.tsx";
import { TravelOverlay, Worlds, cancelTravel, travel } from "./Travel.tsx";
import { WalkerPanel } from "./WalkerPanel.tsx";
import { MY_WALKER, setView, startWalkerKeys, startWalking, walkerOn, walkerView } from "../app/walker.ts";

/** Whether the campus panel is open. It starts shut, as a small button, so the map has the screen. */
const stripOpen = signal(false);

/** Opens a campus from the panel, which then shuts so the map can be seen. */
function chooseCampus(id: string): void {
  stripOpen.value = false;
  goHome(id);
}

/**
 * Campus-level summary: where we are in the academic year and what is timetabled right now, with
 * the campuses, the walk and the other worlds. Shut, it is a button with the campus's name.
 */
function StatusStrip() {
  const show = useRef<HTMLButtonElement>(null);
  const hide = useRef<HTMLButtonElement>(null);
  const open = stripOpen.value;
  const was = useRef(open);
  // Focus goes with the panel, for whoever is using the keyboard: into it, and back to its button.
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    (open ? hide : show).current?.focus();
  }, [open]);
  const d = data.value;
  if (!d || selBuilding.value || walkerOn.value) return null;
  const reason = notTeachingReason();
  const count = sessionsNow.value.length;
  // Campuses in areas of their own, away from the centre.
  const remote = d.campus.campuses.filter((c) => c.onMap && c.area);
  return (
    <>
      {!open && (
        <button
          type="button"
          class="status-toggle"
          id="status-toggle"
          ref={show}
          aria-expanded="false"
          aria-controls="status-strip"
          aria-label={t("status.show", { campus: campusName(d, selCampus.value) })}
          title={t("status.show", { campus: campusName(d, selCampus.value) })}
          onClick={() => (stripOpen.value = true)}
        >
          <Icon name="pin" size={16} />
          <span class="status-toggle-name">{campusName(d, selCampus.value)}</span>
          {count > 0 && <i class="status-toggle-count">{count}</i>}
          <Icon name="chevronUp" size={16} />
        </button>
      )}
      <section class="status" id="status-strip" aria-live="polite" hidden={!open}>
        <div class="status-top">
          <p class="status-term">{statusLine()}</p>
          <button
            type="button"
            class="btn ghost status-hide"
            id="status-hide"
            ref={hide}
            aria-expanded="true"
            aria-controls="status-strip"
            aria-label={t("status.hide")}
            title={t("status.hide")}
            onClick={() => (stripOpen.value = false)}
          >
            <Icon name="chevronDown" />
          </button>
        </div>
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
            .filter((c) => c.onMap && !c.area)
            .map((c) => (
              <button type="button" class={c.id === selCampus.value ? "on" : ""} aria-pressed={c.id === selCampus.value} data-campus={c.id} onClick={() => chooseCampus(c.id)}>
                {pick(c.name)}
              </button>
            ))}
          {remote.length > 0 && (
            <label class={`campus-more ${remote.some((c) => c.id === selCampus.value) ? "on" : ""}`}>
              <span class="sr-only">{t("campus.more")}</span>
              <select
                id="campus-more"
                value={remote.some((c) => c.id === selCampus.value) ? selCampus.value : ""}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  if (v) chooseCampus(v);
                }}
              >
                <option value="">{t("campus.more")}</option>
                {remote.map((c) => (
                  <option value={c.id}>{pick(c.name)}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button
          type="button"
          class="walk-start"
          id="walk-start"
          onClick={() => {
            startWalking();
            // A touch screen walks with the thumbs, as in a game, so the walk starts behind the walker.
            if (isLite()) setView({ view: "follow", name: MY_WALKER });
          }}
          title={t("walker.startHint")}
        >
          <Icon name="walk" />
          <span>{t("walker.start")}</span>
        </button>
        <Worlds />
      </section>
    </>
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
        else if (walkerView.value !== "map") setView({ view: "map", name: MY_WALKER });
        else if (panel.value !== "none") panel.value = "none";
        else if (stripOpen.value) stripOpen.value = false;
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
    const stopKeys = startWalkerKeys();
    // Opening a building or taking a walk leaves the campus view; back there, the panel starts shut again.
    const stopStrip = effect(() => {
      if (selBuilding.value || walkerOn.value) stripOpen.value = false;
    });
    return () => {
      stopStrip();
      stopKeys();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  const loaded = !!data.value;
  return (
    <div
      class={`app ${selBuilding.value ? "in-building" : "in-campus"} ${night.value > 0.5 ? "is-night" : "is-day"} panel-${panel.value} ${travel.value ? "travelling" : ""} ${walkerOn.value ? `walking walker-${walkerView.value}` : ""}`}
    >
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
      <WalkerPanel />
      <Attribution />
      <TravelOverlay />
    </div>
  );
}
