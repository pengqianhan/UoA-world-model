// The 3D campus: an orthographic "architectural model" view of University buildings on a base of
// OpenStreetMap context, with a cut-away floor view for the selected building.
import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  Plane,
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
import type { Building, CampusData, ContextData, FlatRing, Floor, FloorPlans, Room, SpaceKind, SpaceType } from "../shared/types.ts";
import { decodeRing, interiorPoint, pointInRing } from "../shared/geo.ts";
import { groundLevel, massing, roofRims } from "../shared/massing.ts";
import { MeshBuilder, drape, ringsBounds } from "./geometry.ts";
import { SEA_PLANE, Terrain } from "./terrain.ts";
import { WALL_HEIGHT, buildInterior, disposeGroup, inset } from "./interior.ts";
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

/** Weather as the scene draws it, each 0-1. */
export interface SceneWeather {
  cloud: number;
  wet: number;
  fog: number;
}

/** The middle of the shadow map over the three central campuses, in scene coordinates. */
const CENTRAL_SHADOW = new Vector3(130, 0, 500);
/** A camera move longer than this, in metres, goes to another area of the map and jumps. */
const JUMP_DISTANCE = 5000;

/** The lowest the sun is drawn, degrees; a real sun lower than this casts shadows off the map. */
const SUN_MIN_ELEVATION = 10;
/** Crowns of deciduous trees in April and May, in winter, and in early spring. */
const AUTUMN_LEAVES = 0xd38b3c;
const BARE_BRANCHES = 0x9a8a76;
const SPRING_LEAVES = 0xaed27f;

/** A palette under weather: cloud greys the sky and dims the sun, rain darkens the ground and streets. */
function weathered(p: Palette, w: SceneWeather | undefined, night: number): Palette {
  if (!w) return p;
  const overcast = lerpColour(0xc2c9cf, 0x17202a, night);
  const sky = (x: number) => lerpColour(x, overcast, 0.75 * Math.max(w.cloud, w.fog));
  const wet = (x: number) => lerpColour(x, 0x000000, 0.1 * w.wet);
  return {
    ...p,
    sky: sky(p.sky),
    fog: sky(p.fog),
    ground: wet(p.ground),
    road: Object.fromEntries(Object.entries(p.road).map(([k, v]) => [k, wet(v)])) as Palette["road"],
    roadEdge: wet(p.roadEdge),
    sunIntensity: p.sunIntensity * (1 - 0.6 * w.cloud),
    ambientIntensity: p.ambientIntensity * (1 + 0.15 * w.cloud),
  };
}

export interface SceneOptions {
  /** Lower-cost rendering for phones: no shadows, lower pixel ratio. */
  lite?: boolean;
  /** Text for building labels. */
  buildingLabel: (b: Building) => { text: string; sub?: string; title?: string };
  roomLabel: (r: Room) => { text: string; title?: string };
  /** Accessible name of the sign on a stair, lift or toilet. */
  signTitle?: (type: SpaceType) => string;
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
/** Street edges lie under every carriageway and path, so that a junction stays clean. */
const ROAD_EDGE_Y = 0.11;
const ROAD_EDGE_WIDTH = 1.6;
const SLAB = 0.35;
const ROOM_HEIGHT = 1.5;
/** Metres between window centres on University buildings. A drawing convention, like the storey height. */
const WINDOW_BAY = 3.2;
/** Walls are a step darker than the building colour so that terraces and setbacks read. Roofs have a material of their own. */
const ROOF_TINT = [1, 1, 1] as const;
const WALL_TINT = [0.96, 0.95, 0.93] as const;
/** Metres. A parapet round every roof that stands in the open: drawn by rule, like the windows. */
const RIM_HEIGHT = 0.9;
const RIM_TINT = [1.03, 1.03, 1.02] as const;
/** The ground storey is a tone darker than the storeys above it, as a base for the building to stand on. */
const PLINTH_TINT = [0.86, 0.85, 0.83] as const;
/** Metres. A room that can be selected is walled on its outline; this is how thick the walls are drawn. */
const ROOM_WALL = 0.22;
/**
 * The unnamed shapes of a floor plan are walled too, lower than the rooms that can be selected and
 * with walls of no thickness, round a floor a little above the slab. Heights in metres.
 */
const PLAN_WALL = 1.1;
const PLAN_FLOOR = 0.03;
const ROOM_HEIGHT_SELECTED = 3.0;
/**
 * In building view the open floor keeps its outer walls, cut at the height of the rooms so that
 * the lower part of the windows shows; metres high and thick. Drawn by rule, like the windows.
 */
const CUT_WALL = 1.5;
const CUT_WALL_THICKNESS = 0.3;
/** Share of the screen's width and height the open floor is framed to fill, beside the panels. */
const FLOOR_FILL = { wide: [0.56, 0.66], narrow: [0.84, 0.48] } as const;
/** How much of the ground shows over an open floor below it: the floor is seen through the ground. */
const GROUND_VEIL = 0.45;

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/**
 * A room on the open floor, one unit high: walls on its outline round a floor that is in the
 * mesh's second material group, so that the two can take colours of their own.
 */
function roomShell(r: Room): BufferGeometry {
  const mb = new MeshBuilder();
  const inner = inset(decodeRing(r.poly), ROOM_WALL);
  if (inner) {
    const hole = inner.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]);
    mb.extrude([r.poly, hole], 0, 1);
    mb.flat(hole, 0.02, undefined, true);
  } else {
    // An outline too narrow or too ragged to wall is a solid block with a top in the floor's colour.
    mb.extrude([r.poly], 0, 1, undefined, undefined, true, { roofGroup: true });
  }
  return mb.build();
}

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

/** An unnamed shape on the open floor, as published and in metres, with its type and a point inside it. */
interface PlanSpace {
  flat: FlatRing[];
  rings: [number, number][][];
  type: SpaceType;
  at: [number, number];
}

export class CampusScene {
  onPick?: (pick: Pick) => void;
  onHover?: (pick: Pick) => void;
  /**
   * An unnamed space on the open floor under the mouse, or tapped, with the page coordinates of
   * the pointer; null when there is none. Such a space is never selected.
   */
  onSpace?: (space: { type: SpaceType; x: number; y: number } | null) => void;

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
  private trees?: Group;
  private wallTexture: CanvasTexture;
  private glowTexture: CanvasTexture;

  private campus?: CampusData;
  private buildings = new Map<string, Building>();
  private roomsByBuilding = new Map<string, Room[]>();
  private roomsByCode = new Map<string, Room>();
  private buildingMeshes = new Map<string, Mesh>();
  private buildingEdges = new Map<string, LineSegments>();
  private roomMeshes = new Map<string, Mesh>();
  private plans = new Map<string, FloorPlans>();
  private planObjects: (Mesh | LineSegments)[] = [];
  private terrain?: Terrain;
  private terrainMeshes: Mesh[] = [];
  /** Where each University building stands on the ground, by id. */
  private bases = new Map<string, { base: number; low: number }>();
  private lastContext?: ContextData;
  /**
   * Heights of the surrounding buildings' vertices as built, and of the ground under each, so
   * that they can sink to their footprints where they stand.
   */
  private contextSquash?: { mesh: Mesh; y: Float32Array; base: Float32Array; scale: number };
  /** The unnamed shapes on the open floor; largest first. */
  private planSpaces: PlanSpace[] = [];
  /** The shape under the pin, outlined: the room the pin stands for, as the campus map draws it. */
  private pinShape?: SpaceType;
  /** The space last reported to `onSpace`. */
  private spaceShown?: SpaceType;
  private selectedOutline?: LineLoop;
  private interior?: Group;
  private pin?: PinSpec;
  private pinGroup = new Group();

  private palette: Palette = DAY;
  private night = 0;
  private sunDirection?: { azimuth: number; elevation: number };
  private weather?: SceneWeather;
  private month = 0;
  private deciduousMaterial?: MeshLambertMaterial;
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
      // The space under the pointer has moved away from it.
      this.showSpace(undefined);
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

    this.wallTexture = this.makeWindowTexture("#ffffff", "#93a3ab", { slab: "#ddd6c8", lintel: "#7d8d96", sill: "#e9e3d6" });
    this.glowTexture = this.makeWindowTexture("#000000", "#ffffff");
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
      const mb = new MeshBuilder(true, true);
      const blocks = massing(b, campus.floorHeight);
      for (const block of blocks) {
        const wall = {
          storey: campus.floorHeight,
          bay: WINDOW_BAY,
          bottom: block.y0 > 0,
          roofGroup: true,
          plinth: block.y0 === 0 ? { top: campus.floorHeight, color: PLINTH_TINT } : undefined,
        };
        for (const poly of block.outline) mb.extrude(poly, block.y0, block.y1, ROOF_TINT, WALL_TINT, true, wall);
      }
      // On a slope, a footing from the ground floor down to the lowest corner. It goes under the
      // ground storey, not the whole footprint, which takes in what lies below ground.
      const { base, low } = this.footingOf(b);
      if (base - low > 0.05) for (const poly of blocks[0]!.outline) mb.extrude(poly, low - base, 0, ROOF_TINT, PLINTH_TINT, false);
      // The creases of the blocks themselves, before the parapets go on: a parapet has no
      // thickness, and its two faces would read as creases everywhere.
      const creases = new EdgesGeometry(mb.build(), 35);
      const lines = Array.from(creases.getAttribute("position").array as Float32Array);
      creases.dispose();
      blocks.forEach((block, k) => {
        for (const [ax, ay, bx, by] of roofRims(block, blocks[k + 1])) {
          mb.fence(ax, ay, bx, by, block.y1, block.y1 + RIM_HEIGHT, RIM_TINT);
          lines.push(ax, block.y1 + RIM_HEIGHT, -ay, bx, block.y1 + RIM_HEIGHT, -by);
        }
      });
      const geometry = mb.build();
      const walls = new MeshLambertMaterial({
        color: 0xffffff,
        vertexColors: true,
        map: this.wallTexture,
        emissive: 0xffc56e,
        emissiveMap: this.glowTexture,
        emissiveIntensity: 0,
      });
      const mesh = new Mesh(geometry, [walls, new MeshLambertMaterial({ color: 0xffffff })]);
      // The building stands on the lowest ground under it; squashing it keeps it there.
      mesh.position.y = this.baseOf(b);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.pick = { type: "building", id: b.id } satisfies Pick;
      this.uniGroup.add(mesh);
      this.buildingMeshes.set(b.id, mesh);

      const edgeGeometry = new BufferGeometry();
      edgeGeometry.setAttribute("position", new Float32BufferAttribute(lines, 3));
      const edges = new LineSegments(edgeGeometry, new LineBasicMaterial({ color: 0, transparent: true, opacity: 0.55 }));
      edges.position.y = mesh.position.y;
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

  /** The floor plans of one building: the other spaces on its floors, drawn as shapes tinted by type. */
  setPlans(plans: FloorPlans): void {
    this.plans.set(plans.building, plans);
    if (this.selection.building !== plans.building) return;
    this.rebuildPlan();
    // The pin's outline and the signs on the floor come from the shapes.
    this.rebuildPin();
    this.rebuildLabels();
    this.needsShadow = true;
    this.needsRender = true;
  }

  setContext(ctx: ContextData): void {
    this.lastContext = ctx;
    this.contextGroup.clear();
    this.contextMaterials = [];
    const terrain = this.terrain;
    // Paint on the ground follows it. Layers a few centimetres apart cannot keep their order over
    // a slope once each is split its own way, so on terrain they are lifted further and pulled
    // forward in depth, the later the more.
    let layer = 0;
    const onGround = (geometry: BufferGeometry): BufferGeometry => {
      if (!terrain) return geometry;
      geometry.translate(0, 0.15 + layer * 0.04, 0);
      const draped = drape(geometry, (x, y) => terrain.height(x, y));
      geometry.dispose();
      return draped;
    };
    const add = (
      geometry: BufferGeometry,
      key: (p: Palette) => number,
      opts: { shadow?: boolean; receive?: boolean; vertexColors?: boolean; ground?: boolean } = {},
    ) => {
      const mat = new MeshLambertMaterial({ color: key(this.palette), vertexColors: !!opts.vertexColors });
      if (opts.ground && terrain) {
        layer++;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -1 - layer * 0.5;
        mat.polygonOffsetUnits = -2 - layer * 2;
      }
      const mesh = new Mesh(opts.ground ? onGround(geometry) : geometry, mat);
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
      if (mb.vertexCount) add(mb.build(), (p) => p.area[k], { ground: true });
    }
    {
      const mb = new MeshBuilder();
      for (const r of ctx.roads) if (r.k === "street" || r.k === "major" || r.k === "motorway") mb.ribbon(r.p, ROAD_WIDTH[r.k] + ROAD_EDGE_WIDTH, ROAD_EDGE_Y);
      if (mb.vertexCount) add(mb.build(), (p) => p.roadEdge, { ground: true });
    }
    for (const k of ["path", "steps", "service", "street", "major", "motorway"] as const) {
      const mb = new MeshBuilder();
      for (const r of ctx.roads) if (r.k === k) mb.ribbon(r.p, ROAD_WIDTH[k], ROAD_Y[k]);
      if (mb.vertexCount) add(mb.build(), (p) => p.road[k], { ground: true });
    }
    {
      const mb = new MeshBuilder();
      for (const r of ctx.rails) mb.ribbon(r, 2.6, 0.11);
      if (mb.vertexCount) add(mb.build(), (p) => p.rail, { ground: true });
    }
    {
      const mb = new MeshBuilder(true);
      const rand = mulberry32(7);
      // The ground under each building's vertices, for standing it there and sinking it there.
      const bases: number[] = [];
      for (const b of ctx.buildings) {
        const shade = 0.93 + rand() * 0.1;
        const foot = terrain ? terrain.footing(b.p) : { base: 0, low: 0 };
        const g = foot.base;
        const start = mb.vertexCount;
        const base = b.b ?? 0;
        mb.extrude([b.p], g + base, g + b.h, [shade, shade, shade], [shade * 0.97, shade * 0.97, shade * 0.97], !b.roof, { bottom: base > 0 });
        if (!base && g - foot.low > 0.05) mb.extrude([b.p], foot.low, g, undefined, [shade * 0.9, shade * 0.9, shade * 0.9], false);
        // A shaped roof is a tone darker than the walls it sits on.
        if (b.roof) mb.roof(b.p, g + b.h, b.roof, [shade * 0.88, shade * 0.88, shade * 0.9]);
        for (let k = start; k < mb.vertexCount; k++) bases.push(g);
      }
      const mesh = add(mb.build(), (p) => p.context, { shadow: true, vertexColors: true });
      const pos = mesh.geometry.getAttribute("position");
      const y = new Float32Array(pos.count);
      for (let k = 0; k < pos.count; k++) y[k] = pos.getY(k);
      this.contextSquash = { mesh, y, base: Float32Array.from(bases), scale: 1 };
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
    // Trees OpenStreetMap tags as deciduous get crowns of their own, coloured by the season.
    const deciduous: [number, number][] = [];
    for (let i = 0; i + 1 < (ctx.deciduous ?? []).length; i += 2) deciduous.push([ctx.deciduous![i]! / 10, ctx.deciduous![i + 1]! / 10]);
    if (!pts.length && !deciduous.length) return;
    // A crown on a trunk, one unit tall and one wide before it is sized. The position of a mapped
    // tree is OpenStreetMap's; its size, shape and shade are drawn by rule, since nothing is known
    // of its kind. A cut gem of twenty faces reads as a crown at campus scale and costs little.
    const crownGeometry = new IcosahedronGeometry(0.5, 0);
    crownGeometry.scale(1, 0.84, 1);
    crownGeometry.translate(0, 0.6, 0);
    const crownMaterial = new MeshLambertMaterial({ color: this.palette.tree, flatShading: true });
    const crowns = new InstancedMesh(crownGeometry, crownMaterial, pts.length);
    const deciduousMaterial = new MeshLambertMaterial({ color: this.deciduousColour(this.palette), flatShading: true });
    const deciduousCrowns = new InstancedMesh(crownGeometry, deciduousMaterial, deciduous.length);
    // Phones leave the trunks out: under a crown they are a few pixels at most.
    const trunkGeometry = new CylinderGeometry(0.05, 0.07, 0.4, 5);
    trunkGeometry.translate(0, 0.2, 0);
    const trunkMaterial = new MeshLambertMaterial({ color: lerpColour(this.palette.tree, 0x5b4a3a, 0.75) });
    const trunks = this.opts.lite ? undefined : new InstancedMesh(trunkGeometry, trunkMaterial, pts.length + deciduous.length);
    const m = new Matrix4();
    const turn = new Matrix4();
    const shade = new Color();
    const vary = mulberry32(99);
    [...pts, ...deciduous].forEach(([x, y], i) => {
      const width = 5.5 + vary() * 5;
      const height = width * (0.95 + vary() * 0.6);
      m.makeScale(width, height, width);
      m.multiply(turn.makeRotationY(vary() * Math.PI * 2));
      m.setPosition(x, this.groundAt(x, y), -y);
      trunks?.setMatrixAt(i, m);
      // Lighter and darker greens, and now and then one turned towards yellow.
      const light = 0.84 + vary() * 0.34;
      const yellow = vary() < 0.14 ? 0.1 + vary() * 0.14 : 0;
      if (i < pts.length) {
        crowns.setMatrixAt(i, m);
        crowns.setColorAt(i, shade.setRGB(light * (1 + yellow * 1.6), light * (1 + yellow * 0.5), light * (1 - yellow * 1.2)));
      } else {
        deciduousCrowns.setMatrixAt(i - pts.length, m);
        deciduousCrowns.setColorAt(i - pts.length, shade.setRGB(light, light, light));
      }
    });
    this.deciduousMaterial = deciduousMaterial;
    const group = new Group();
    for (const mesh of trunks ? [crowns, deciduousCrowns, trunks] : [crowns, deciduousCrowns]) {
      mesh.castShadow = !this.opts.lite && mesh !== trunks;
      mesh.receiveShadow = false;
      mesh.userData.noPick = true;
      group.add(mesh);
    }
    group.userData.noPick = true;
    group.matrixAutoUpdate = false;
    this.trees = group;
    this.contextGroup.add(group);
    this.contextMaterials.push({ mat: crownMaterial, key: (p) => p.tree });
    this.contextMaterials.push({ mat: deciduousMaterial, key: (p) => this.deciduousColour(p) });
    this.contextMaterials.push({ mat: trunkMaterial, key: (p) => lerpColour(p.tree, 0x5b4a3a, 0.75) });
  }

  /**
   * One window bay of one storey, repeated over University building walls: `base` with a window
   * of two lights in `pane`. With `trim` the storey also gets the edge of its floor slab along
   * the top, a shadow under the lintel and a sill; without, only the panes show, which is the
   * night glow. The tile is smoothed with distance, so that far walls take an even tone where
   * sharp pixels would shimmer. The windows are drawn by rule; nothing about a real facade is known.
   */
  private makeWindowTexture(base: string, pane: string, trim?: { slab: string; lintel: string; sill: string }): CanvasTexture {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    // The canvas is drawn top down: its first rows are the top of the storey.
    const [x0, x1, y0, y1] = [18, 110, 30, 84];
    g.fillStyle = pane;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (trim) {
      g.fillStyle = trim.slab;
      g.fillRect(0, 0, size, 6);
      g.fillStyle = trim.lintel;
      g.fillRect(x0, y0, x1 - x0, 7);
      g.fillStyle = trim.sill;
      g.fillRect(x0 - 4, y1, x1 - x0 + 8, 5);
    }
    // The mullion between the two lights.
    g.fillStyle = base;
    g.fillRect(size / 2 - 3, y0, 6, y1 - y0);
    const tex = new CanvasTexture(c);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
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
    this.pinShape = undefined;
    const cur = this.currentFloor();
    if (!this.pin || !cur) return;
    const y = this.floorY(cur.b, cur.floor.i) + SLAB;
    // The pin stands on the shape the campus map draws for its room: outline it and tint its floor.
    const shape = this.planSpaceAt(this.pin.at);
    if (shape) {
      this.pinShape = shape.type;
      const fill = new MeshBuilder();
      fill.extrude(shape.flat, y + PLAN_FLOOR, y + PLAN_FLOOR + 0.02);
      const fillMesh = new Mesh(
        fill.build(),
        new MeshLambertMaterial({ color: lerpColour(this.palette.accent, this.palette.slab, 0.45), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      );
      fillMesh.receiveShadow = true;
      const top = y + PLAN_WALL + 0.06;
      const lines: number[] = [];
      for (const ring of shape.rings) {
        ring.forEach(([ax, ay], i) => {
          const [bx, by] = ring[(i + 1) % ring.length]!;
          lines.push(ax, top, -ay, bx, top, -by);
        });
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(lines, 3));
      const outline = new LineSegments(g, new LineBasicMaterial({ color: this.palette.accent }));
      fillMesh.userData.noPick = outline.userData.noPick = true;
      fillMesh.userData.role = "pinShape";
      this.pinGroup.add(fillMesh, outline);
    }
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

  /**
   * The sun's real direction for the time shown, or none to keep the palette's. Below
   * `SUN_MIN_ELEVATION` it is held there, so that shadows stay on the map.
   */
  setSun(sun: { azimuth: number; elevation: number } | undefined): void {
    this.sunDirection = sun;
    this.placeSun();
    this.needsShadow = true;
    this.needsRender = true;
  }

  /**
   * The weather to draw: cloud dims the sun and greys the sky, wet darkens the ground and the
   * streets, fog hazes the distance. All 0-1; none is a clear day.
   */
  setWeather(w: SceneWeather | undefined): void {
    const same = (a?: SceneWeather, b?: SceneWeather) => a?.cloud === b?.cloud && a?.wet === b?.wet && a?.fog === b?.fog;
    if (same(w, this.weather)) return;
    this.weather = w;
    this.applyPalette();
    this.restyle();
    this.rebuildDetailColours();
    this.needsShadow = true;
    this.needsRender = true;
  }

  /** The month shown, 1-12: trees OpenStreetMap tags as deciduous turn and drop their leaves. */
  setSeason(month: number): void {
    if (month === this.month) return;
    this.month = month;
    if (this.deciduousMaterial) this.deciduousMaterial.color.setHex(this.deciduousColour(this.palette));
    this.needsRender = true;
  }

  /** Crowns of deciduous trees through a southern-hemisphere year. */
  private deciduousColour(p: Palette): number {
    const m = this.month;
    const colour = m === 4 || m === 5 ? AUTUMN_LEAVES : m >= 6 && m <= 8 ? BARE_BRANCHES : m === 9 || m === 10 ? SPRING_LEAVES : p.tree;
    return lerpColour(colour, p.tree, this.night * 0.7);
  }

  private applyPalette(): void {
    const p = (this.palette = weathered(mixPalette(DAY, NIGHT, this.night), this.weather, this.night));
    this.renderer.setClearColor(p.sky);
    this.sun.shadow.intensity = 1 - 0.7 * (this.weather?.cloud ?? 0);
    const fog = this.weather?.fog ?? 0;
    if (fog > 0) {
      // The camera keeps its distance; zooming changes only the frustum. Haze the far side of the view.
      const d = this.camera.position.distanceTo(this.controls.target);
      this.scene.fog = new Fog(p.fog, d - 300 - 900 * (1 - fog), d + 700 - 300 * fog);
    } else {
      this.scene.fog = null;
    }
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
    // By night the light is the palette's moon; by day the real sun, when the host gives one.
    const real = this.night < 0.5 ? this.sunDirection : undefined;
    const az = ((real?.azimuth ?? p.sunAzimuth) * Math.PI) / 180;
    const el = ((real ? Math.max(SUN_MIN_ELEVATION, real.elevation) : p.sunElevation) * Math.PI) / 180;
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
    } else if (this.campusCentre.distanceTo(CENTRAL_SHADOW) > JUMP_DISTANCE) {
      // A campus in an area of its own: a few hundred metres across at most.
      this.shadowCentre.copy(this.campusCentre);
      sc.left = -800;
      sc.right = 800;
      sc.top = 800;
      sc.bottom = -800;
    } else {
      this.shadowCentre.copy(CENTRAL_SHADOW);
      sc.left = -1300;
      sc.right = 1300;
      sc.top = 1500;
      sc.bottom = -1500;
    }
    sc.updateProjectionMatrix();
    this.placeSun();
    this.needsShadow = true;
  }
  private shadowCentre = CENTRAL_SHADOW.clone();
  /** The middle of the campus last shown, in scene coordinates. */
  private campusCentre = CENTRAL_SHADOW.clone();

  /** Colours of the University building masses, depending on hover and whether they hold learning spaces. */
  private restyle(): void {
    const p = this.palette;
    for (const [id, mesh] of this.buildingMeshes) {
      const b = this.buildings.get(id)!;
      const [walls, roof] = mesh.material as [MeshLambertMaterial, MeshLambertMaterial];
      const hovered = this.hovered?.type === "building" && this.hovered.id === id;
      // While a building is open its neighbours are flat footprints: tone them towards the ground
      // so the open floor stands out.
      const tone = (colour: number) => {
        const toned = lerpColour(colour, p.ground, 0.5 * this.focus);
        return hovered ? lerpColour(toned, p.hover, 0.55) : toned;
      };
      walls.color.setHex(tone(b.roomCount > 0 ? p.uniTeaching : p.uni));
      roof.color.setHex(tone(b.roomCount > 0 ? p.uniRoofTeaching : p.uniRoof));
      // Windows glow after dark, a little more in buildings that hold learning spaces.
      walls.emissiveIntensity = this.night * (1 - this.focus) * (b.roomCount > 0 ? 0.7 : 0.4);
      (this.buildingEdges.get(id)!.material as LineBasicMaterial).color.setHex(p.uniEdge);
    }
  }

  private wallColour(b: Building): number {
    return b.roomCount > 0 ? this.palette.uniTeaching : this.palette.uni;
  }

  private roofColour(b: Building): number {
    return b.roomCount > 0 ? this.palette.uniRoofTeaching : this.palette.uniRoof;
  }

  /** How bright the windows of an open building glow after dark. */
  private get openGlow(): number {
    return this.night * 0.55;
  }

  /** The walls of the open building: the window texture in the building's colour, lit after dark. */
  private facadeMaterial(b: Building): MeshLambertMaterial {
    return new MeshLambertMaterial({
      color: this.wallColour(b),
      vertexColors: true,
      map: this.wallTexture,
      emissive: 0xffc56e,
      emissiveMap: this.glowTexture,
      emissiveIntensity: this.openGlow,
    });
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
    // Surrounding buildings sink to their footprints where they stand.
    const sq = this.contextSquash;
    if (sq && sq.scale !== scale) {
      const pos = sq.mesh.geometry.getAttribute("position");
      for (let k = 0; k < pos.count; k++) pos.setY(k, sq.base[k]! + (sq.y[k]! - sq.base[k]!) * scale);
      pos.needsUpdate = true;
      sq.scale = scale;
    }
    // Trees stand at different heights, so they go rather than shrink.
    if (this.trees) this.trees.visible = this.focus < 0.5;
    this.detailGroup.visible = this.focus > 0;
    this.pinGroup.visible = this.focus > 0;
    this.restyle();
    this.needsShadow = true;
    this.needsRender = true;
  }

  // -------------------------------------------------------------------------------------------
  // Building detail: cut-away floor stack
  // -------------------------------------------------------------------------------------------

  /**
   * Height of a floor's slab in building view. The floor the building is entered at sits on the
   * ground, where the campus view stands it, and the floors below it lie under the ground.
   */
  private floorY(b: Building, i: number): number {
    return this.baseOf(b) + ((i - groundLevel(b)) / 10) * (this.campus?.floorHeight ?? 3.6);
  }

  /** Whether the open floor lies below the ground, and is to be seen through it. */
  private get openBelowGround(): boolean {
    const cur = this.focus > 0 ? this.currentFloor() : undefined;
    return !!cur && cur.floor.i < groundLevel(cur.b);
  }

  /** Height of the ground at a point, metres east and north; 0 until the terrain has come. */
  private groundAt(x: number, y: number): number {
    return this.terrain?.height(x, y) ?? 0;
  }

  /** The ground a University building stands on (see Terrain.footing). */
  private baseOf(b: Building): number {
    return this.footingOf(b).base;
  }

  private footingOf(b: Building): { base: number; low: number } {
    if (!this.terrain) return { base: 0, low: 0 };
    let f = this.bases.get(b.id);
    if (!f) this.bases.set(b.id, (f = this.terrain.footing(b.outline[0]!)));
    return f;
  }

  /**
   * The ground under the map. Rebuilds whatever stands on it: the University buildings, the
   * surroundings, and the open floor.
   */
  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
    this.bases.clear();
    for (const m of this.terrainMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.terrainMeshes = terrain.meshes().map((g) => {
      const m = new Mesh(g, this.ground.material);
      m.receiveShadow = true;
      m.userData.noPick = true;
      this.scene.add(m);
      return m;
    });
    this.ground.position.y = SEA_PLANE;
    if (this.campus) this.setCampus(this.campus);
    if (this.lastContext) this.setContext(this.lastContext);
    if (this.selection.building) {
      this.rebuildDetail();
      this.rebuildPin();
      this.rebuildLabels();
      this.frameSelection(true);
    }
    this.needsShadow = true;
    this.needsRender = true;
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
    this.planObjects = [];
    this.selectedOutline = undefined;

    const cur = this.currentFloor();
    if (!cur) return;
    const { b, floor } = cur;
    const p = this.palette;
    const H = this.campus?.floorHeight ?? 3.6;
    const facade = { storey: H, bay: WINDOW_BAY, roofGroup: true };

    // The floors below the cut keep the building's walls and windows. Their roofs show where a
    // lower floor reaches out beyond the open one. Floors under the ground are drawn only when the
    // open floor is under it too, as in the campus view.
    const below = new MeshBuilder(true, true);
    const ground = groundLevel(b);
    for (const f of b.floors) {
      if (f.i >= floor.i) break;
      if (f.i < ground && floor.i >= ground) continue;
      const y = this.floorY(b, f.i);
      const next = b.floors.find((x) => x.i > f.i);
      const top = next ? this.floorY(b, next.i) : y + H;
      for (const poly of this.floorOutline(b, f.i)) below.extrude(poly, y, top, ROOF_TINT, WALL_TINT, true, facade);
    }
    if (below.vertexCount) {
      const geometry = below.build();
      const mesh = new Mesh(geometry, [this.facadeMaterial(b), new MeshLambertMaterial({ color: this.roofColour(b) })]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.role = "below";
      mesh.userData.noPick = true;
      const edges = new LineSegments(new EdgesGeometry(geometry, 35), new LineBasicMaterial({ color: p.uniEdge, transparent: true, opacity: 0.45 }));
      edges.userData.role = "belowEdges";
      edges.userData.noPick = true;
      this.detailGroup.add(mesh, edges);
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

    // The open floor's own outer walls, cut at the height of the rooms.
    const cut = new MeshBuilder(true, true);
    const sy = y + SLAB;
    for (const [outer, ...holes] of this.floorOutline(b, floor.i)) {
      const inner = outer && inset(decodeRing(outer), CUT_WALL_THICKNESS);
      if (inner) {
        const ring = inner.flatMap(([x, z]) => [Math.round(x * 10), Math.round(z * 10)]);
        cut.extrude([outer!, ring], sy, sy + CUT_WALL, ROOF_TINT, WALL_TINT, true, facade);
      }
      // An outline that cannot be inset cleanly, and the rim of a courtyard, get walls of no thickness.
      for (const r of inner ? holes : [outer!, ...holes]) {
        for (let i = 0; i + 1 < r.length; i += 2) {
          const j = (i + 2) % r.length;
          cut.fence(r[i]! / 10, r[i + 1]! / 10, r[j]! / 10, r[j + 1]! / 10, sy, sy + CUT_WALL, WALL_TINT);
        }
      }
    }
    if (cut.vertexCount) {
      const walls = this.facadeMaterial(b);
      // Where a room or a shape meets the outer wall their faces coincide; the outer wall wins.
      walls.polygonOffset = true;
      walls.polygonOffsetFactor = -1;
      walls.polygonOffsetUnits = -1;
      const mesh = new Mesh(cut.build(), [walls, new MeshLambertMaterial({ color: lerpColour(this.wallColour(b), p.uniEdge, 0.3) })]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.role = "cut";
      mesh.userData.noPick = true;
      this.detailGroup.add(mesh);
    }
    this.rebuildPlan();

    // Rooms on the selected floor, walled on their outlines.
    for (const r of this.roomsByBuilding.get(b.id) ?? []) {
      if (r.f !== floor.i) continue;
      const mesh = new Mesh(roomShell(r), [new MeshLambertMaterial({ color: 0xffffff }), new MeshLambertMaterial({ color: 0xffffff })]);
      mesh.position.y = y + SLAB;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.pick = { type: "room", code: r.code } satisfies Pick;
      this.detailGroup.add(mesh);
      this.roomMeshes.set(r.code, mesh);
    }
    this.styleRooms();
  }

  /**
   * A floor mesh for each group of space types and one set of walls and lines for every unnamed
   * shape on the open floor.
   */
  private rebuildPlan(): void {
    for (const o of this.planObjects) {
      this.detailGroup.remove(o);
      o.geometry.dispose();
      (o.material as MeshLambertMaterial | LineBasicMaterial).dispose();
    }
    this.planObjects = [];
    this.planSpaces = [];
    this.showSpace(undefined);
    const cur = this.currentFloor();
    const plan = cur && this.plans.get(cur.b.id);
    const shapes = plan?.floors[cur!.floor.i];
    if (!cur || !plan || !shapes?.length) return;
    const p = this.palette;
    const y = this.floorY(cur.b, cur.floor.i);
    const base = y + SLAB + PLAN_FLOOR;
    const top = y + SLAB + PLAN_WALL;
    const typeOf = plan.typeOf[cur.floor.i] ?? [];
    // One floor mesh for each group, so each takes its colour from the palette.
    const floors = new Map<SpaceKind, MeshBuilder>();
    const walls = new MeshBuilder();
    const lines: number[] = [];
    shapes.forEach((rings, k) => {
      const type = plan.types[typeOf[k]!] ?? { text: "", kind: "other" };
      const kind = type.kind;
      const decoded = rings.map(decodeRing);
      this.planSpaces.push({ flat: rings, rings: decoded, type, at: interiorPoint(decoded[0]!) });
      let mb = floors.get(kind);
      if (!mb) floors.set(kind, (mb = new MeshBuilder()));
      // From the underside of the slab, so a shape that overhangs the floor outline has a base.
      mb.extrude(rings, y, base);
      // Where two shapes share an edge their walls coincide; with one material that cannot show.
      for (const ring of rings) {
        for (let i = 0; i + 1 < ring.length; i += 2) {
          const j = (i + 2) % ring.length;
          const ax = ring[i]! / 10;
          const ay = ring[i + 1]! / 10;
          const bx = ring[j]! / 10;
          const by = ring[j + 1]! / 10;
          walls.fence(ax, ay, bx, by, base, top);
          lines.push(ax, top + 0.02, -ay, bx, top + 0.02, -by);
        }
      }
    });
    const floorMeshes = [...floors].map(([kind, mb]) => {
      const mesh = new Mesh(mb.build(), new MeshLambertMaterial({ color: p.space[kind] }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.role = "plan";
      mesh.userData.kind = kind;
      mesh.userData.noPick = true;
      return mesh;
    });
    const wallMesh = new Mesh(walls.build(), new MeshLambertMaterial({ color: p.planWall }));
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    wallMesh.userData.role = "planWalls";
    wallMesh.userData.noPick = true;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(lines, 3));
    const edges = new LineSegments(g, new LineBasicMaterial({ color: p.planEdge, transparent: true, opacity: 0.6 }));
    edges.userData.role = "planEdges";
    edges.userData.noPick = true;
    this.planObjects = [...floorMeshes, wallMesh, edges];
    this.detailGroup.add(...floorMeshes, wallMesh, edges);
  }

  private rebuildDetailColours(): void {
    const p = this.palette;
    const b = this.currentFloor()?.b;
    for (const child of this.detailGroup.children) {
      const role = child.userData.role as string | undefined;
      if ((role === "below" || role === "cut") && b) {
        const [walls, top] = (child as Mesh).material as MeshLambertMaterial[];
        walls!.color.setHex(this.wallColour(b));
        walls!.emissiveIntensity = this.openGlow;
        top!.color.setHex(role === "below" ? this.roofColour(b) : lerpColour(this.wallColour(b), p.uniEdge, 0.3));
      }
      if (role === "belowEdges") ((child as LineSegments).material as LineBasicMaterial).color.setHex(p.uniEdge);
      if (role === "slab") ((child as Mesh).material as MeshLambertMaterial).color.setHex(p.slab);
      if (role === "slabEdges") ((child as LineSegments).material as LineBasicMaterial).color.setHex(p.uniEdge);
      if (role === "plan") ((child as Mesh).material as MeshLambertMaterial).color.setHex(p.space[child.userData.kind as SpaceKind]);
      if (role === "planWalls") ((child as Mesh).material as MeshLambertMaterial).color.setHex(p.planWall);
      if (role === "planEdges") ((child as LineSegments).material as LineBasicMaterial).color.setHex(p.planEdge);
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
      const [walls, floor] = mesh.material as MeshLambertMaterial[];
      walls!.color.setHex(colour);
      floor!.color.setHex(lerpColour(colour, p.slab, 0.6));
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
      // Signs on stairs, lifts and toilets. They give way to every room label, and lifts and
      // stairs to nothing else; a sign cannot be clicked, so a pointer goes through to the space.
      this.planSpaces.forEach((s, k) => {
        const icon = s.type.icon;
        if (!icon) return;
        specs.push({
          id: `sign:${b.id}:${floor.i}:${k}`,
          x: s.at[0],
          y: y + PLAN_WALL + 0.2,
          z: -s.at[1],
          text: "",
          title: this.opts.signTitle?.(s.type),
          priority: icon === "stairs" || icon === "lift" ? -1e5 : -2e5,
          className: `lbl-sign sign-${icon}`,
        });
      });
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
          y: this.baseOf(b) + b.height + 2,
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
    // Between areas of the map there is nothing drawn to fly over: jump.
    if (target.distanceTo(this.controls.target) > JUMP_DISTANCE) animate = false;
    // The ground is a square round what is shown; it follows a move to another area.
    if (Math.hypot(target.x - this.ground.position.x, target.z - this.ground.position.z) > 2000) {
      this.ground.position.set(target.x, 0, target.z);
      this.needsShadow = true;
    }
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

  /**
   * Where to look and how far to zoom so that the open floor, as the camera sees it from its
   * present angle, fills the share of the screen that the panels leave free.
   */
  private floorFrame(b: Building, floor: Floor): { centre: Vector3; zoom: number } {
    const y = this.floorY(b, floor.i);
    this.camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const back = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2);
    const across = [Infinity, -Infinity];
    const down = [Infinity, -Infinity];
    const v = new Vector3();
    for (const [outer] of this.floorOutline(b, floor.i)) {
      for (let i = 0; outer && i + 1 < outer.length; i += 2) {
        for (const h of [y, y + SLAB + CUT_WALL]) {
          v.set(outer[i]! / 10, h, -outer[i + 1]! / 10);
          const a = v.dot(right);
          const d = v.dot(up);
          across[0] = Math.min(across[0]!, a);
          across[1] = Math.max(across[1]!, a);
          down[0] = Math.min(down[0]!, d);
          down[1] = Math.max(down[1]!, d);
        }
      }
    }
    // A very small floor is still shown with some of the street round it.
    const w = Math.max(across[1]! - across[0]!, 30);
    const h = Math.max(down[1]! - down[0]!, 22);
    const [fillW, fillH] = this.width <= 720 ? FLOOR_FILL.narrow : FLOOR_FILL.wide;
    const zoom = Math.min((VIEW_HEIGHT * fillH) / h, (VIEW_HEIGHT * (this.width / this.height) * fillW) / w);
    // The middle of the floor on screen, moved along the line of sight to the floor's height.
    const a = (across[0]! + across[1]!) / 2;
    const d = (down[0]! + down[1]!) / 2;
    const centre = right.multiplyScalar(a).add(up.multiplyScalar(d));
    centre.addScaledVector(back, (y - centre.y) / back.y);
    return { centre, zoom };
  }

  private frameSelection(animate: boolean): void {
    const cur = this.currentFloor();
    if (!cur) return;
    const { b, floor } = cur;
    const y = this.floorY(b, floor.i);
    const { centre, zoom: floorZoom } = this.floorFrame(b, floor);
    const room = this.selection.room ? this.roomsByCode.get(this.selection.room) : undefined;
    if (!room && this.pin) {
      this.flyTo(new Vector3(this.pin.at[0], y, -this.pin.at[1]), floorZoom * 1.4, animate);
      return;
    }
    if (room && room.b === b.id && room.f === floor.i) {
      const [x0, z0, x1, z1] = ringsBounds([room.poly]);
      // Zoom in on the room but keep enough of the floor in view to stay oriented.
      const roomZoom = this.zoomToFit(x1 - x0, z1 - z0, 0.42);
      this.flyTo(new Vector3(room.c[0], y, -room.c[1]), Math.max(floorZoom, Math.min(roomZoom, floorZoom * 3)), animate);
      return;
    }
    this.flyTo(centre, floorZoom, animate);
  }

  /** Shows a whole campus. `center` is [east, north] in metres. */
  showCampus(center: [number, number], span: number, animate = true): void {
    // The ground is foreshortened by the tilted camera, so height is the looser constraint.
    // On a portrait phone the campus cannot fit across, so frame its central strip instead.
    const aspect = this.width / this.height;
    const zoom = Math.min((VIEW_HEIGHT * aspect) / (span * 0.56), VIEW_HEIGHT / (span * 0.72));
    this.campusCentre.set(center[0], 0, -center[1]);
    if (!this.currentFloor()) this.fitShadow();
    this.flyTo(new Vector3(center[0], this.groundAt(center[0], center[1]), -center[1]), zoom, animate);
  }

  // -------------------------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------------------------

  private pickAt(clientX: number, clientY: number): Pick {
    return this.probeAt(clientX, clientY).pick;
  }

  /**
   * What lies under a point of the page: a room or building to select, or else an unnamed space
   * on the open floor that is in front of any building there.
   */
  private probeAt(clientX: number, clientY: number): { pick: Pick; space?: SpaceType } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: Object3D[] = [];
    for (const m of this.roomMeshes.values()) targets.push(m);
    for (const m of this.buildingMeshes.values()) if (m.visible) targets.push(m);
    const hits = this.raycaster.intersectObjects(targets, false);
    // Rooms sit inside the building being viewed, so prefer them over ghosted neighbours.
    const room = hits.find((h) => (h.object.userData.pick as Pick)?.type === "room");
    if (room) return { pick: room.object.userData.pick as Pick };
    const space = this.spaceUnderRay();
    if (space && !(hits[0] && hits[0].distance < space.distance)) return { pick: null, space: space.type };
    return { pick: (hits[0]?.object.userData.pick as Pick) ?? null };
  }

  /** The innermost unnamed shape on the open floor that the raycaster's ray meets. */
  private spaceUnderRay(): { type: SpaceType; distance: number } | undefined {
    const cur = this.currentFloor();
    if (!cur || !this.planSpaces.length) return undefined;
    const y = this.floorY(cur.b, cur.floor.i) + SLAB + PLAN_FLOOR;
    const hit = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3());
    const space = hit && this.planSpaceAt([hit.x, -hit.z]);
    return space ? { type: space.type, distance: this.raycaster.ray.origin.distanceTo(hit) } : undefined;
  }

  /** The innermost unnamed shape on the open floor holding a point, in metres. */
  private planSpaceAt(pt: [number, number]): PlanSpace | undefined {
    // Largest first, so the last shape holding the point is the one drawn on top.
    for (let k = this.planSpaces.length - 1; k >= 0; k--) {
      const [outer, ...holes] = this.planSpaces[k]!.rings;
      if (outer && pointInRing(pt, outer) && !holes.some((h) => pointInRing(pt, h))) return this.planSpaces[k];
    }
    return undefined;
  }

  private showSpace(type: SpaceType | undefined, clientX = 0, clientY = 0): void {
    if (!type && !this.spaceShown) return;
    this.spaceShown = type;
    this.onSpace?.(type ? { type, x: clientX, y: clientY } : null);
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
    const { pick, space } = this.probeAt(e.clientX, e.clientY);
    // A tapped space says what it is; it is not selected.
    this.showSpace(space, e.clientX, e.clientY);
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
      this.showSpace(undefined);
      this.renderer.domElement.style.cursor = "pointer";
      return;
    }
    const { pick, space } = this.probeAt(e.clientX, e.clientY);
    this.setHovered(pick);
    this.showSpace(space, e.clientX, e.clientY);
  };

  private onPointerLeave = (e: PointerEvent): void => {
    this.labels.setHot(undefined);
    this.setHovered(null);
    // A finger leaves as it lifts; what it tapped stays shown until the next tap or move.
    if (e.pointerType === "mouse") this.showSpace(undefined);
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
    this.draw();
    if (this.needsLabels) {
      this.needsLabels = false;
      this.labels.update(this.camera, this.width, this.height);
    }
    this.frames++;
  };

  /** A frame of the scene, with an open floor below the ground drawn through it. */
  private draw(): void {
    this.renderer.render(this.scene, this.camera);
    if (!this.openBelowGround) return;
    // The open floor again, over the picture, and then the ground over that, see-through.
    const shown = this.scene.children.map((c) => c.visible);
    const only = (keep: (o: Object3D) => boolean) => this.scene.children.forEach((c, k) => (c.visible = shown[k]! && (keep(c) || (c as DirectionalLight).isLight === true)));
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    only((c) => c === this.detailGroup || c === this.pinGroup);
    this.renderer.render(this.scene, this.camera);
    only((c) => c === this.ground || this.terrainMeshes.includes(c as Mesh));
    this.groundVeil.color.setHex(this.palette.ground);
    this.scene.overrideMaterial = this.groundVeil;
    this.renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    this.scene.children.forEach((c, k) => (c.visible = shown[k]!));
    this.renderer.autoClear = true;
  }
  /** The ground as it is drawn over a floor below it. */
  private groundVeil = new MeshBasicMaterial({ transparent: true, opacity: GROUND_VEIL, depthWrite: false });

  /** Number of frames drawn so far; lets tests wait for a real render. */
  frames = 0;

  /** Data requests the host is still waiting for; lets tests wait for the whole picture. */
  loading = 0;

  /** Number of unnamed floor-plan shapes drawn on the open floor. For tests. */
  get planShapes(): number {
    const cur = this.currentFloor();
    return (this.planObjects.length && cur && this.plans.get(cur.b.id)?.floors[cur.floor.i]?.length) || 0;
  }

  /**
   * What stands on the open floor: wall faces round the unnamed shapes, and how many of the rooms
   * that can be selected are walled rather than drawn as solid blocks. For tests.
   */
  floorWalls(): { planWallFaces: number; rooms: number; walledRooms: number; outerWalls: boolean; windowsBelow: boolean } {
    const walls = this.planObjects.find((o) => o.userData.role === "planWalls") as Mesh | undefined;
    const rooms = [...this.roomMeshes.values()];
    const textured = (role: string) => {
      const mesh = this.detailGroup.children.find((o) => o.userData.role === role) as Mesh | undefined;
      return !!mesh && !!(mesh.material as MeshLambertMaterial[])[0]?.map;
    };
    return {
      outerWalls: textured("cut"),
      windowsBelow: textured("below"),
      planWallFaces: walls ? (walls.geometry.index?.count ?? 0) / 6 : 0,
      rooms: rooms.length,
      // A walled room's floor is in the second group and lies below its walls' top.
      walledRooms: rooms.filter((m) => {
        const g = m.geometry;
        const floor = g.groups[1];
        if (!floor) return false;
        const y = g.getAttribute("position").getY(g.index!.getX(floor.start));
        return y < 0.5;
      }).length,
    };
  }

  /** The box the open floor's outline takes up on the page, in CSS pixels. For tests. */
  openFloorBox(): { left: number; top: number; right: number; bottom: number } | undefined {
    const cur = this.currentFloor();
    if (!cur) return undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const y = this.floorY(cur.b, cur.floor.i) + SLAB;
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    const v = new Vector3();
    for (const [outer] of this.floorOutline(cur.b, cur.floor.i)) {
      for (let i = 0; outer && i + 1 < outer.length; i += 2) {
        v.set(outer[i]! / 10, y, -outer[i + 1]! / 10).project(this.camera);
        const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
        const yy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
        box.left = Math.min(box.left, x);
        box.right = Math.max(box.right, x);
        box.top = Math.min(box.top, yy);
        box.bottom = Math.max(box.bottom, yy);
      }
    }
    return box;
  }

  /**
   * A point on the page where an unnamed floor-plan shape is drawn with no room, label or other
   * building in front of it. For tests.
   */
  planPoint(): { x: number; y: number } | undefined {
    const cur = this.currentFloor();
    const shapes = (this.planObjects.length && cur && this.plans.get(cur.b.id)?.floors[cur.floor.i]) || [];
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new Vector3();
    for (const rings of shapes) {
      const c = interiorPoint(decodeRing(rings[0]!));
      v.set(c[0], this.floorY(cur!.b, cur!.floor.i) + SLAB + PLAN_FLOOR, -c[1]).project(this.camera);
      const p = { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
      if (document.elementFromPoint(p.x, p.y) !== this.renderer.domElement) continue;
      if (!this.pickAt(p.x, p.y) && !this.labelAt(p.x, p.y)) return p;
    }
    return undefined;
  }

  /** The type of the unnamed space at a point of the page, if one is there. For tests. */
  spaceAt(x: number, y: number): SpaceType | undefined {
    return this.probeAt(x, y).space;
  }

  /** The type of the shape outlined under the pin, if there is one. For tests. */
  pinOutline(): SpaceType | undefined {
    return this.pinShape;
  }

  /**
   * The ground at a point, metres east and north, and where a University building stands on it:
   * its floor and its lowest corner, and the height of its mesh. For tests.
   */
  groundState(x: number, y: number, building?: string): { terrain: boolean; ground: number; base?: number; low?: number; meshY?: number } {
    const b = building ? this.buildings.get(building) : undefined;
    return {
      terrain: !!this.terrain && this.terrainMeshes.length > 0,
      ground: this.groundAt(x, y),
      ...(b ? { ...this.footingOf(b), meshY: this.buildingMeshes.get(b.id)?.position.y } : {}),
    };
  }

  /**
   * The University buildings that a level line meets on its way from one point to another, metres
   * east and north, at a height in metres. For tests.
   */
  buildingsAcross(ax: number, ay: number, bx: number, by: number, height: number): string[] {
    const from = new Vector3(ax, height, -ay);
    const along = new Vector3(bx, height, -by).sub(from);
    const ray = new Raycaster(from, along.clone().normalize(), 0, along.length());
    const hits = ray.intersectObjects([...this.buildingMeshes.values()], false);
    return [...new Set(hits.map((h) => (h.object.userData.pick as { id: string }).id))];
  }

  /**
   * The light as drawn: where the sun stands, degrees, the weather, and the colour of the crowns
   * of deciduous trees and how many there are. For tests.
   */
  lightState(): { azimuth: number; elevation: number; weather?: SceneWeather; fog: boolean; deciduous: number; deciduousTrees: number } {
    const d = this.sun.position.clone().sub(this.sun.target.position).normalize();
    const crowns = this.trees?.children.find((o) => (o as InstancedMesh).material === this.deciduousMaterial) as InstancedMesh | undefined;
    return {
      azimuth: ((Math.atan2(d.x, -d.z) * 180) / Math.PI + 360) % 360,
      elevation: (Math.asin(d.y) * 180) / Math.PI,
      weather: this.weather,
      fog: !!this.scene.fog,
      deciduous: this.deciduousMaterial?.color.getHex() ?? 0,
      deciduousTrees: crowns?.count ?? 0,
    };
  }

  /** The groups whose floors are drawn on the open floor, each with its colour now. For tests. */
  spaceFloors(): { kind: SpaceKind; colour: number }[] {
    return this.planObjects
      .filter((o) => o.userData.role === "plan")
      .map((o) => ({ kind: o.userData.kind as SpaceKind, colour: ((o as Mesh).material as MeshLambertMaterial).color.getHex() }));
  }

  /** True while a camera or focus animation is running. */
  get animating(): boolean {
    return this.tweens.length > 0;
  }

  /**
   * Renders a frame and samples it, so tests can tell a real 3D picture from a blank canvas
   * (headless browsers can report success while drawing nothing).
   */
  probe(): { width: number; height: number; distinctColours: number; samples: number } {
    this.draw();
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
      const top = mesh.position.y + b.height * mesh.scale.y;
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
