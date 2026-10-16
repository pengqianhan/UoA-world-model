// The walkers on the map: made-up figures that a visitor steers with the keyboard, or that an
// agent steers through the page (src/app/walker.ts). Each walks on the ground, round buildings,
// along the ways planned by the walking map, and can say things that other walkers near it hear.
// Nothing here is about a real person or where one is.
import { Group } from "three";
import type { Pt } from "../shared/geo.ts";
import { WalkMap, type WalkPlan } from "../shared/walkmap.ts";
import type { WalkGrid } from "../shared/walkpath.ts";
import { cellOf } from "../shared/walkpath.ts";
import { Figure } from "./figure.ts";
import type { LabelSpec } from "./labels.ts";

/** Metres a second: an easy walk. */
export const WALK_SPEED = 1.4;
/** The fastest an agent may ask for, metres a second: time sped up, not a run. */
export const MAX_SPEED = 40;
/** Degrees a second a walker turns towards where it is going. */
const TURN_RATE = 400;
/** Metres within which a walker hears what another says, out of doors. */
export const HEAR_RANGE = 25;
/** Metres the paint of paths and streets lies over the ground (see CampusScene.setContext). */
const GROUND_PAINT = 0.25;
/** Box of walkable ground kept round a walker steered by hand, metres; rebuilt near its edge. */
const LOCAL_BOX = 160;

/** What the scene lends the walkers: the ground, the walking map, and the open floor. */
export interface WalkerHost {
  groundAt(x: number, y: number): number;
  walkMap(): WalkMap | undefined;
  /** Height to stand at inside a building, on a floor; undefined when unknown. */
  floorTop(building: string, floor: number): number | undefined;
  /** Whether a point is on a floor of a building, for a walker steered by hand indoors. */
  insideFloor(building: string, floor: number, p: Pt): boolean;
  /** 0-1: how hard it is raining where the walkers are. */
  rain(): number;
  ringColour(): number;
}

export interface Speech {
  from: string;
  text: string;
  /** ms since the page loaded, as performance.now gives it. */
  at: number;
  where: Pt;
  indoor?: { building: string; floor: number };
}

/** Where a walk ends and how it went. */
export interface WalkResult {
  arrived: boolean;
  /** Why it stopped short: another command, or no way on foot. */
  reason?: string;
  metres: number;
  seconds: number;
}

interface Walk {
  points: Pt[];
  leg: number;
  speed: number;
  metres: number;
  startedAt: number;
  resolve: (r: WalkResult) => void;
}

export interface WalkerState {
  name: string;
  at: Pt;
  /** Height of the feet above sea level, metres. */
  height: number;
  heading: number;
  indoor?: { building: string; floor: number };
  walking: boolean;
  saying?: string;
}

class Walker {
  figure: Figure;
  at: Pt;
  heading: number;
  height = 0;
  indoor?: { building: string; floor: number };
  walk?: Walk;
  moving = 0;
  /** Metres a second it is going at, smoothed, for the figure's walk or run. */
  pace = 0;
  /** What it says, for `ms` from the first frame that shows it (`until` is set then). */
  speech?: { text: string; ms: number; until?: number };
  heardUpTo = 0;
  /** Steering by hand: metres a second forward, degrees a second of turn. */
  drive = { forward: 0, turn: 0 };
  /** When the steering by hand was last added up, ms (performance.now). */
  driveFrom = 0;
  nameLabel: LabelSpec;
  sayLabel: LabelSpec;

  constructor(
    readonly name: string,
    at: Pt,
    heading: number,
    ring: number,
  ) {
    this.at = at;
    this.heading = heading;
    this.figure = new Figure(ring);
    this.nameLabel = { id: `walker:${name}`, x: 0, y: 0, z: 0, text: name, priority: 9e6, className: "lbl-walker" };
    this.sayLabel = { id: `say:${name}`, x: 0, y: 0, z: 0, text: "", priority: 1e7, className: "lbl-say" };
  }
}

export class WalkerWorld {
  readonly group = new Group();
  private walkers = new Map<string, Walker>();
  private said: Speech[] = [];
  private local?: { grid: WalkGrid; box: [number, number, number, number] };
  private now = 0;
  /** Bumped when labels must be rebuilt (a walker came, went, or spoke). */
  labelsVersion = 0;

  constructor(private host: WalkerHost) {
    this.group.userData.noPick = true;
  }

  get size(): number {
    return this.walkers.size;
  }

  names(): string[] {
    return [...this.walkers.keys()];
  }

  has(name: string): boolean {
    return this.walkers.has(name);
  }

  /** Puts a walker on the map, facing `heading`. Replaces one of the same name. */
  spawn(name: string, at: Pt, heading: number): WalkerState {
    this.remove(name);
    const w = new Walker(name, at, heading, this.host.ringColour());
    w.heardUpTo = this.now;
    this.walkers.set(name, w);
    this.group.add(w.figure.root);
    this.place(w);
    this.labelsVersion++;
    return this.state(name)!;
  }

  remove(name: string): boolean {
    const w = this.walkers.get(name);
    if (!w) return false;
    this.cancel(w, "removed");
    this.group.remove(w.figure.root);
    w.figure.dispose();
    this.walkers.delete(name);
    this.labelsVersion++;
    return true;
  }

  state(name: string): WalkerState | undefined {
    const w = this.walkers.get(name);
    if (!w) return undefined;
    return {
      name: w.name,
      at: [Math.round(w.at[0] * 10) / 10, Math.round(w.at[1] * 10) / 10],
      height: Math.round(w.height * 10) / 10,
      heading: Math.round(w.heading),
      indoor: w.indoor ? { ...w.indoor } : undefined,
      walking: !!w.walk,
      saying: w.speech && (w.speech.until === undefined || w.speech.until > this.now) ? w.speech.text : undefined,
    };
  }

  /** The point, heading and height a camera follows. */
  pose(name: string): { at: Pt; heading: number; height: number; indoor: boolean } | undefined {
    const w = this.walkers.get(name);
    return w ? { at: w.at, heading: w.heading, height: w.height, indoor: !!w.indoor } : undefined;
  }

  figure(name: string): Figure | undefined {
    return this.walkers.get(name)?.figure;
  }

  /** Walks along a planned way. Resolves when the walker gets there or is stopped. */
  follow(name: string, plan: WalkPlan, speed: number): Promise<WalkResult> {
    const w = this.walkers.get(name);
    if (!w) return Promise.resolve({ arrived: false, reason: "no such walker", metres: 0, seconds: 0 });
    this.cancel(w, "another command");
    w.drive = { forward: 0, turn: 0 };
    return new Promise((resolve) => {
      w.walk = {
        points: plan.points.slice(),
        leg: 1,
        speed: Math.max(0.3, Math.min(MAX_SPEED, speed)),
        metres: 0,
        startedAt: this.now,
        resolve,
      };
      if (plan.points.length < 2) this.finish(w, true);
    });
  }

  /** Plans and walks to a point out of doors. */
  walkTo(name: string, to: Pt, speed: number): Promise<WalkResult> {
    const w = this.walkers.get(name);
    const map = this.host.walkMap();
    if (!w || !map) return Promise.resolve({ arrived: false, reason: !w ? "no such walker" : "the map is still loading", metres: 0, seconds: 0 });
    const plan = map.planTo(w.at, to);
    if (!plan) return Promise.resolve({ arrived: false, reason: "there is no way there on foot", metres: 0, seconds: 0 });
    return this.follow(name, plan, speed);
  }

  /** Plans and walks to the ground beside a University building. */
  walkToBuilding(name: string, building: string, speed: number): Promise<WalkResult> {
    const w = this.walkers.get(name);
    const map = this.host.walkMap();
    if (!w || !map) return Promise.resolve({ arrived: false, reason: !w ? "no such walker" : "the map is still loading", metres: 0, seconds: 0 });
    const plan = map.planToBuilding(w.at, building);
    if (!plan) return Promise.resolve({ arrived: false, reason: "there is no way there on foot", metres: 0, seconds: 0 });
    return this.follow(name, plan, speed);
  }

  /** Stops a walk in progress. */
  stop(name: string): void {
    const w = this.walkers.get(name);
    if (w) {
      this.cancel(w, "stopped");
      w.drive = { forward: 0, turn: 0 };
    }
  }

  /** Turns on the spot, by degrees (positive to the right), or to face a bearing. */
  turn(name: string, by: number, absolute = false): void {
    const w = this.walkers.get(name);
    if (!w) return;
    w.heading = (((absolute ? by : w.heading + by) % 360) + 360) % 360;
    w.figure.setHeading(w.heading);
  }

  /** Steering by hand, for the keyboard: metres a second forward (negative back), degrees a second of turn. */
  steer(name: string, forward: number, turn: number): void {
    const w = this.walkers.get(name);
    if (!w) return;
    // A key held until now counts for all the time it was held, though no frame was drawn meanwhile.
    this.driveUntil(w, performance.now());
    if (forward || turn) this.cancel(w, "steered by hand");
    w.drive = { forward, turn };
  }

  /**
   * Adds up the steering by hand from when it was last added up to `t` (ms), in steps of a tenth
   * of a second at most, so that a slow frame cannot carry the walker through a wall or a tree.
   */
  private driveUntil(w: Walker, t: number): number {
    const span = w.driveFrom && (w.drive.forward || w.drive.turn) ? Math.min(2, Math.max(0, (t - w.driveFrom) / 1000)) : 0;
    w.driveFrom = Math.max(w.driveFrom, t);
    let travelled = 0;
    for (let left = span; left > 1e-6; left -= 0.1) travelled += this.drive(w, Math.min(0.1, left));
    if (travelled > 0) this.place(w);
    return travelled;
  }

  /** Moves a walker straight to a point, without walking: into or out of a building. */
  teleport(name: string, at: Pt, indoor?: { building: string; floor: number }): void {
    const w = this.walkers.get(name);
    if (!w) return;
    this.cancel(w, "moved");
    w.at = [at[0], at[1]];
    w.indoor = indoor ? { ...indoor } : undefined;
    this.place(w);
  }

  /** Puts a walker on a floor of the building it is in, at the same spot. */
  setIndoor(name: string, indoor: { building: string; floor: number } | undefined): void {
    const w = this.walkers.get(name);
    if (!w) return;
    w.indoor = indoor ? { ...indoor } : undefined;
    this.place(w);
  }

  /** Says something: shown over the walker's head, and heard by walkers near it. */
  say(name: string, text: string): Speech | undefined {
    const w = this.walkers.get(name);
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!w || !clean) return undefined;
    // Shown for its time from the first frame that draws it, which on a slow screen may be a while.
    w.speech = { text: clean, ms: Math.min(15000, 3500 + clean.length * 70) };
    w.sayLabel.text = clean;
    const s: Speech = { from: name, text: clean, at: this.now, where: [w.at[0], w.at[1]], indoor: w.indoor ? { ...w.indoor } : undefined };
    this.said.push(s);
    if (this.said.length > 500) this.said.splice(0, this.said.length - 500);
    this.labelsVersion++;
    return s;
  }

  /** What other walkers said near this one since it last listened. */
  listen(name: string): Speech[] {
    const w = this.walkers.get(name);
    if (!w) return [];
    const heard = this.said.filter((s) => {
      if (s.from === name || s.at <= w.heardUpTo) return false;
      const sameFloor = !!s.indoor && !!w.indoor && s.indoor.building === w.indoor.building && s.indoor.floor === w.indoor.floor;
      const bothOut = !s.indoor && !w.indoor;
      return (bothOut || sameFloor) && Math.hypot(s.where[0] - w.at[0], s.where[1] - w.at[1]) <= HEAR_RANGE;
    });
    w.heardUpTo = this.now;
    return heard;
  }

  /** Name and speech labels, at the walkers' heads. */
  labels(): LabelSpec[] {
    const out: LabelSpec[] = [];
    for (const w of this.walkers.values()) {
      out.push(w.nameLabel);
      if (w.speech && (w.speech.until === undefined || w.speech.until > this.now)) out.push(w.sayLabel);
    }
    return out;
  }

  /**
   * Moves every walker on by `dt` seconds. Returns true when anything moved or changed, so that
   * the scene draws a frame.
   */
  step(dt: number, now: number): boolean {
    this.now = now;
    let changed = false;
    const rain = this.host.rain();
    for (const w of this.walkers.values()) {
      const was = { x: w.at[0], y: w.at[1], h: w.heading, m: w.moving };
      let travelled = 0;
      if (w.walk) travelled = this.advance(w, dt);
      else travelled = this.driveUntil(w, now);
      const target = travelled > 0 ? 1 : 0;
      w.moving += (target - w.moving) * Math.min(1, dt * 6);
      if (Math.abs(w.moving) < 0.01) w.moving = 0;
      if (dt > 0) w.pace += (travelled / dt - w.pace) * Math.min(1, dt * 8);
      if (travelled === 0 && w.moving === 0) w.pace = 0;
      w.figure.setUmbrella(rain > 0 && !w.indoor);
      if (travelled > 0 || w.moving > 0) this.place(w);
      w.figure.pose(w.moving, w.pace, now / 1000);
      if (w.figure.takeChanged()) changed = true;
      if (w.speech && w.speech.until === undefined) w.speech.until = now + w.speech.ms;
      else if (w.speech && w.speech.until! <= now) {
        w.speech = undefined;
        this.labelsVersion++;
      }
      if (was.x !== w.at[0] || was.y !== w.at[1] || was.h !== w.heading || was.m !== w.moving) changed = true;
    }
    return changed;
  }

  /**
   * Puts every walker back on the ground, after the ground or the buildings changed. One that now
   * stands inside something (the surroundings arrived after it) steps out to the nearest free ground.
   */
  refresh(): void {
    this.local = undefined;
    const map = this.host.walkMap();
    for (const w of this.walkers.values()) {
      if (!w.indoor && !w.walk && map && !this.walkable(w, w.at)) {
        const free = map.freeNear(w.at, 40);
        if (free) w.at = free;
      }
      this.place(w);
    }
  }

  /** Takes every walker off the map. */
  clear(): void {
    for (const name of this.names()) this.remove(name);
  }

  /** Whether any walker is on the move. */
  get busy(): boolean {
    for (const w of this.walkers.values()) if (w.walk || w.drive.forward || w.drive.turn || w.moving > 0) return true;
    return false;
  }

  private advance(w: Walker, dt: number): number {
    const walk = w.walk!;
    let budget = walk.speed * dt;
    let travelled = 0;
    while (budget > 0 && walk.leg < walk.points.length) {
      const [tx, ty] = walk.points[walk.leg]!;
      const dx = tx - w.at[0];
      const dy = ty - w.at[1];
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) this.faceTowards(w, (Math.atan2(dx, dy) * 180) / Math.PI, dt, walk.speed);
      if (d <= budget) {
        w.at = [tx, ty];
        budget -= d;
        travelled += d;
        walk.leg++;
      } else {
        w.at = [w.at[0] + (dx / d) * budget, w.at[1] + (dy / d) * budget];
        travelled += budget;
        budget = 0;
      }
    }
    walk.metres += travelled;
    if (walk.leg >= walk.points.length) this.finish(w, true);
    return travelled;
  }

  private drive(w: Walker, dt: number): number {
    if (w.drive.turn) {
      w.heading = (((w.heading + w.drive.turn * dt) % 360) + 360) % 360;
      w.figure.setHeading(w.heading);
    }
    if (!w.drive.forward) return 0;
    const rad = (w.heading * Math.PI) / 180;
    const d = w.drive.forward * dt;
    const next: Pt = [w.at[0] + Math.sin(rad) * d, w.at[1] + Math.cos(rad) * d];
    if (!this.walkable(w, next)) {
      // Slide along the wall: try the two directions either side.
      for (const off of [35, -35, 70, -70]) {
        const r2 = ((w.heading + off) * Math.PI) / 180;
        const alt: Pt = [w.at[0] + Math.sin(r2) * d * 0.6, w.at[1] + Math.cos(r2) * d * 0.6];
        if (this.walkable(w, alt)) {
          w.at = alt;
          return Math.abs(d) * 0.6;
        }
      }
      return 0;
    }
    w.at = next;
    return Math.abs(d);
  }

  /** Whether a walker steered by hand may step onto a point: free ground out of doors, the floor indoors. */
  private walkable(w: Walker, p: Pt): boolean {
    if (w.indoor) return this.host.insideFloor(w.indoor.building, w.indoor.floor, p);
    const map = this.host.walkMap();
    if (!map) return true;
    const box = this.local?.box;
    const margin = 30;
    if (!box || p[0] < box[0] + margin || p[1] < box[1] + margin || p[0] > box[2] - margin || p[1] > box[3] - margin) {
      const half = LOCAL_BOX / 2;
      const b: [number, number, number, number] = [p[0] - half, p[1] - half, p[0] + half, p[1] + half];
      this.local = { grid: map.grid(b, 1), box: b };
    }
    const g = this.local!.grid;
    const [c, r] = cellOf(g, p);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return false;
    return g.cost[r * g.cols + c]! !== Infinity;
  }

  private faceTowards(w: Walker, target: number, dt: number, speed: number): void {
    const diff = ((target - w.heading + 540) % 360) - 180;
    // A walker sped up turns faster too, so it never cuts a corner wide.
    const max = TURN_RATE * dt * Math.max(1, speed / WALK_SPEED);
    w.heading = (w.heading + Math.max(-max, Math.min(max, diff)) + 360) % 360;
    w.figure.setHeading(w.heading);
  }

  private finish(w: Walker, arrived: boolean, reason?: string): void {
    const walk = w.walk;
    if (!walk) return;
    w.walk = undefined;
    walk.resolve({ arrived, reason, metres: Math.round(walk.metres), seconds: Math.round((this.now - walk.startedAt) / 100) / 10 });
  }

  private cancel(w: Walker, reason: string): void {
    if (w.walk) this.finish(w, false, reason);
  }

  /** Puts the figure where the walker is: on the ground, or on the floor it is on. */
  private place(w: Walker): void {
    const inside = w.indoor ? this.host.floorTop(w.indoor.building, w.indoor.floor) : undefined;
    // Out of doors the feet stand on the paint of paths and streets, which lies a little over the ground.
    w.height = inside ?? this.host.groundAt(w.at[0], w.at[1]) + GROUND_PAINT;
    w.figure.root.position.set(w.at[0], w.height, -w.at[1]);
    w.figure.setHeading(w.heading);
    for (const [label, up] of [
      [w.nameLabel, 2.25],
      [w.sayLabel, 2.9],
    ] as const) {
      label.x = w.at[0];
      label.y = w.height + up;
      label.z = -w.at[1];
    }
  }
}
