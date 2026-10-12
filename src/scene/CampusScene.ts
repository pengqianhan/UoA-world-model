// The 3D campus: an orthographic "architectural model" view of University buildings on a base of
// OpenStreetMap context, with a cut-away floor view for the selected building.
import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  CylinderGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Building, CampusData, ContextData, FlatRing, Floor, Room } from "../shared/types.ts";
import { MeshBuilder, ringsBounds } from "./geometry.ts";
import { WALL_HEIGHT, buildInterior, disposeGroup } from "./interior.ts";
import { LabelLayer, type LabelSpec } from "./labels.ts";
import { DAY, NIGHT, ROOM_COLOURS, lerpColour, mixPalette, type Palette } from "./palette.ts";

export interface Selection {
  building?: string;
  /** Floor index (Floor.i). */
  floor?: number;
  room?: string;
}

export type Pick = { type: "building"; id: string } | { type: "room"; code: string } | null;

/** A pin for a room that is known as a point but has no published outline. */
export interface PinSpec {
  /** [east, north] in metres. */
  at: [number, number];
  text: string;
  title?: string;
}

export interface SceneOptions {
  /** Lower-cost rendering for phones: no shadows, lower pixel ratio. */
  lite?: boolean;
  /** Text for building labels. */
  buildingLabel: (b: Building) => { text: string; sub?: string; title?: string };
  roomLabel: (r: Room) => { text: string; title?: string };
}

interface Tween {
  start: number;
  duration: number;
  step: (k: number) => void;
  done?: () => void;
}

const VIEW_HEIGHT = 1000; // metres visible vertically at zoom 1
const CAMERA_DISTANCE = 3200;
const ROAD_WIDTH = { motorway: 15, major: 11, street: 7.5, service: 4.2, path: 2.2, steps: 2.2 } as const;
const ROAD_Y = { path: 0.12, steps: 0.12, service: 0.14, street: 0.16, major: 0.18, motorway: 0.2 } as const;
const AREA_Y = { park: 0.02, grass: 0.04, wood: 0.06, pitch: 0.08, water: 0.1 } as const;
const SLAB = 0.35;
const ROOM_HEIGHT = 1.5;
const ROOM_HEIGHT_SELECTED = 3.0;

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Deterministic pseudo-random generator so decorative scatter is identical on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CampusScene {
  onPick?: (pick: Pick) => void;
  onHover?: (pick: Pick) => void;

  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: OrthographicCamera;
  private controls: OrbitControls;
  private hemi: HemisphereLight;
  private ambient: AmbientLight;
  private sun: DirectionalLight;
  private labels: LabelLayer;
  private container: HTMLElement;
  private opts: SceneOptions;

  private ground: Mesh;
  private contextGroup = new Group();
  private uniGroup = new Group();
  private detailGroup = new Group();
  private contextMaterials: { mat: MeshLambertMaterial; key: (p: Palette) => number }[] = [];
  private contextBuildings?: Mesh;
  private trees?: InstancedMesh;
  private wallTexture: CanvasTexture;
  private glowTexture: CanvasTexture;

  private campus?: CampusData;
  private buildings = new Map<string, Building>();
  private roomsByBuilding = new Map<string, Room[]>();
  private roomsByCode = new Map<string, Room>();
  private buildingMeshes = new Map<string, Mesh>();
  private buildingEdges = new Map<string, LineSegments>();
  private roomMeshes = new Map<string, Mesh>();
  private selectedOutline?: LineLoop;
  private interior?: Group;
  private pin?: PinSpec;
  private pinGroup = new Group();

  private palette: Palette = DAY;
  private night = 0;
  private selection: Selection = {};
  private hovered: Pick = null;
  private busy = new Map<string, number>();
  private badges = new Map<string, number>();

  private tweens: Tween[] = [];
  private needsRender = true;
  private needsLabels = true;
  private needsShadow = true;
  private raf = 0;
  private width = 1;
  private height = 1;
  private raycaster = new Raycaster();
  private pointerDown?: { x: number; y: number; t: number };
  private disposed = false;

  constructor(container: HTMLElement, labelRoot: HTMLElement, opts: SceneOptions) {
    this.container = container;
    this.opts = opts;
    this.labels = new LabelLayer(labelRoot);

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.lite ? 1.5 : 2));
    this.renderer.shadowMap.enabled = !opts.lite;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    container.appendChild(this.renderer.domElement);
    // The accessible name is set by the host from the locale file.
    this.renderer.domElement.setAttribute("role", "img");

    this.camera = new OrthographicCamera(-500, 500, 500, -500, 10, 9000);
    this.camera.position.set(700, 2300, 2100);
    this.camera.zoom = 0.72;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minZoom = 0.2;
    this.controls.maxZoom = 60;
    this.controls.minPolarAngle = (12 * Math.PI) / 180;
    this.controls.maxPolarAngle = (78 * Math.PI) / 180;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;
    this.controls.rotateSpeed = 0.55;
    this.controls.target.set(130, 0, -30);
    this.setCameraAngles(-32, 52);
    this.controls.addEventListener("change", () => {
      this.needsRender = true;
      this.needsLabels = true;
    });

    this.hemi = new HemisphereLight(0xffffff, 0xb9b3a4, 1);
    this.ambient = new AmbientLight(0xffffff, 0.25);
    this.sun = new DirectionalLight(0xffffff, 2);
    this.sun.castShadow = !opts.lite;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const sc = this.sun.shadow.camera;
    sc.left = -1300;
    sc.right = 1300;
    sc.top = 1500;
    sc.bottom = -1500;
    sc.near = 100;
    sc.far = 6000;
    this.scene.add(this.hemi, this.ambient, this.sun, this.sun.target);

    this.ground = new Mesh(new PlaneGeometry(9000, 9000), new MeshLambertMaterial({ color: DAY.ground }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground, this.contextGroup, this.uniGroup, this.detailGroup, this.pinGroup);

    this.wallTexture = this.makeBandTexture("#ffffff", "#c9c2b2");
    this.glowTexture = this.makeBandTexture("#000000", "#ffffff");
    this.applyPalette();

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerleave", this.onPointerLeave);
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  // -------------------------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------------------------

  setCampus(campus: CampusData): void {
    this.campus = campus;
    this.buildings.clear();
    this.roomsByBuilding.clear();
    this.roomsByCode.clear();
    for (const b of campus.buildings) this.buildings.set(b.id, b);
    for (const r of campus.rooms) {
      this.roomsByCode.set(r.code, r);
      let list = this.roomsByBuilding.get(r.b);
      if (!list) this.roomsByBuilding.set(r.b, (list = []));
      list.push(r);
    }

    this.uniGroup.clear();
    this.buildingMeshes.clear();
    this.buildingEdges.clear();
    for (const b of campus.buildings) {
      if (b.offMap) continue;
      const mb = new MeshBuilder(false, true);
      mb.extrude(b.outline, 0, b.height, undefined, undefined, true, campus.floorHeight);
      const geometry = mb.build();
      const mat = new MeshLambertMaterial({ color: 0xffffff, map: this.wallTexture, emissive: 0xffc56e, emissiveMap: this.glowTexture, emissiveIntensity: 0 });
      const mesh = new Mesh(geometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.pick = { type: "building", id: b.id } satisfies Pick;
      this.uniGroup.add(mesh);
      this.buildingMeshes.set(b.id, mesh);

      const edges = new LineSegments(new EdgesGeometry(geometry, 35), new LineBasicMaterial({ color: 0, transparent: true, opacity: 0.32 }));
      edges.userData.noPick = true;
      this.uniGroup.add(edges);
      this.buildingEdges.set(b.id, edges);
    }
    this.restyle();
    this.applyFocus();
    this.rebuildLabels();
    this.needsShadow = true;
    this.needsRender = true;
  }

  setContext(ctx: ContextData): void {
    this.contextGroup.clear();
    this.contextMaterials = [];
    const add = (geometry: BufferGeometry, key: (p: Palette) => number, opts: { shadow?: boolean; receive?: boolean; vertexColors?: boolean } = {}) => {
      const mat = new MeshLambertMaterial({ color: key(this.palette), vertexColors: !!opts.vertexColors });
      const mesh = new Mesh(geometry, mat);
      mesh.castShadow = !!opts.shadow;
      mesh.receiveShadow = opts.receive ?? true;
      mesh.userData.noPick = true;
      mesh.matrixAutoUpdate = false;
      this.contextGroup.add(mesh);
      this.contextMaterials.push({ mat, key });
      return mesh;
    };

    for (const k of ["park", "grass", "wood", "pitch", "water"] as const) {
      const mb = new MeshBuilder();
      for (const a of ctx.areas) if (a.k === k) mb.flat(a.p, AREA_Y[k]);
      if (mb.vertexCount) add(mb.build(), (p) => p.area[k]);
    }
    for (const k of ["path", "steps", "service", "street", "major", "motorway"] as const) {
      const mb = new MeshBuilder();
      for (const r of ctx.roads) if (r.k === k) mb.ribbon(r.p, ROAD_WIDTH[k], ROAD_Y[k]);
      if (mb.vertexCount) add(mb.build(), (p) => p.road[k]);
    }
    {
      const mb = new MeshBuilder();
      for (const r of ctx.rails) mb.ribbon(r, 2.6, 0.11);
      if (mb.vertexCount) add(mb.build(), (p) => p.rail);
    }
    {
      const mb = new MeshBuilder(true);
      const rand = mulberry32(7);
      for (const b of ctx.buildings) {
        const shade = 0.93 + rand() * 0.1;
        mb.extrude([b.p], 0, b.h, [shade, shade, shade], [shade * 0.97, shade * 0.97, shade * 0.97]);
      }
      this.contextBuildings = add(mb.build(), (p) => p.context, { shadow: true, vertexColors: true });
    }
    this.buildTrees(ctx);
    this.applyFocus();
    this.needsShadow = true;
    this.needsRender = true;
  }

  private buildTrees(ctx: ContextData): void {
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < ctx.trees.length; i += 2) pts.push([ctx.trees[i]! / 10, ctx.trees[i + 1]! / 10]);
    // Woodland polygons have no individual trees mapped, so scatter decorative ones inside them.
    const rand = mulberry32(42);
    for (const a of ctx.areas) {
      if (a.k !== "wood") continue;
      const ring: [number, number][] = [];
      for (let i = 0; i + 1 < a.p.length; i += 2) ring.push([a.p[i]! / 10, a.p[i + 1]! / 10]);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of ring) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      const tries = Math.min(900, Math.round(((x1 - x0) * (y1 - y0)) / 110));
      for (let n = 0; n < tries; n++) {
        const x = x0 + rand() * (x1 - x0);
        const y = y0 + rand() * (y1 - y0);
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const p = ring[i]!;
          const q = ring[j]!;
          if (p[1] > y !== q[1] > y && x < ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]) + p[0]) inside = !inside;
        }
        if (inside) pts.push([x, y]);
      }
    }
    if (!pts.length) return;
    const geom = new ConeGeometry(1, 1, 6);
    geom.translate(0, 0.5, 0);
    const mat = new MeshLambertMaterial({ color: this.palette.tree, flatShading: true });
    const mesh = new InstancedMesh(geom, mat, pts.length);
    const m = new Matrix4();
    const size = mulberry32(99);
    pts.forEach(([x, y], i) => {
      const r = 2.2 + size() * 2.2;
      const h = 5 + size() * 6;
      m.makeScale(r, h, r);
      m.setPosition(x, 0, -y);
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = !this.opts.lite;
    mesh.receiveShadow = false;
    mesh.userData.noPick = true;
    mesh.matrixAutoUpdate = false;
    this.trees = mesh;
    this.contextGroup.add(mesh);
    this.contextMaterials.push({ mat, key: (p) => p.tree });
  }

  /**
   * A 1-D texture repeated once per storey on University building walls: `base` with a `band`
   * where the windows are. Used once for the daytime wall colour and once as the night glow.
   */
  private makeBandTexture(base: string, band: string): CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = base;
    g.fillRect(0, 0, 4, 32);
    g.fillStyle = band;
    g.fillRect(0, 9, 4, 13);
    const tex = new CanvasTexture(c);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.magFilter = NearestFilter;
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  // -------------------------------------------------------------------------------------------
  // Selection and state
  // -------------------------------------------------------------------------------------------

  /** Rooms with a class in progress at the selected time: code -> number of sessions. */
  setBusyRooms(busy: Map<string, number>): void {
    this.busy = busy;
    this.styleRooms();
    this.rebuildLabels();
    this.needsRender = true;
  }

  /** Buildings with classes in progress: id -> count, shown as a badge on the label. */
  setBuildingBadges(badges: Map<string, number>): void {
    this.badges = badges;
    this.rebuildLabels();
  }

  setSelection(sel: Selection, animate = true): void {
    const prev = this.selection;
    this.selection = { ...sel };
    const buildingChanged = prev.building !== sel.building;
    const floorChanged = buildingChanged || prev.floor !== sel.floor;
    if (floorChanged) this.rebuildDetail();
    else this.styleRooms();
    this.rebuildPin();
    if (buildingChanged) this.fitShadow();
    this.applyFocusStyle(animate);
    this.rebuildLabels();
    if (buildingChanged || floorChanged || prev.room !== sel.room) this.frameSelection(animate);
    this.needsShadow = true;
    this.needsRender = true;
  }

  /** Shows or clears the pin for a room located only as a point on the selected floor. */
  setPin(pin: PinSpec | undefined, animate = true): void {
    this.pin = pin;
    this.rebuildPin();
    this.rebuildLabels();
    if (pin) this.frameSelection(animate);
    this.needsRender = true;
  }

  private rebuildPin(): void {
    for (const child of [...this.pinGroup.children]) {
      (child as Mesh).geometry.dispose();
      ((child as Mesh).material as MeshLambertMaterial).dispose();
    }
    this.pinGroup.clear();
    const cur = this.currentFloor();
    if (!this.pin || !cur) return;
    const y = this.floorY(cur.b, cur.floor.i) + SLAB;
    const mat = new MeshLambertMaterial({ color: this.palette.accent });
    const stem = new Mesh(new CylinderGeometry(0.18, 0.18, 4, 8), mat);
    stem.position.set(this.pin.at[0], y + 2, -this.pin.at[1]);
    const head = new Mesh(new SphereGeometry(1.1, 16, 12), mat.clone());
    head.position.set(this.pin.at[0], y + 4.6, -this.pin.at[1]);
    stem.userData.noPick = head.userData.noPick = true;
    stem.castShadow = head.castShadow = true;
    this.pinGroup.add(stem, head);
  }

  /** 0 = day, 1 = night. */
  setNight(amount: number): void {
    const n = Math.max(0, Math.min(1, amount));
    if (Math.abs(n - this.night) < 0.005) return;
    this.night = n;
    this.applyPalette();
    this.restyle();
    this.styleRooms();
    this.rebuildDetailColours();
    this.rebuildPin();
    this.needsShadow = true;
    this.needsRender = true;
  }

  private applyPalette(): void {
    const p = (this.palette = mixPalette(DAY, NIGHT, this.night));
    this.renderer.setClearColor(p.sky);
    (this.ground.material as MeshLambertMaterial).color.setHex(p.ground);
    this.hemi.color.setHex(p.ambient);
    this.hemi.groundColor.setHex(p.ambientGround);
    this.hemi.intensity = p.ambientIntensity;
    this.ambient.intensity = 0.2 + this.night * 0.25;
    this.sun.color.setHex(p.sun);
    this.sun.intensity = p.sunIntensity;
    this.placeSun();
    for (const { mat, key } of this.contextMaterials) mat.color.setHex(key(p));
    this.container.style.setProperty("--scene-sky", `#${p.sky.toString(16).padStart(6, "0")}`);
  }

  private placeSun(): void {
    const p = this.palette;
    const az = (p.sunAzimuth * Math.PI) / 180;
    const el = (p.sunElevation * Math.PI) / 180;
    const t = this.sun.target.position;
    t.copy(this.shadowCentre);
    const d = 3000;
    this.sun.position.set(t.x + Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, t.z - Math.cos(az) * Math.cos(el) * d);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * Fits the shadow map to what is being looked at: the three central campuses in campus view,
   * or just the open building, where the same texture then gives crisp shadows up close.
   */
  private fitShadow(): void {
    const cur = this.currentFloor();
    const sc = this.sun.shadow.camera;
    if (cur) {
      const [x0, z0, x1, z1] = ringsBounds(cur.b.outline);
      const half = Math.max(110, Math.hypot(x1 - x0, z1 - z0) * 1.1);
      this.shadowCentre.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
    } else {
      this.shadowCentre.set(130, 0, 500);
      sc.left = -1300;
      sc.right = 1300;
      sc.top = 1500;
      sc.bottom = -1500;
    }
    sc.updateProjectionMatrix();
    this.placeSun();
    this.needsShadow = true;
  }
  private shadowCentre = new Vector3(130, 0, 500);

  /** Colours of the University building masses, depending on hover and whether they hold learning spaces. */
  private restyle(): void {
    const p = this.palette;
    for (const [id, mesh] of this.buildingMeshes) {
      const b = this.buildings.get(id)!;
      const mat = mesh.material as MeshLambertMaterial;
      let colour = b.roomCount > 0 ? p.uniTeaching : p.uni;
      // While a building is open its neighbours are flat footprints: tone them towards the ground
      // so the open floor stands out.
      colour = lerpColour(colour, p.ground, 0.5 * this.focus);
      if (this.hovered?.type === "building" && this.hovered.id === id) colour = lerpColour(colour, p.hover, 0.55);
      mat.color.setHex(colour);
      // Windows glow after dark, a little more in buildings that hold learning spaces.
      mat.emissiveIntensity = this.night * (1 - this.focus) * (b.roomCount > 0 ? 0.7 : 0.4);
      (this.buildingEdges.get(id)!.material as LineBasicMaterial).color.setHex(p.uniEdge);
    }
  }

  /**
   * In building view every other building sinks to its footprint, so the open floor is not
   * hidden behind its neighbours but the street layout stays readable.
   */
  private applyFocusStyle(animate = true): void {
    const target = this.selection.building && this.currentFloor() ? 1 : 0;
    const from = this.focus;
    const step = (k: number) => {
      this.focus = from + (target - from) * easeInOut(k);
      this.applyFocus();
    };
    this.tweens = this.tweens.filter((tw) => tw.step !== this.focusStep);
    if (!animate || from === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.focus = target;
      this.applyFocus();
      return;
    }
    this.focusStep = step;
    this.tweens.push({ start: performance.now(), duration: 520, step });
  }
  private focus = 0;
  private focusStep?: (k: number) => void;

  private applyFocus(): void {
    const selected = this.selection.building;
    const scale = 1 - 0.985 * this.focus;
    for (const [id, mesh] of this.buildingMeshes) {
      const edges = this.buildingEdges.get(id)!;
      const isSelected = id === selected && this.focus > 0;
      mesh.visible = !isSelected;
      edges.visible = !isSelected && this.focus < 0.5;
      mesh.scale.y = scale;
      edges.scale.y = scale;
    }
    if (this.contextBuildings) {
      this.contextBuildings.scale.y = scale;
      this.contextBuildings.updateMatrix();
    }
    if (this.trees) {
      this.trees.scale.y = Math.max(0.02, 1 - this.focus);
      this.trees.visible = this.focus < 0.98;
      this.trees.updateMatrix();
    }
    this.detailGroup.visible = this.focus > 0;
    this.pinGroup.visible = this.focus > 0;
    this.restyle();
    this.needsShadow = true;
    this.needsRender = true;
  }

  // -------------------------------------------------------------------------------------------
  // Building detail: cut-away floor stack
  // -------------------------------------------------------------------------------------------

  /** Height of a floor's slab in building view. The lowest floor sits on the ground. */
  private floorY(b: Building, i: number): number {
    const min = b.floors[0]?.i ?? 0;
    return ((i - min) / 10) * (this.campus?.floorHeight ?? 3.6);
  }

  private floorOutline(b: Building, index: number): FlatRing[][] {
    // A floor without its own outline repeats the one below it.
    let outline: FlatRing[][] | undefined;
    for (const f of b.floors) {
      if (f.outline) outline = f.outline;
      if (f.i === index) break;
    }
    return outline ?? [b.outline];
  }

  private currentFloor(): { b: Building; floor: Floor } | undefined {
    const b = this.selection.building ? this.buildings.get(this.selection.building) : undefined;
    if (!b || b.offMap) return undefined;
    const floor = b.floors.find((f) => f.i === this.selection.floor) ?? b.floors.find((f) => f.i >= 0) ?? b.floors[0];
    return floor ? { b, floor } : undefined;
  }

  private rebuildDetail(): void {
    for (const child of [...this.detailGroup.children]) {
      const m = child as Mesh;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
    if (this.interior) disposeGroup(this.interior);
    this.interior = undefined;
    this.detailGroup.clear();
    this.roomMeshes.clear();
    this.selectedOutline = undefined;

    const cur = this.currentFloor();
    if (!cur) return;
    const { b, floor } = cur;
    const p = this.palette;
    const H = this.campus?.floorHeight ?? 3.6;

    // Solid mass of the floors below the cut.
    const below = new MeshBuilder();
    for (const f of b.floors) {
      if (f.i >= floor.i) break;
      const y = this.floorY(b, f.i);
      const next = b.floors.find((x) => x.i > f.i);
      const top = next ? this.floorY(b, next.i) : y + H;
      for (const poly of this.floorOutline(b, f.i)) below.extrude(poly, y, top);
    }
    if (below.vertexCount) {
      const mesh = new Mesh(below.build(), new MeshLambertMaterial({ color: p.slabBelow }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.role = "below";
      mesh.userData.noPick = true;
      this.detailGroup.add(mesh);
    }

    // The selected floor's slab.
    const y = this.floorY(b, floor.i);
    const slab = new MeshBuilder();
    for (const poly of this.floorOutline(b, floor.i)) slab.extrude(poly, y, y + SLAB);
    const slabMesh = new Mesh(slab.build(), new MeshLambertMaterial({ color: p.slab }));
    slabMesh.castShadow = true;
    slabMesh.receiveShadow = true;
    slabMesh.userData.role = "slab";
    slabMesh.userData.noPick = true;
    this.detailGroup.add(slabMesh);
    const slabEdges = new LineSegments(new EdgesGeometry(slabMesh.geometry, 35), new LineBasicMaterial({ color: p.uniEdge, transparent: true, opacity: 0.5 }));
    slabEdges.userData.role = "slabEdges";
    slabEdges.userData.noPick = true;
    this.detailGroup.add(slabEdges);

    // Rooms on the selected floor, as low blocks on the slab.
    for (const r of this.roomsByBuilding.get(b.id) ?? []) {
      if (r.f !== floor.i) continue;
      const mb = new MeshBuilder();
      mb.extrude([r.poly], 0, 1);
      const mesh = new Mesh(mb.build(), new MeshLambertMaterial({ color: 0xffffff }));
      mesh.position.y = y + SLAB;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.pick = { type: "room", code: r.code } satisfies Pick;
      this.detailGroup.add(mesh);
      this.roomMeshes.set(r.code, mesh);
    }
    this.styleRooms();
  }

  private rebuildDetailColours(): void {
    const p = this.palette;
    for (const child of this.detailGroup.children) {
      const role = child.userData.role as string | undefined;
      if (role === "below") ((child as Mesh).material as MeshLambertMaterial).color.setHex(p.slabBelow);
      if (role === "slab") ((child as Mesh).material as MeshLambertMaterial).color.setHex(p.slab);
      if (role === "slabEdges") ((child as LineSegments).material as LineBasicMaterial).color.setHex(p.uniEdge);
    }
  }

  private styleRooms(): void {
    const p = this.palette;
    const cur = this.currentFloor();
    if (this.selectedOutline) {
      this.detailGroup.remove(this.selectedOutline);
      this.selectedOutline.geometry.dispose();
      this.selectedOutline = undefined;
    }
    if (this.interior) {
      this.detailGroup.remove(this.interior);
      disposeGroup(this.interior);
      this.interior = undefined;
    }
    for (const [code, mesh] of this.roomMeshes) {
      const room = this.roomsByCode.get(code)!;
      const selected = this.selection.room === code;
      const hovered = this.hovered?.type === "room" && this.hovered.code === code;
      const busy = (this.busy.get(code) ?? 0) > 0;
      const [day, night] = ROOM_COLOURS[room.kind];
      const kindColour = lerpColour(day, night, this.night);
      let colour = kindColour;
      // Rooms with a class in progress are saturated; free rooms are washed towards the slab colour.
      if (this.busy.size > 0 && !busy) colour = lerpColour(colour, p.slab, 0.55);
      if (hovered) colour = lerpColour(colour, 0xffffff, 0.3);
      if (selected) colour = p.accent;
      (mesh.material as MeshLambertMaterial).color.setHex(colour);
      mesh.scale.y = selected ? ROOM_HEIGHT_SELECTED : busy ? ROOM_HEIGHT * 1.35 : ROOM_HEIGHT;
      // The selected room opens up: its block is replaced by low walls and illustrative furniture.
      mesh.visible = !selected;

      if (selected && cur) {
        this.interior = buildInterior(room, mesh.position.y, kindColour, p.slab);
        this.detailGroup.add(this.interior);
        const pts: number[] = [];
        const top = mesh.position.y + WALL_HEIGHT + 0.04;
        for (let i = 0; i + 1 < room.poly.length; i += 2) pts.push(room.poly[i]! / 10, top, -room.poly[i + 1]! / 10);
        const g = new BufferGeometry();
        g.setAttribute("position", new Float32BufferAttribute(pts, 3));
        this.selectedOutline = new LineLoop(g, new LineBasicMaterial({ color: p.accent }));
        this.selectedOutline.userData.noPick = true;
        this.detailGroup.add(this.selectedOutline);
      }
    }
    this.needsShadow = true;
    this.needsRender = true;
  }

  // -------------------------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------------------------

  private rebuildLabels(): void {
    if (!this.campus) return;
    const specs: LabelSpec[] = [];
    const cur = this.currentFloor();
    if (cur) {
      const { b, floor } = cur;
      const y = this.floorY(b, floor.i) + SLAB;
      for (const r of this.roomsByBuilding.get(b.id) ?? []) {
        if (r.f !== floor.i) continue;
        const selected = this.selection.room === r.code;
        const busy = this.busy.get(r.code) ?? 0;
        const l = this.opts.roomLabel(r);
        specs.push({
          id: `room:${r.code}`,
          x: r.c[0],
          y: y + (selected ? WALL_HEIGHT + 1.2 : ROOM_HEIGHT) + 0.4,
          z: -r.c[1],
          text: l.text,
          title: l.title,
          priority: (selected ? 1e6 : 0) + (busy ? 5e4 : 0) + r.area,
          className: `lbl-room kind-${r.kind}${selected ? " sel" : ""}${busy ? " busy" : ""}`,
          badge: busy || undefined,
          onClick: () => this.onPick?.({ type: "room", code: r.code }),
        });
      }
      if (this.pin) {
        specs.push({
          id: "pin",
          x: this.pin.at[0],
          y: y + 6,
          z: -this.pin.at[1],
          text: this.pin.text,
          title: this.pin.title,
          priority: 2e6,
          className: "lbl-room lbl-pin sel",
        });
      }
    } else {
      for (const b of this.campus.buildings) {
        if (b.offMap) continue;
        const l = this.opts.buildingLabel(b);
        const badge = this.badges.get(b.id);
        specs.push({
          id: `b:${b.id}`,
          x: b.center[0],
          y: b.height + 2,
          z: -b.center[1],
          text: l.text,
          sub: l.sub,
          title: l.title,
          priority: (badge ? 1e5 : 0) + b.roomCount * 100 + b.height,
          className: `lbl-building${b.roomCount ? " teach" : ""}${this.hovered?.type === "building" && this.hovered.id === b.id ? " hot" : ""}`,
          badge,
          onClick: () => this.onPick?.({ type: "building", id: b.id }),
        });
      }
    }
    this.labels.set(specs);
    this.needsLabels = true;
    this.needsRender = true;
  }

  /** Call when label text depends on something outside the scene (language change). */
  refreshLabels(): void {
    this.rebuildLabels();
  }

  // -------------------------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------------------------

  private setCameraAngles(azimuthDeg: number, polarDeg: number): void {
    const az = (azimuthDeg * Math.PI) / 180;
    const po = (polarDeg * Math.PI) / 180;
    const t = this.controls.target;
    this.camera.position.set(
      t.x + CAMERA_DISTANCE * Math.sin(po) * Math.sin(az),
      t.y + CAMERA_DISTANCE * Math.cos(po),
      t.z + CAMERA_DISTANCE * Math.sin(po) * Math.cos(az),
    );
    this.camera.lookAt(t);
  }

  /** Moves the camera target and zoom, keeping the viewing angle. */
  flyTo(target: Vector3, zoom: number, animate = true): void {
    const fromT = this.controls.target.clone();
    const fromZ = this.camera.zoom;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const z = Math.max(this.controls.minZoom, Math.min(this.controls.maxZoom, zoom));
    const apply = (k: number) => {
      const e = easeInOut(k);
      this.controls.target.lerpVectors(fromT, target, e);
      this.camera.position.copy(this.controls.target).add(offset);
      this.camera.zoom = Math.exp(Math.log(fromZ) + (Math.log(z) - Math.log(fromZ)) * e);
      this.camera.updateProjectionMatrix();
      this.needsRender = true;
      this.needsLabels = true;
    };
    this.tweens = this.tweens.filter((t) => t.step !== this.cameraStep);
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      apply(1);
      return;
    }
    const dist = fromT.distanceTo(target);
    this.cameraStep = apply;
    this.tweens.push({ start: performance.now(), duration: Math.min(1400, 550 + dist * 0.9), step: apply });
  }
  private cameraStep?: (k: number) => void;

  /**
   * Shifts the picture inside the viewport so the point of interest is not hidden behind the
   * panels: fractions of the viewport, +x moves the map right and +y moves it up.
   */
  setViewShift(x: number, y: number, animate = true): void {
    const from = this.shift.clone();
    const to = new Vector2(x, y);
    if (from.equals(to)) return;
    const step = (k: number) => {
      this.shift.lerpVectors(from, to, easeInOut(k));
      this.applyViewShift();
    };
    this.tweens = this.tweens.filter((tw) => tw.step !== this.shiftStep);
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      step(1);
      return;
    }
    this.shiftStep = step;
    this.tweens.push({ start: performance.now(), duration: 600, step });
  }
  private shift = new Vector2(0, 0);
  private shiftStep?: (k: number) => void;

  private applyViewShift(): void {
    const w = this.width;
    const h = this.height;
    if (this.shift.x === 0 && this.shift.y === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -this.shift.x * w, this.shift.y * h, w, h);
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
    this.needsLabels = true;
  }

  /** Zoom at which a box of the given size (metres) fills `fill` of the viewport. */
  private zoomToFit(w: number, d: number, fill: number): number {
    const aspect = this.width / this.height;
    const size = Math.max(Math.hypot(w, d), 12);
    const byHeight = (VIEW_HEIGHT * fill) / size;
    const byWidth = (VIEW_HEIGHT * aspect * fill) / size;
    return Math.min(byHeight, byWidth);
  }

  private frameSelection(animate: boolean): void {
    const cur = this.currentFloor();
    if (!cur) return;
    const { b, floor } = cur;
    const y = this.floorY(b, floor.i);
    const room = this.selection.room ? this.roomsByCode.get(this.selection.room) : undefined;
    if (!room && this.pin) {
      const [bx0, bz0, bx1, bz1] = ringsBounds(this.floorOutline(b, floor.i).flat());
      this.flyTo(new Vector3(this.pin.at[0], y, -this.pin.at[1]), this.zoomToFit(bx1 - bx0, bz1 - bz0, 0.7) * 1.8, animate);
      return;
    }
    if (room && room.b === b.id && room.f === floor.i) {
      const [x0, z0, x1, z1] = ringsBounds([room.poly]);
      // Zoom in on the room but keep enough of the floor in view to stay oriented.
      const [bx0, bz0, bx1, bz1] = ringsBounds(this.floorOutline(b, floor.i).flat());
      const roomZoom = this.zoomToFit(x1 - x0, z1 - z0, 0.42);
      const floorZoom = this.zoomToFit(bx1 - bx0, bz1 - bz0, 0.7);
      this.flyTo(new Vector3(room.c[0], y, -room.c[1]), Math.max(floorZoom, Math.min(roomZoom, floorZoom * 5)), animate);
      return;
    }
    const [x0, z0, x1, z1] = ringsBounds(this.floorOutline(b, floor.i).flat());
    this.flyTo(new Vector3((x0 + x1) / 2, y, (z0 + z1) / 2), this.zoomToFit(x1 - x0, z1 - z0, 0.62), animate);
  }

  /** Shows a whole campus. `center` is [east, north] in metres. */
  showCampus(center: [number, number], span: number, animate = true): void {
    // The ground is foreshortened by the tilted camera, so height is the looser constraint.
    // On a portrait phone the campus cannot fit across, so frame its central strip instead.
    const aspect = this.width / this.height;
    const zoom = Math.min((VIEW_HEIGHT * aspect) / (span * 0.56), VIEW_HEIGHT / (span * 0.72));
    this.flyTo(new Vector3(center[0], 0, -center[1]), zoom, animate);
  }

  // -------------------------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------------------------

  private pickAt(clientX: number, clientY: number): Pick {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: Object3D[] = [];
    for (const m of this.roomMeshes.values()) targets.push(m);
    for (const m of this.buildingMeshes.values()) if (m.visible) targets.push(m);
    const hits = this.raycaster.intersectObjects(targets, false);
    // Rooms sit inside the building being viewed, so prefer them over ghosted neighbours.
    const room = hits.find((h) => (h.object.userData.pick as Pick)?.type === "room");
    return ((room ?? hits[0])?.object.userData.pick as Pick) ?? null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.pointerDown;
    this.pointerDown = undefined;
    if (!d || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    const label = this.labelAt(e.clientX, e.clientY);
    if (label?.onClick) {
      label.onClick();
      return;
    }
    const pick = this.pickAt(e.clientX, e.clientY);
    if (pick) this.onPick?.(pick);
  };

  private labelAt(clientX: number, clientY: number): LabelSpec | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.labels.hit(clientX - rect.left, clientY - rect.top);
  }

  private lastHoverCheck = 0;
  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== "mouse" || this.pointerDown) return;
    const now = performance.now();
    if (now - this.lastHoverCheck < 40) return;
    this.lastHoverCheck = now;
    const label = this.labelAt(e.clientX, e.clientY);
    this.labels.setHot(label?.onClick ? label.id : undefined);
    if (label?.onClick) {
      this.setHovered(null);
      this.renderer.domElement.style.cursor = "pointer";
      return;
    }
    this.setHovered(this.pickAt(e.clientX, e.clientY));
  };

  private onPointerLeave = (): void => {
    this.labels.setHot(undefined);
    this.setHovered(null);
  };

  private setHovered(pick: Pick): void {
    this.renderer.domElement.style.cursor = pick ? "pointer" : "";
    const same =
      (pick === null && this.hovered === null) ||
      (pick?.type === "building" && this.hovered?.type === "building" && pick.id === this.hovered.id) ||
      (pick?.type === "room" && this.hovered?.type === "room" && pick.code === this.hovered.code);
    if (same) return;
    this.hovered = pick;
    this.renderer.domElement.style.cursor = pick ? "pointer" : "";
    this.restyle();
    this.styleRooms();
    this.onHover?.(pick);
    this.needsRender = true;
  }

  // -------------------------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------------------------

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    const aspect = w / h;
    this.camera.left = (-VIEW_HEIGHT * aspect) / 2;
    this.camera.right = (VIEW_HEIGHT * aspect) / 2;
    this.camera.top = VIEW_HEIGHT / 2;
    this.camera.bottom = -VIEW_HEIGHT / 2;
    this.renderer.setSize(w, h);
    this.applyViewShift();
    this.needsRender = true;
    this.needsLabels = true;
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.tweens.length) {
      this.tweens = this.tweens.filter((t) => {
        const k = Math.min(1, (now - t.start) / t.duration);
        t.step(k);
        if (k >= 1) t.done?.();
        return k < 1;
      });
    }
    this.controls.update();
    if (!this.needsRender) return;
    this.needsRender = false;
    if (this.needsShadow && this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.needsUpdate = true;
      this.needsShadow = false;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.needsLabels) {
      this.needsLabels = false;
      this.labels.update(this.camera, this.width, this.height);
    }
    this.frames++;
  };

  /** Number of frames drawn so far; lets tests wait for a real render. */
  frames = 0;

  /** True while a camera or focus animation is running. */
  get animating(): boolean {
    return this.tweens.length > 0;
  }

  /**
   * Renders a frame and samples it, so tests can tell a real 3D picture from a blank canvas
   * (headless browsers can report success while drawing nothing).
   */
  probe(): { width: number; height: number; distinctColours: number; samples: number } {
    this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const seen = new Set<number>();
    const n = 24;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        gl.readPixels(Math.floor(((i + 0.5) * w) / n), Math.floor(((j + 0.5) * h) / n), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // Quantise a little so anti-aliasing noise does not count as distinct colours.
        seen.add(((px[0]! >> 3) << 10) | ((px[1]! >> 3) << 5) | (px[2]! >> 3));
      }
    }
    return { width: w, height: h, distinctColours: seen.size, samples: n * n };
  }

  /** Where a building's roof centre or a room's centre is on the page, in CSS pixels. For tests. */
  screenPoint(kind: "building" | "room", id: string): { x: number; y: number } | undefined {
    const v = new Vector3();
    const rect0 = this.renderer.domElement.getBoundingClientRect();
    const toPage = (p: Vector3) => {
      p.project(this.camera);
      return { x: rect0.left + (p.x * 0.5 + 0.5) * rect0.width, y: rect0.top + (-p.y * 0.5 + 0.5) * rect0.height };
    };
    if (kind === "building") {
      const b = this.buildings.get(id);
      const mesh = this.buildingMeshes.get(id);
      if (!b || !mesh) return undefined;
      // Another building may stand in front of the roof centre, so try several roof points and
      // return the first one where a click really lands on this building and not on a label.
      const top = b.height * mesh.scale.y;
      const ring = b.outline[0]!;
      const candidates: [number, number][] = [b.center];
      for (let i = 0; i + 1 < ring.length; i += 2) {
        candidates.push([(ring[i]! / 10) * 0.8 + b.center[0] * 0.2, (ring[i + 1]! / 10) * 0.8 + b.center[1] * 0.2]);
      }
      for (const [x, y] of candidates) {
        const p = toPage(v.set(x, top, -y));
        const hit = this.pickAt(p.x, p.y);
        if (hit?.type === "building" && hit.id === id && !this.labelAt(p.x, p.y)) return p;
      }
      return undefined;
    } else {
      const r = this.roomsByCode.get(id);
      const mesh = this.roomMeshes.get(id);
      if (!r || !mesh) return undefined;
      v.set(r.c[0], mesh.position.y + mesh.scale.y, -r.c[1]);
    }
    v.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
  }

  /** Camera pose for tests and debugging: angles in degrees, target in metres. */
  cameraState(): { azimuth: number; polar: number; zoom: number; target: [number, number, number] } {
    const t = this.controls.target;
    return {
      azimuth: (this.controls.getAzimuthalAngle() * 180) / Math.PI,
      polar: (this.controls.getPolarAngle() * 180) / Math.PI,
      zoom: this.camera.zoom,
      target: [t.x, t.y, t.z],
    };
  }

  /** True once WebGL produced a context. */
  get ok(): boolean {
    return !!this.renderer.getContext() && !this.renderer.getContext().isContextLost();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.clear();
  }
}
