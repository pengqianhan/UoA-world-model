// The walker's panel: where it is, the three views, a walk to a place, its outfit, and arrows for
// touch screens. The walker is made up; the panel says so, and that doors are not mapped.
import { useRef, useState } from "preact/hooks";
import { t } from "../app/i18n.ts";
import { ENTER_REACH, MY_WALKER, run, setView, stopWalking, walkerOn, walkerStatus, walkerView } from "../app/walker.ts";
import { OUTFITS } from "../shared/outfit.ts";
import { Icon } from "./common.tsx";
import { isLite } from "./SceneHost.tsx";
import { WALK_SPEED } from "../scene/walkers.ts";

const VIEWS = ["map", "follow", "eyes"] as const;

/** Steers the visitor's walker while an arrow is held down. */
function steer(forward: number, turn: number): void {
  const s = (window as unknown as { __scene?: { walkers: { steer: (n: string, f: number, t: number) => void } } }).__scene;
  s?.walkers.steer(MY_WALKER, forward, turn);
}

function Arrow({ dir, forward, turn }: { dir: "up" | "down" | "left" | "right"; forward: number; turn: number }) {
  const stop = () => steer(0, 0);
  return (
    <button
      type="button"
      class={`walker-arrow arrow-${dir}`}
      aria-label={t(`walker.arrow.${dir}`)}
      title={t(`walker.arrow.${dir}`)}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        steer(forward, turn);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
    >
      <span aria-hidden="true" />
    </button>
  );
}

export function WalkerPanel() {
  const [to, setTo] = useState("");
  const [message, setMessage] = useState<string | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  if (!walkerOn.value) return null;
  const status = walkerStatus.value;
  const view = walkerView.value;
  // The outfit the walker wears now, which an agent may have changed: a preset, or its own.
  const outfit = Object.keys(OUTFITS).find((k) => OUTFITS[k]!.name === status?.outfit) ?? (status?.outfit ? "custom" : "student");
  const touch = isLite();

  const act = async (command: string, args: Record<string, unknown>) => {
    const r = await run(command, { name: MY_WALKER, ...args });
    setMessage(r.error ? String(r.error) : undefined);
  };

  const go = async (e: Event) => {
    e.preventDefault();
    const where = to.trim();
    if (!where) return;
    setMessage(t("walker.walking"));
    const r = await run("walk", { name: MY_WALKER, to: where, speed: 3 });
    if (r.error) setMessage(String(r.error));
    else setMessage(r.arrived ? t("walker.arrived", { place: String(r.to) }) : t("walker.stopped"));
  };

  return (
    <section class={`walker-panel view-${view}`} id="walker-panel" aria-label={t("walker.heading")}>
      <div class="walker-head">
        <h2>{t("walker.heading")}</h2>
        <span class="walker-where" id="walker-where" aria-live="polite">
          {status?.walking
            ? t("walker.walking")
            : status?.indoor
              ? t("walker.inside", { place: status.indoor, floor: status.floor ?? "" })
              : status?.near
                ? t("walker.near", { place: status.near })
                : t("walker.standing")}
        </span>
        <button type="button" class="btn ghost" id="walker-close" aria-label={t("walker.close")} title={t("walker.close")} onClick={stopWalking}>
          <Icon name="close" />
        </button>
      </div>
      <div class="walker-views" role="group" aria-label={t("walker.view.label")}>
        {VIEWS.map((v) => (
          <button type="button" class={v === view ? "on" : ""} aria-pressed={v === view} data-view={v} onClick={() => setView({ view: v, name: MY_WALKER })}>
            {t(`walker.view.${v}`)}
          </button>
        ))}
      </div>
      {(status?.indoor || (status?.nearId && (status.nearMetres ?? Infinity) <= ENTER_REACH)) && (
        <div class="walker-moves" role="group" aria-label={t("walker.moves")}>
          {status.indoor ? (
            <>
              <button type="button" id="walker-up" onClick={() => act("floor", { to: "up" })}>
                {t("walker.up")}
              </button>
              <button type="button" id="walker-down" onClick={() => act("floor", { to: "down" })}>
                {t("walker.down")}
              </button>
              <button type="button" id="walker-exit" onClick={() => act("exit", {})}>
                {t("walker.exit")}
              </button>
            </>
          ) : (
            <button type="button" id="walker-enter" onClick={() => act("enter", {})}>
              {t("walker.enter", { place: status.nearId ?? "" })}
            </button>
          )}
        </div>
      )}
      {touch && (
        <div class="walker-pad" role="group" aria-label={t("walker.arrows")}>
          <Arrow dir="up" forward={WALK_SPEED * 1.6} turn={0} />
          <Arrow dir="left" forward={0} turn={-90} />
          <Arrow dir="right" forward={0} turn={90} />
          <Arrow dir="down" forward={-WALK_SPEED} turn={0} />
        </div>
      )}
      <form class="walker-go" onSubmit={go}>
        <label class="sr-only" for="walker-to">
          {t("walker.goTo")}
        </label>
        <input id="walker-to" ref={input} value={to} placeholder={t("walker.goToPlaceholder")} onInput={(e) => setTo((e.target as HTMLInputElement).value)} autocomplete="off" />
        <button type="submit" class="btn primary">
          {t("walker.go")}
        </button>
      </form>
      {message && (
        <p class="walker-message" id="walker-message" role="status">
          {message}
        </p>
      )}
      <label class="walker-outfit">
        <span>{t("walker.outfit")}</span>
        <select
          id="walker-outfit"
          value={outfit}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v !== "custom") void run("outfit", { name: MY_WALKER, outfit: v });
          }}
        >
          {Object.entries(OUTFITS).map(([id, o]) => (
            <option value={id}>{o.name}</option>
          ))}
          {outfit === "custom" && <option value="custom">{status?.outfit}</option>}
        </select>
      </label>
      <p class="walker-keys">{touch ? t("walker.keysTouch") : t("walker.keys")}</p>
      <p class="walker-note">{t("walker.note")}</p>
    </section>
  );
}
