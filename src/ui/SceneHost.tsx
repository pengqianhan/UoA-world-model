// Mounts the three.js scene and keeps it in step with the application state.
import { effect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { loadContext, loadPlans } from "../app/data.ts";
import { lang, pick, t } from "../app/i18n.ts";
import {
  busyBuildings,
  busyRooms,
  data,
  frameRequest,
  marker,
  night,
  openBuilding,
  openRoom,
  plansLoaded,
  selBuilding,
  selCampus,
  selFloor,
  selRoom,
  spaceTip,
  webglFailed,
} from "../app/state.ts";
import { CampusScene } from "../scene/CampusScene.ts";
import { buildingTitle } from "./common.tsx";

/** Approximate width in metres to show for each campus that is on the map. */
const CAMPUS_SPAN: Record<string, number> = { city: 1250, grafton: 520, newmarket: 620 };

export const isLite = () => window.matchMedia("(max-width: 720px), (pointer: coarse)").matches;

export function SceneHost() {
  const stage = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const lite = isLite();
    let scene: CampusScene;
    try {
      scene = new CampusScene(stage.current!, labels.current!, {
        lite,
        buildingLabel: (b) => ({
          text: b.id,
          sub: lite && b.roomCount < 12 ? undefined : buildingTitle(b) || undefined,
          title: `${t("building.number", { id: b.id })}${buildingTitle(b) ? ` · ${buildingTitle(b)}` : ""}`,
        }),
        roomLabel: (r) => ({
          text: r.code.slice(r.b.length + 1),
          title: `${r.code} · ${pick(r.name)}`,
        }),
      });
      if (!scene.ok) throw new Error("no WebGL context");
    } catch (e) {
      console.error(e);
      webglFailed.value = true;
      return;
    }
    (window as unknown as { __scene?: CampusScene }).__scene = scene;

    scene.onPick = (p) => {
      if (p?.type === "building") openBuilding(p.id);
      else if (p?.type === "room") openRoom(p.code);
    };
    scene.onSpace = (s) => {
      const rect = stage.current!.getBoundingClientRect();
      // The tip stands above the pointer, centred on it; keep it inside the stage.
      const x = Math.min(Math.max(s ? s.x - rect.left : 0, 120), rect.width - 120);
      const y = Math.max(s ? s.y - rect.top : 0, 72);
      spaceTip.value = s ? { type: s.type, x, y } : undefined;
    };

    const showCampus = (animate: boolean) => {
      const c = data.value?.campusById.get(selCampus.peek());
      if (c?.onMap) scene.showCampus(c.center, CAMPUS_SPAN[c.id] ?? 900, animate);
    };

    let first = true;
    const stops = [
      effect(() => {
        const d = data.value;
        if (!d) return;
        scene.setCampus(d.campus);
        if (!selBuilding.peek()) showCampus(false);
        void loadContext()
          .then((ctx) => scene.setContext(ctx))
          .catch((e) => console.error("context", e));
      }),
      effect(() => {
        if (!data.value) return;
        const sel = { building: selBuilding.value, floor: selFloor.value, room: selRoom.value };
        scene.setSelection(sel, !first);
      }),
      effect(() => {
        // The rest of the open building's floors arrives after the building itself.
        const b = selBuilding.value ? data.value?.buildingById.get(selBuilding.value) : undefined;
        if (!b?.planShapes || b.offMap) return;
        scene.loading++;
        void loadPlans(b.id)
          .then((plans) => {
            scene.setPlans(plans);
            if (!plansLoaded.peek().has(b.id)) plansLoaded.value = new Map(plansLoaded.peek()).set(b.id, plans);
          })
          .catch((e) => console.error("plans", e))
          .finally(() => scene.loading--);
      }),
      effect(() => {
        const m = marker.value;
        scene.setPin(m?.at ? { at: m.at, text: m.code.slice(m.building.length + 1), title: m.code } : undefined, !first);
      }),
      effect(() => {
        // Re-frame on request, and whenever the selection is cleared.
        frameRequest.value;
        if (data.value && !selBuilding.value) showCampus(!first);
      }),
      effect(() => {
        // Keep the point of interest clear of the panels: the dock sits bottom-left on wide
        // screens and across the bottom on phones.
        const inBuilding = !!selBuilding.value;
        const hasCard = !!selRoom.value;
        if (window.matchMedia("(max-width: 720px)").matches) scene.setViewShift(0, inBuilding ? (hasCard ? 0.2 : 0.07) : 0.03, !first);
        else scene.setViewShift(inBuilding ? 0.12 : 0, 0, !first);
      }),
      effect(() => scene.setBusyRooms(busyRooms.value)),
      effect(() => scene.setBuildingBadges(busyBuildings.value)),
      effect(() => scene.setNight(night.value)),
      effect(() => {
        lang.value;
        scene.refreshLabels();
        stage.current?.querySelector("canvas")?.setAttribute("aria-label", t("app.sceneLabel"));
      }),
    ];
    first = false;

    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(stage.current!);
    return () => {
      ro.disconnect();
      stops.forEach((stop) => stop());
      scene.dispose();
    };
  }, []);

  return (
    <div class="scene">
      <div class="stage" ref={stage} />
      <div class="labels" ref={labels} />
      <SpaceTip />
    </div>
  );
}

/** What an unnamed space on the open floor is, by the campus map's type for it. */
function SpaceTip() {
  const tip = spaceTip.value;
  if (!tip) return null;
  return (
    <div class="space-tip" id="space-tip" role="status" style={{ left: `${tip.x}px`, top: `${tip.y}px` }}>
      <span class="space-tip-kind">
        <span class={`kind-dot space-${tip.type.kind}`} aria-hidden="true" />
        {t(`space.kind.${tip.type.kind}`)}
      </span>
      {tip.type.text && <span class="space-tip-source">{t("space.sourceType", { type: tip.type.text })}</span>}
    </div>
  );
}
