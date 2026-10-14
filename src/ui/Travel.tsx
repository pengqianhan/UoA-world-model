// The way to another university's campus map: a link that, when followed, plays a short flight
// through space before the browser leaves for that site.
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { intlLocale, t } from "../app/i18n.ts";
import { WORLDS, type World } from "../app/links.ts";
import { data } from "../app/state.ts";
import { greatCircleKm } from "../shared/geo.ts";
import { Icon } from "./common.tsx";

/** The journey in progress, if any. */
export const travel = signal<World | undefined>(undefined);

/** Seconds of flight before the browser is sent on its way. */
const FLIGHT = 2.2;
const STAR_COLOURS = ["#eef3f6", "#eef3f6", "#eef3f6", "#eef3f6", "#ffb454", "#6ed3c8"];

let departed = false;
let followed: HTMLElement | undefined;

/** Calls the journey off, also after the browser has been told to go. */
export function cancelTravel(): void {
  if (!travel.value) return;
  if (departed) window.stop();
  travel.value = undefined;
  // Back to the link that was followed, for whoever is using the keyboard.
  followed?.focus();
}

const worldName = (w: World) => t(`travel.worlds.${w.id}.name`);

function depart(e: MouseEvent, world: World): void {
  // A new tab or window is the browser's business, and a visitor who asked for less motion gets a plain link.
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  e.preventDefault();
  followed = e.currentTarget as HTMLElement;
  travel.value = world;
}

export function WorldLink({ world }: { world: World }) {
  return (
    <a class="world" data-world={world.id} href={world.url} title={t("travel.go", { name: worldName(world) })} onClick={(e) => depart(e, world)}>
      <Icon name="star" size={14} />
      <span>{worldName(world)}</span>
    </a>
  );
}

/** The row of other worlds under the campus tabs. */
export function Worlds() {
  return (
    <div class="worlds" role="group" aria-label={t("travel.heading")}>
      <span class="worlds-label">{t("travel.heading")}</span>
      {WORLDS.map((w) => (
        <WorldLink world={w} />
      ))}
    </div>
  );
}

interface Star {
  x: number;
  y: number;
  z: number;
  colour: string;
}

const newStar = (z: number): Star => ({
  x: Math.random() * 2 - 1,
  y: Math.random() * 2 - 1,
  z,
  colour: STAR_COLOURS[Math.floor(Math.random() * STAR_COLOURS.length)]!,
});

/** Pixels the star canvas is allowed. Streaks do not need more, and a renderer without a GPU cannot keep up with more. */
const CANVAS_PIXELS = 1_500_000;

/** Stars rushing past, faster and faster; the canvas stays clear where there is no star. */
function fly(canvas: HTMLCanvasElement, onProgress: (p: number) => void): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  let dpr = 1;
  const fit = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(CANVAS_PIXELS / Math.max(1, canvas.clientWidth * canvas.clientHeight)));
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  };
  fit();
  window.addEventListener("resize", fit);

  const count = canvas.clientWidth < 720 ? 260 : 460;
  const stars = Array.from({ length: count }, () => newStar(0.05 + Math.random() * 0.95));
  const started = performance.now();
  let last = started;
  let frame = 0;

  const draw = (now: number) => {
    frame = requestAnimationFrame(draw);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const p = Math.min(1, (now - started) / 1000 / FLIGHT);
    onProgress(p);

    const { width: w, height: h } = canvas;
    const cx = w / 2;
    const cy = h / 2;
    const reach = Math.max(w, h) * 0.55;
    // Depth covered per second: a drift at first, then most of the way to the viewer in a blink.
    const speed = 0.06 + 2.8 * p * p * p;
    const streak = speed * 0.07;
    const appear = Math.min(1, p * 5);

    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    for (const s of stars) {
      const from = s.z;
      s.z -= speed * dt;
      const x1 = cx + (s.x / s.z) * reach;
      const y1 = cy + (s.y / s.z) * reach;
      if (s.z <= 0.02 || x1 < -40 || x1 > w + 40 || y1 < -40 || y1 > h + 40) {
        Object.assign(s, newStar(1));
        continue;
      }
      const tail = from + streak;
      const near = 1 - s.z;
      ctx.globalAlpha = appear * Math.min(1, 0.15 + near * 1.5);
      ctx.strokeStyle = s.colour;
      ctx.lineWidth = (0.7 + near * 1.9) * dpr;
      ctx.beginPath();
      ctx.moveTo(cx + (s.x / tail) * reach, cy + (s.y / tail) * reach);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  frame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", fit);
  };
}

/** Covers the page while a journey is under way. */
export function TravelOverlay() {
  const world = travel.value;
  const canvas = useRef<HTMLCanvasElement>(null);
  const counter = useRef<HTMLParagraphElement>(null);
  const stay = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!world || !canvas.current) return;
    departed = false;
    stay.current?.focus();
    const origin = data.value?.campus.origin;
    // To the nearest ten: the two points stand for whole campuses.
    const total = origin ? Math.round(greatCircleKm(origin, world) / 10) * 10 : 0;
    const show = (km: number) => {
      if (counter.current && total) counter.current.textContent = t("travel.distance", { km: km.toLocaleString(intlLocale()) });
    };
    // The count eases in and out, as a journey does, and stands still once the whole distance is shown.
    const stop = fly(canvas.current, (p) => {
      if (!departed) show(Math.round(total * (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2)));
    });
    // A timer sends the browser on its way, not a frame: frames stop in a hidden tab and can stall on a slow machine.
    const timer = window.setTimeout(() => {
      departed = true;
      show(total);
      window.location.assign(world.url);
    }, FLIGHT * 1000);
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [world]);

  if (!world) return null;
  return (
    <div class="travel" id="travel" role="dialog" aria-modal="true" aria-label={t("travel.label", { name: worldName(world) })}>
      <canvas ref={canvas} aria-hidden="true" />
      <div class="travel-card">
        <p class="travel-from">{t("travel.leaving")}</p>
        <p class="travel-to">{worldName(world)}</p>
        <p class="travel-place">{t(`travel.worlds.${world.id}.place`)}</p>
        <p class="travel-distance" ref={counter} aria-hidden="true" />
        <button type="button" class="btn" ref={stay} onClick={cancelTravel}>
          {t("travel.stay")}
        </button>
      </div>
    </div>
  );
}
