// The walker's panel: where it is, the three views, a walk to a place, and on a touch screen a
// thumb stick, as in a game: one thumb walks and turns the walker while the other drags the view
// round. The walker is made up; the panel says so, and that doors are not mapped.
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../app/i18n.ts";
import { selBuilding } from "../app/state.ts";
import { ENTER_REACH, MY_WALKER, run, setView, steerByHand, stopWalking, walkerOn, walkerStatus, walkerView, wanderingNow } from "../app/walker.ts";
import { Icon } from "./common.tsx";
import { isLite } from "./SceneHost.tsx";
import { WALK_SPEED } from "../scene/walkers.ts";

const VIEWS = ["map", "follow", "eyes"] as const;

/** How far the stick must be pushed, as a share of its reach, before it does anything. */
const DEAD_ZONE = 0.18;
/** Metres a second with the stick pushed all the way up: a jog. Pulled down, it steps back at a walk. */
const STICK_FORWARD = WALK_SPEED * 2.2;
const STICK_BACK = WALK_SPEED;
/** Degrees a second with the stick pushed all the way to one side. */
const STICK_TURN = 120;
/** Share of the stick's reach that its knob travels. */
const KNOB_TRAVEL = 0.6;

/** -1 to 1 along one of the stick's axes, without the dead zone. */
function axis(v: number): number {
  const a = Math.abs(v);
  return a <= DEAD_ZONE ? 0 : (Math.sign(v) * (a - DEAD_ZONE)) / (1 - DEAD_ZONE);
}

/**
 * A thumb stick, as in a game on a phone: pushed up the walker walks on, faster the further it
 * goes; pulled down it steps back; pushed to a side it turns. It steers as the keys do, and like
 * them it stops a walk to a place.
 */
function Stick({ onSteer }: { onSteer: () => void }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const finger = useRef<number | undefined>(undefined);
  // A stick let go of by the page (the walk closed under the thumb) stops the walker.
  useEffect(
    () => () => {
      if (finger.current !== undefined) steerByHand(0, 0);
    },
    [],
  );

  const push = (e: PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const reach = r.width / 2;
    let x = (e.clientX - r.left - reach) / reach;
    let y = (e.clientY - r.top - reach) / reach;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    if (knob.current) knob.current.style.transform = `translate(${x * reach * KNOB_TRAVEL}px, ${y * reach * KNOB_TRAVEL}px)`;
    const forward = -axis(y);
    const turn = axis(x);
    // Squared, so that a little push to the side turns a little and the stick can hold a line.
    steerByHand(forward > 0 ? forward * STICK_FORWARD : forward * STICK_BACK, turn * Math.abs(turn) * STICK_TURN);
  };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== finger.current) return;
    finger.current = undefined;
    base.current?.classList.remove("held");
    if (knob.current) knob.current.style.transform = "";
    steerByHand(0, 0);
  };

  return (
    <div
      class="walker-stick"
      id="walker-stick"
      ref={base}
      aria-hidden="true"
      onPointerDown={(e) => {
        if (finger.current !== undefined) return;
        finger.current = e.pointerId;
        // The thumb keeps the stick when it slides off it. A pointer the browser no longer knows cannot be kept.
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // Steered all the same, while it stays over the stick.
        }
        base.current?.classList.add("held");
        onSteer();
        push(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === finger.current) push(e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span class="walker-knob" ref={knob} />
    </div>
  );
}

/**
 * Pixels at the foot of the screen that the open building's dock covers, which the thumb controls
 * stand above; and whether it reaches across to the right-hand thumb too.
 */
function useDock(active: boolean): { lift: number; wide: boolean } {
  const building = selBuilding.value;
  const [dock, setDock] = useState({ lift: 0, wide: false });
  useEffect(() => {
    const el = active && building ? document.querySelector<HTMLElement>(".dock") : null;
    if (!el) {
      setDock({ lift: 0, wide: false });
      return;
    }
    const measure = () => {
      const r = el.getBoundingClientRect();
      const app = el.parentElement!.getBoundingClientRect();
      setDock({ lift: Math.max(0, Math.round(app.bottom - r.top)), wide: r.right > app.left + app.width * 0.6 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [building, active]);
  return dock;
}

export function WalkerPanel() {
  const touch = isLite();
  const [to, setTo] = useState("");
  const [message, setMessage] = useState<string | undefined>(undefined);
  // Everything but the views and the way in and out: shown on a wide screen, behind a button on a touch screen.
  const [more, setMore] = useState(() => !touch);
  // On a touch screen the whole panel waits as a small button, so the walk has the screen.
  const [open, setOpen] = useState(false);
  const shown = !touch || open;
  const input = useRef<HTMLInputElement>(null);
  const show = useRef<HTMLButtonElement>(null);
  const hide = useRef<HTMLButtonElement>(null);
  const dock = useDock(touch && walkerOn.value);
  // Each walk starts with the panel folded away.
  const on = walkerOn.value;
  useEffect(() => {
    if (on) setOpen(false);
  }, [on]);
  // Focus goes with the panel, for whoever is using the keyboard: into it, and back to its button.
  const was = useRef(open);
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    (open ? hide : show).current?.focus();
  }, [open]);
  if (!walkerOn.value) return null;
  const status = walkerStatus.value;
  const view = walkerView.value;
  const wandering = wanderingNow.value.has(MY_WALKER);

  const act = async (command: string, args: Record<string, unknown>) => {
    const r = await run(command, { name: MY_WALKER, ...args });
    setMessage(r.error ? String(r.error) : undefined);
    // What went wrong is said in the panel, so the panel opens to say it.
    if (r.error) setOpen(true);
  };

  const go = async (e: Event) => {
    e.preventDefault();
    const where = to.trim();
    if (!where) return;
    // On a touch screen the panel folds away, so that the walk can be watched.
    if (touch) {
      setMore(false);
      setOpen(false);
    }
    setMessage(t("walker.walking"));
    const r = await run("walk", { name: MY_WALKER, to: where, speed: 3 });
    if (r.error) {
      setMessage(String(r.error));
      setOpen(true);
    } else setMessage(r.arrived ? t("walker.arrived", { place: String(r.to) }) : t("walker.stopped"));
  };

  const moves =
    status?.indoor ? (
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
    ) : status?.nearId && (status.nearMetres ?? Infinity) <= ENTER_REACH ? (
      <button type="button" id="walker-enter" onClick={() => act("enter", {})}>
        {t("walker.enter", { place: status.nearId })}
      </button>
    ) : undefined;

  return (
    <>
      {!shown && (
        <button
          type="button"
          class="walker-toggle"
          id="walker-toggle"
          ref={show}
          aria-expanded="false"
          aria-controls="walker-panel"
          aria-label={t("walker.show")}
          title={t("walker.show")}
          onClick={() => setOpen(true)}
        >
          <Icon name="walk" size={16} />
          <span>{t("walker.heading")}</span>
          <Icon name="chevronDown" size={16} />
        </button>
      )}
      <section
        class={`walker-panel view-${view} ${touch ? "touch" : ""} ${more ? "more" : ""}`}
        id="walker-panel"
        aria-label={t("walker.heading")}
        hidden={!shown}
      >
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
          <button
            type="button"
            class="btn ghost walker-more"
            id="walker-more"
            aria-expanded={more}
            aria-controls="walker-menu"
            aria-label={t("walker.more")}
            title={t("walker.more")}
            onClick={() => setMore(!more)}
          >
            <Icon name="more" />
          </button>
          {touch && (
            <button
              type="button"
              class="btn ghost"
              id="walker-hide"
              ref={hide}
              aria-expanded="true"
              aria-controls="walker-panel"
              aria-label={t("walker.hide")}
              title={t("walker.hide")}
              onClick={() => setOpen(false)}
            >
              <Icon name="chevronUp" />
            </button>
          )}
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
        {moves && !touch && (
          <div class="walker-moves" role="group" aria-label={t("walker.moves")}>
            {moves}
          </div>
        )}
        {message && (
          <p class="walker-message" id="walker-message" role="status">
            {message}
          </p>
        )}
        <div class="walker-menu" id="walker-menu" hidden={!more}>
          <form class="walker-go" onSubmit={go}>
            <label class="sr-only" for="walker-to">
              {t("walker.goTo")}
            </label>
            <input id="walker-to" ref={input} value={to} placeholder={t("walker.goToPlaceholder")} onInput={(e) => setTo((e.target as HTMLInputElement).value)} autocomplete="off" />
            <button type="submit" class="btn primary">
              {t("walker.go")}
            </button>
          </form>
          <button
            type="button"
            class={`walker-wander ${wandering ? "on" : ""}`}
            id="walker-wander"
            aria-pressed={wandering}
            onClick={() => {
              if (touch && !wandering) setMore(false);
              void run(wandering ? "stop" : "wander", { name: MY_WALKER });
            }}
          >
            {wandering ? t("walker.wanderStop") : t("walker.wander")}
          </button>
          <p class="walker-keys">{touch ? t("walker.keysTouch") : t("walker.keys")}</p>
          <p class="walker-note">{t("walker.note")}</p>
        </div>
      </section>
      {touch && (
        <div class="walker-thumbs" style={dock.lift ? { "--stick-lift": `${dock.lift + 8}px`, ...(dock.wide ? { "--moves-lift": `${dock.lift + 8}px` } : {}) } : undefined}>
          <Stick onSteer={() => setMessage(undefined)} />
          {moves && (
            <div class="walker-moves walker-actions" role="group" aria-label={t("walker.moves")}>
              {moves}
            </div>
          )}
        </div>
      )}
    </>
  );
}
