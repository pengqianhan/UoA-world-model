// HTML labels pinned to points in the 3D scene, with priority-based collision culling.
// Real DOM text keeps labels crisp, selectable by screen readers, and able to show macrons
// (ā ē ī ō ū) in whatever font the page uses.
import { Vector3, type Camera } from "three";

export interface LabelSpec {
  id: string;
  /** Scene position in metres. */
  x: number;
  y: number;
  z: number;
  /** Main text, e.g. a building number or room code. */
  text: string;
  /** Secondary text shown after the main text. */
  sub?: string;
  /** Higher wins when labels collide. */
  priority: number;
  /** Extra CSS classes, space separated. */
  className?: string;
  title?: string;
  /** Small counter shown in a badge (e.g. classes in progress). */
  badge?: number;
  onClick?: () => void;
}

interface Entry {
  spec: LabelSpec;
  el: HTMLButtonElement;
  w: number;
  h: number;
  shown: boolean;
  /** Top-left corner on screen when shown. */
  x: number;
  y: number;
}

export class LabelLayer {
  private entries = new Map<string, Entry>();
  private order: Entry[] = [];
  private v = new Vector3();
  private root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Replaces the label set, reusing DOM nodes for ids that persist. */
  set(specs: readonly LabelSpec[]): void {
    const next = new Map<string, Entry>();
    for (const spec of specs) {
      let e = this.entries.get(spec.id);
      if (!e) {
        const el = document.createElement("button");
        el.type = "button";
        el.dataset.label = spec.id;
        this.root.appendChild(el);
        e = { spec, el, w: 0, h: 0, shown: false, x: 0, y: 0 };
        // Labels do not take pointer events (so a drag that starts on one still rotates the map);
        // pointer clicks are hit-tested by the scene. Keyboard and assistive-technology activation
        // still arrives here as a click event.
        el.addEventListener("click", () => this.entries.get(el.dataset.label!)?.spec.onClick?.());
      }
      const prev = e.spec;
      if (e.w === 0 || prev.text !== spec.text || prev.sub !== spec.sub || prev.className !== spec.className || prev.badge !== spec.badge) {
        // Rewriting the class list must not drop the visibility state the layout pass maintains.
        e.el.className = `lbl ${spec.className ?? ""}${e.shown ? " on" : ""}${this.hot === spec.id ? " hot" : ""}`;
        e.el.replaceChildren();
        const b = document.createElement("b");
        b.textContent = spec.text;
        e.el.appendChild(b);
        if (spec.sub) {
          const s = document.createElement("span");
          s.textContent = spec.sub;
          e.el.appendChild(s);
        }
        if (spec.badge) {
          const n = document.createElement("i");
          n.textContent = String(spec.badge);
          e.el.appendChild(n);
        }
        e.w = 0;
      }
      if (spec.title) e.el.title = spec.title;
      else e.el.removeAttribute("title");
      e.el.tabIndex = -1;
      e.spec = spec;
      next.set(spec.id, e);
    }
    for (const [id, e] of this.entries) if (!next.has(id)) e.el.remove();
    this.entries = next;
    this.order = [...next.values()].sort((a, b) => b.spec.priority - a.spec.priority);
  }

  /** Positions labels for the current camera and hides the ones that would overlap a more important one. */
  update(camera: Camera, width: number, height: number): void {
    // Measure new labels in one pass before writing any styles.
    for (const e of this.order) {
      if (e.w === 0) {
        e.w = e.el.offsetWidth;
        e.h = e.el.offsetHeight;
      }
    }
    const taken: [number, number, number, number][] = [];
    const pad = 3;
    for (const e of this.order) {
      const s = e.spec;
      this.v.set(s.x, s.y, s.z).project(camera);
      const sx = (this.v.x * 0.5 + 0.5) * width;
      const sy = (-this.v.y * 0.5 + 0.5) * height;
      const x0 = sx - e.w / 2;
      const y0 = sy - e.h - 4;
      const x1 = x0 + e.w;
      const y1 = y0 + e.h;
      let visible = this.v.z > -1 && this.v.z < 1 && x1 > 0 && x0 < width && y1 > 0 && y0 < height;
      if (visible) {
        for (const r of taken) {
          if (x0 < r[2] + pad && x1 > r[0] - pad && y0 < r[3] + pad && y1 > r[1] - pad) {
            visible = false;
            break;
          }
        }
      }
      if (visible) {
        taken.push([x0, y0, x1, y1]);
        e.x = Math.round(x0);
        e.y = Math.round(y0);
        e.el.style.transform = `translate(${e.x}px, ${e.y}px)`;
      }
      if (visible !== e.shown) {
        e.shown = visible;
        e.el.classList.toggle("on", visible);
      }
    }
  }

  /** The visible label under a point (in the layer's own pixel coordinates), if any. */
  hit(x: number, y: number): LabelSpec | undefined {
    for (const e of this.order) {
      if (e.shown && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) return e.spec;
    }
    return undefined;
  }

  /** Marks one label as hovered (or none). */
  setHot(id: string | undefined): void {
    if (id === this.hot) return;
    if (this.hot) this.entries.get(this.hot)?.el.classList.remove("hot");
    this.hot = id;
    if (id) this.entries.get(id)?.el.classList.add("hot");
  }
  private hot?: string;

  clear(): void {
    this.set([]);
  }
}
