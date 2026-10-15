// Mounts the three.js scene and keeps it in step with the application state.
import { effect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { loadContext, loadPlans, loadTerrain, mergeContexts } from "../app/data.ts";
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
  sceneWeather,
  selBuilding,
  selCampus,
  selFloor,
  selRoom,
  shown,
  spaceTip,
  sun,
  webglFailed,
} from "../app/state.ts";
import { bindWalkerScene } from "../app/walker.ts";
import { CampusScene } from "../scene/CampusScene.ts";
import { Terrain } from "../scene/terrain.ts";
import type { Building, ContextData, TerrainData } from "../shared/types.ts";
import { buildingTitle } from "./common.tsx";
import { weather } from "./weather.ts";

/** Approximate width in metres to show for each central campus. */
const CAMPUS_SPAN: Record<string, number> = { city: 1250, grafton: 520, newmarket: 620 };

/** Width to show for a campus away from the centre: its buildings with room round them. */
function campusSpan(buildings: Building[]): number {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of buildings) {
    x0 = Math.min(x0, b.center[0]);
    x1 = Math.max(x1, b.center[0]);
    y0 = Math.min(y0, b.center[1]);
    y1 = Math.max(y1, b.center[1]);
  }
  return Number.isFinite(x0) ? Math.max(260, Math.hypot(x1 - x0, y1 - y0) * 1.6) : 900;
}

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
        signTitle: (type) => (type.icon ? t(`space.icon.${type.icon}`) : t(`space.kind.${type.kind}`)),
      });
      if (!scene.ok) throw new Error("no WebGL context");
    } catch (e) {
      console.error(e);
      webglFailed.value = true;
      return;
    }
    (window as unknown as { __scene?: CampusScene }).__scene = scene;
    bindWalkerScene(scene);

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
      const d = data.value;
      const c = d?.campusById.get(selCampus.peek());
      if (c?.onMap) scene.showCampus(c.center, CAMPUS_SPAN[c.id] ?? campusSpan(d!.campus.buildings.filter((b) => b.campus === c.id && !b.offMap)), animate);
    };

    // The ground and surroundings of every area shown so far, the central one first. The ground
    // comes first, so that what stands on it is built once, in place.
    const areas: string[] = [];
    const areaContexts = new Map<string, ContextData>();
    const areaTerrains = new Map<string, TerrainData>();
    const showArea = (area: string | undefined) => {
      const key = area ?? "";
      if (areas.includes(key)) return;
      areas.push(key);
      scene.loading++;
      const terrain = loadTerrain(area).catch((e) => {
        // Without its ground an area is drawn flat, as before.
        console.error("terrain", area ?? "central", e);
        return undefined;
      });
      void Promise.all([loadContext(area), terrain])
        .then(([ctx, ground]) => {
          areaContexts.set(key, ctx);
          if (ground) areaTerrains.set(key, ground);
          const loaded = areas.filter((a) => areaContexts.has(a));
          if (ground) scene.setTerrain(new Terrain(loaded.filter((a) => areaTerrains.has(a)).map((a) => areaTerrains.get(a)!)));
          const contexts = loaded.map((a) => areaContexts.get(a)!);
          scene.setContext(contexts.length === 1 ? contexts[0]! : mergeContexts(contexts));
        })
        .catch((e) => console.error("context", area ?? "central", e))
        .finally(() => scene.loading--);
    };

    let first = true;
    const stops = [
      effect(() => {
        const d = data.value;
        if (!d) return;
        scene.setCampus(d.campus);
        if (!selBuilding.peek()) showCampus(false);
        showArea(undefined);
      }),
      effect(() => {
        // A campus or building away from the centre brings its own surroundings.
        const d = data.value;
        if (!d) return;
        const b = selBuilding.value ? d.buildingById.get(selBuilding.value) : undefined;
        const area = b ? b.area : d.campusById.get(selCampus.value)?.area;
        if (area) showArea(area);
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
      effect(() => scene.setSun(sun.value)),
      effect(() => scene.setWeather(sceneWeather.value)),
      effect(() => scene.setSeason(Number(shown.value.date.slice(5, 7)))),
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
      bindWalkerScene(undefined);
      scene.dispose();
    };
  }, []);

  return (
    <div class="scene">
      <div class="stage" ref={stage} />
      <RainLayer />
      <div class="labels" ref={labels} />
      <SpaceTip />
    </div>
  );
}

/**
 * Rain falling across the view while Open-Meteo reports rain now: streaks on a canvas over the
 * map, slanted with the wind. Decoration for a reported fact; nothing falls for a visitor who
 * asked for less motion.
 */
function RainLayer() {
  const amount = sceneWeather.value?.wet ?? 0;
  const w = weather.value;
  // Wind from the west carries the rain east, which is to the right in the usual view.
  const slant = w ? -Math.sin((w.windFrom * Math.PI) / 180) * Math.min(0.4, w.windSpeed / 80) : 0;
  const dark = night.value > 0.5;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!amount || !c || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const g = c.getContext("2d");
    if (!g) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const drops: { x: number; y: number; length: number; speed: number }[] = [];
    let raf = 0;
    let last = performance.now();
    const fit = () => {
      c.width = Math.round(c.clientWidth * scale);
      c.height = Math.round(c.clientHeight * scale);
      const want = Math.round(Math.min(isLite() ? 260 : 650, (c.clientWidth * c.clientHeight) / 2600) * amount);
      drops.length = 0;
      for (let i = 0; i < want; i++) {
        drops.push({ x: Math.random() * c.width, y: Math.random() * c.height, length: (12 + Math.random() * 12) * scale, speed: (700 + Math.random() * 500) * scale });
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      g.clearRect(0, 0, c.width, c.height);
      g.strokeStyle = dark ? "rgba(196, 214, 236, 0.3)" : "rgba(66, 84, 104, 0.3)";
      g.lineWidth = scale;
      g.beginPath();
      for (const d of drops) {
        d.y += d.speed * dt;
        d.x += d.speed * dt * slant;
        if (d.y > c.height) {
          d.y -= c.height + d.length;
          d.x = Math.random() * c.width;
        }
        if (d.x > c.width) d.x -= c.width;
        if (d.x < 0) d.x += c.width;
        g.moveTo(d.x, d.y);
        g.lineTo(d.x - d.length * slant, d.y - d.length);
      }
      g.stroke();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [amount, slant, dark]);
  if (!amount) return null;
  return <canvas class="rain" id="rain-layer" ref={ref} aria-hidden="true" data-amount={amount} />;
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
