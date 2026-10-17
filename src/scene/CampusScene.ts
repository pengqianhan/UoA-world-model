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
  HalfFloatType,
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
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  CylinderGeometry,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type MeshStandardMaterial,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Building, CampusData, ContextData, FlatRing, Floor, FloorPlans, Room, SpaceKind, SpaceType } from "../shared/types.ts";
import { decodeRing, interiorPoint, pointInRing } from "../shared/geo.ts";
import { groundLevel, massing, roofRims, withoutStrips } from "../shared/massing.ts";
import { MeshBuilder, drape, levelSlope, ringsBounds, type FacadeSpec } from "./geometry.ts";
import { SEA_PLANE, Terrain } from "./terrain.ts";
import { WALL_HEIGHT, buildInterior, disposeGroup, inset } from "./interior.ts";
import { LabelLayer, type LabelSpec } from "./labels.ts";
import { EYE_HEIGHT } from "./figure.ts";
import { GROUND_PAINT, WalkerWorld } from "./walkers.ts";
import { WalkMap } from "../shared/walkmap.ts";
import { towardsAhead } from "../shared/walkerLook.ts";
import { floorRings } from "../shared/indoor.ts";
import { DAY, NIGHT, ROOM_COLOURS, lerpColour, mixPalette, type Palette } from "./palette.ts";
import { StreetLook, type StreetState } from "./street/look.ts";
import { streetTier } from "./street/tier.ts";
import { PART, STYLE, STYLES, buildingSeed, cityStoreys, facadeCode, facadeStyle } from "./street/rules.ts";
import { GROUND, RAIL_WIDTH, ROAD_EDGE_WIDTH, ROAD_WIDTH, type GroundKind } from "./street/roads.ts";
import type { TreeSpec } from "./street/crowns.ts";

export interface Selection {
  building?: string;
  /** Floor index (Floor.i). */
  floor?: number;
  room?: string;
}

export type Pick = { type: "building"; id: string } | { type: "room"; code: string } | null;

/** How the scene is seen: the model from above, from behind a walker, or through its eyes. */
export type WalkerView = "map" | "follow" | "eyes";

/** A pin for a room that is known as a point but has no published outline. */
export interface PinSpec {
  /** [east, north] in metres. */
  at: [number, number];
  text: string;
  title?: string;
}

/** How many buildings wear the walker views' facades: the University's, and the city's mesh round them. */
export interface FacadeCount {
  university: number;
  city: number;
}

/** How much of the ground wears the walker views' surfaces: its meshes and its layers of paint, and whether there is water. */
export interface GroundCount {
  surfaces: number;
  water: boolean;
}

/** The walker views' trees: how many are planted, and how many cards of leaves are drawn round the camera. */
export interface TreeCount {
  street: number;
  cards: number;
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
/**
 * The walker views' camera, vertical degrees and metres to its near plane. Through the eyes it sees
 * wider and nearer, as a person does; from behind it keeps the frame it had.
 */
const EYES_FOV = 64;
const EYES_NEAR = 0.2;
const FOLLOW_FOV = 55;
const FOLLOW_NEAR = 0.3;
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
const ROAD_Y = { path: 0.12, steps: 0.12, service: 0.14, street: 0.16, major: 0.18, motorway: 0.2 } as const;
const AREA_Y = { park: 0.02, grass: 0.04, wood: 0.06, pitch: 0.08, water: 0.1 } as const;
/** Street edges lie under every carriageway and path, so that a junction stays clean. */
const ROAD_EDGE_Y = 0.11;
const RAIL_Y = 0.11;
/**
 * The order the walker views draw the ground in (street/ground.ts), between the buildings' depth
 * drawn first (renderOrder -1) and everything else (0): the paint, top layer first; then the ground
 * under it where no paint covers it, after its own depth on a graphics card, before the paint elsewhere.
 */
const PAINT_ORDER = -0.5;
const GROUND_ORDER_AFTER = -0.3;
const GROUND_ORDER_BEFORE = -0.9;
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

/** The middle of a flat ring's points, metres east and north. */
function ringMiddle(ring: FlatRing): [number, number] {
  let x = 0;
  let y = 0;
  const n = ring.length >> 1;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    x += ring[i]!;
    y += ring[i + 1]!;
  }
  return [x / n / 10, y / n / 10];
}

/**
 * How the walker views draw a University building's walls (street/facade.ts): storeys a floor high,
 * as the map draws them, and bays WINDOW_BAY wide, or half that for a curtain wall's mullions.
 */
function universityFacade(b: Building, floorHeight: number, base: number): FacadeSpec {
  const seed = buildingSeed(b.center[0], b.center[1]);
  const style = facadeStyle(seed, { university: true, height: b.height, pitched: false });
  return {
    code: facadeCode(style, seed),
    storey: floorHeight,
    ground: floorHeight,
    top: 1e4,
    base,
    anchor: b.center,
    bay: style === STYLE.glass ? WINDOW_BAY / 2 : WINDOW_BAY,
    cap: PART.roof,
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
  /** The map's material for the ground plane and the terrain's meshes. */
  private groundMaterial: MeshLambertMaterial;
  /** The map's paint on the ground (areas, roads, railways), each with what it is and how high the map lays it. */
  private groundLayers: Mesh[] = [];
  private contextGroup = new Group();
  private uniGroup = new Group();
  private detailGroup = new Group();
  private contextMaterials: { mat: MeshLambertMaterial; key: (p: Palette) => number }[] = [];
  /** The surrounding buildings, one mesh, and the map's material for it. */
  private cityBuildings?: { mesh: Mesh; map: MeshLambertMaterial };
  /**
   * The walker views' facades (street/facade.ts), made with the first walker view: one for the
   * city round the campus, one for each University building (for its tint), and two for the open
   * building's walls below the cut and round the open floor.
   */
  private streetMaterials = new Map<string, MeshStandardMaterial>();
  private cityMaterial?: MeshStandardMaterial;
  private openMaterials?: { below: MeshStandardMaterial; cut: MeshStandardMaterial };
  private trees?: Group;
  /** The map's trees as the walker views draw them again (street/trees.ts), and the ones they last planted. */
  private treeSpecs: TreeSpec[] = [];
  private treesPlanted?: TreeSpec[];
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
  /** Floor outlines without their strips (see withoutStrips), by the outline they were made from. */
  private cleanOutlines = new WeakMap<object, FlatRing[][]>();
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

  /** The walkers on the map (walkers.ts). */
  readonly walkers: WalkerWorld;
  /** Floor outlines in metres, by building and floor, for walkers steered by hand indoors. */
  private floorRingCache = new Map<string, [number, number][][][]>();
  private walkMapCache?: WalkMap;
  /** The camera of the walker views: behind a walker, or at its eyes. */
  private persp = new PerspectiveCamera(FOLLOW_FOV, 1, FOLLOW_NEAR, 6000);
  /** The walker views' sky, light and effects (street/look.ts); off on the map. */
  private street: StreetLook;
  private view: WalkerView = "map";
  private viewWalker?: string;
  /** Degrees and metres, set by dragging and the wheel in the walker views. */
  private follow = { yaw: 0, elevation: 16, distance: 7.5 };
  private eyes = { yaw: 0, pitch: -4 };
  private drag?: { x: number; y: number; moved: boolean };
  private lastFrame = 0;
  /** The walkers' labelsVersion the labels were last built for; a new world starts at 0, with none. */
  private walkerLabelsVersion = 0;
  /** A click in a walker view: on a University building, or on the ground at a point. */
  onWalkPick?: (pick: { building?: string; at?: [number, number] }) => void;

  constructor(container: HTMLElement, labelRoot: HTMLElement, opts: SceneOptions) {
    this.container = container;
    this.opts = opts;
    this.labels = new LabelLayer(labelRoot);

    // The stencil lets a hidden walker's shape show through what stands in front of it (figure.ts).
    // Where the walker views can afford it, the renderer keeps a half-float picture for them; on
    // the map it is never used, and the map is drawn straight to the screen as ever (street/tier.ts).
    const tier = streetTier(!!opts.lite);
    this.renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
      stencil: true,
      outputBufferType: tier === "full" ? HalfFloatType : UnsignedByteType,
    });
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
    this.street = new StreetLook({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.persp,
      lights: { sun: this.sun, hemi: this.hemi, ambient: this.ambient },
      tier,
      redraw: () => (this.needsRender = true),
      dress: () => this.dressBuildings(),
    });

    this.groundMaterial = new MeshLambertMaterial({ color: DAY.ground });
    this.ground = new Mesh(new PlaneGeometry(9000, 9000), this.groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground, this.contextGroup, this.uniGroup, this.detailGroup, this.pinGroup);
    this.walkers = new WalkerWorld({
      groundAt: (x, y) => this.groundAt(x, y),
      walkMap: () => this.walkMap(),
      floorTop: (id, i) => {
        const b = this.buildings.get(id);
        return b ? this.floorY(b, i) + SLAB + PLAN_FLOOR : undefined;
      },
      insideFloor: (id, i, p) => {
        const b = this.buildings.get(id);
        if (!b) return false;
        const key = `${id}:${i}`;
        let rings = this.floorRingCache.get(key);
        if (!rings) this.floorRingCache.set(key, (rings = floorRings(b, i)));
        return rings.some(([outer, ...holes]) => !!outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h)));
      },
      rain: () => this.weather?.wet ?? 0,
      ringColour: () => this.palette.accent,
    });
    this.scene.add(this.walkers.group);

    this.wallTexture = this.makeWindowTexture("#ffffff", "#93a3ab", { slab: "#ddd6c8", lintel: "#7d8d96", sill: "#e9e3d6" });
    this.glowTexture = this.makeWindowTexture("#000000", "#ffffff");
    this.applyPalette();

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerCancel);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerleave", this.onPointerLeave);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("wheel", this.onWheel, { passive: false });

    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  // -------------------------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------------------------

  setCampus(campus: CampusData): void {
    this.campus = campus;
    this.walkMapCache = undefined;
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
      const mb = new MeshBuilder(true, true, true);
      const blocks = massing(b, campus.floorHeight);
      const facade = universityFacade(b, campus.floorHeight, 0);
      for (const block of blocks) {
        // Windows in every whole storey of the block, up to its roof.
        mb.facade = { ...facade, top: block.y1 };
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
      mb.facade = facade;
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
      mesh.userData.mapMaterial = mesh.material;
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
    this.dressBuildings();
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
    this.walkMapCache = undefined;
    // A walker steered by hand keeps a grid of the ground round it: rebuild it with the surroundings.
    this.walkers.refresh();
    this.contextGroup.clear();
    this.contextMaterials = [];
    this.groundLayers = [];
    const terrain = this.terrain;
    // Paint on the ground follows it. Layers a few centimetres apart cannot keep their order over
    // a slope once each is split its own way, so on terrain they are lifted further and pulled
    // forward in depth, the later the more. Each also keeps the slope under it, which the map does
    // not draw and the walker views do (street/ground.ts), and the paint along a line keeps where
    // each point lies along it and across it.
    let layer = 0;
    const onGround = (geometry: BufferGeometry): BufferGeometry => {
      if (!terrain) return levelSlope(geometry);
      geometry.translate(0, 0.15 + layer * 0.04, 0);
      const draped = drape(geometry, (x, y) => terrain.height(x, y), 10, (x, y, out) => terrain.normal(x, y, out));
      geometry.dispose();
      return draped;
    };
    const add = (
      geometry: BufferGeometry,
      key: (p: Palette) => number,
      opts: { shadow?: boolean; receive?: boolean; vertexColors?: boolean; ground?: { kind: Exclude<GroundKind, "open">; y: number } } = {},
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
      if (opts.ground) {
        mesh.userData.mapMaterial = mat;
        mesh.userData.groundLayer = { kind: opts.ground.kind, lift: opts.ground.y + (terrain ? 0.15 + layer * 0.04 : 0) };
        this.groundLayers.push(mesh);
      }
      this.contextGroup.add(mesh);
      this.contextMaterials.push({ mat, key });
      return mesh;
    };

    for (const k of ["park", "grass", "wood", "pitch", "water"] as const) {
      const mb = new MeshBuilder();
      for (const a of ctx.areas) if (a.k === k) mb.flat(a.p, AREA_Y[k]);
      if (mb.vertexCount) add(mb.build(), (p) => p.area[k], { ground: { kind: k, y: AREA_Y[k] } });
    }
    {
      const mb = new MeshBuilder(false, false, false, true);
      for (const r of ctx.roads) if (r.k === "street" || r.k === "major" || r.k === "motorway") mb.ribbon(r.p, ROAD_WIDTH[r.k] + ROAD_EDGE_WIDTH, ROAD_EDGE_Y);
      if (mb.vertexCount) add(mb.build(), (p) => p.roadEdge, { ground: { kind: "edge", y: ROAD_EDGE_Y } });
    }
    for (const k of ["path", "steps", "service", "street", "major", "motorway"] as const) {
      const mb = new MeshBuilder(false, false, false, true);
      for (const r of ctx.roads) if (r.k === k) mb.ribbon(r.p, ROAD_WIDTH[k], ROAD_Y[k]);
      if (mb.vertexCount) add(mb.build(), (p) => p.road[k], { ground: { kind: k, y: ROAD_Y[k] } });
    }
    {
      const mb = new MeshBuilder(false, false, false, true);
      for (const r of ctx.rails) mb.ribbon(r, RAIL_WIDTH, RAIL_Y);
      if (mb.vertexCount) add(mb.build(), (p) => p.rail, { ground: { kind: "rail", y: RAIL_Y } });
    }
    {
      const mb = new MeshBuilder(true, false, true);
      const rand = mulberry32(7);
      // The ground under each building's vertices, for standing it there and sinking it there.
      const bases: number[] = [];
      for (const b of ctx.buildings) {
        const shade = 0.93 + rand() * 0.1;
        const foot = terrain ? terrain.footing(b.p) : { base: 0, low: 0 };
        const g = foot.base;
        const start = mb.vertexCount;
        const base = b.b ?? 0;
        // The walker views draw its walls by rule (street/rules.ts): storeys from its height, a
        // style from where it stands.
        const middle = ringMiddle(b.p);
        const seed = buildingSeed(middle[0], middle[1]);
        const style = facadeStyle(seed, { university: false, height: b.h, pitched: !!b.roof });
        const storeys = cityStoreys(b.h, !b.roof);
        mb.facade = { code: facadeCode(style, seed), storey: storeys.storey, ground: storeys.ground, top: storeys.top, base: g, anchor: middle, bay: STYLES[style]!.bay, cap: PART.roof };
        mb.extrude([b.p], g + base, g + b.h, [shade, shade, shade], [shade * 0.97, shade * 0.97, shade * 0.97], !b.roof, { bottom: base > 0 });
        if (!base && g - foot.low > 0.05) mb.extrude([b.p], foot.low, g, undefined, [shade * 0.9, shade * 0.9, shade * 0.9], false);
        // A shaped roof is a tone darker than the walls it sits on.
        if (b.roof) mb.roof(b.p, g + b.h, b.roof, [shade * 0.88, shade * 0.88, shade * 0.9]);
        for (let k = start; k < mb.vertexCount; k++) bases.push(g);
      }
      const mesh = add(mb.build(), (p) => p.context, { shadow: true, vertexColors: true });
      this.cityBuildings = { mesh, map: mesh.material as MeshLambertMaterial };
      const pos = mesh.geometry.getAttribute("position");
      const y = new Float32Array(pos.count);
      for (let k = 0; k < pos.count; k++) y[k] = pos.getY(k);
      this.contextSquash = { mesh, y, base: Float32Array.from(bases), scale: 1 };
    }
    this.buildTrees(ctx);
    this.dressBuildings();
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
    // The walker views draw each tree again where it stands, at its size, turn and shade (street/trees.ts).
    const specs: TreeSpec[] = [];
    [...pts, ...deciduous].forEach(([x, y], i) => {
      const width = 5.5 + vary() * 5;
      const height = width * (0.95 + vary() * 0.6);
      const angle = vary() * Math.PI * 2;
      const ground = this.groundAt(x, y);
      m.makeScale(width, height, width);
      m.multiply(turn.makeRotationY(angle));
      m.setPosition(x, ground, -y);
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
      specs.push({ x, y: ground, z: -y, width, height, turn: angle, shade: [shade.r, shade.g, shade.b], deciduous: i >= pts.length });
    });
    this.treeSpecs = specs;
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
    this.lightStreet();
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
    this.street.setSeason(month);
    // In a walker view a bare tree casts the shadow of its boughs, not of its leaves.
    if (this.street.active) this.needsShadow = true;
    this.needsRender = true;
  }

  /** Crowns of deciduous trees through a southern-hemisphere year. */
  private deciduousColour(p: Palette): number {
    const m = this.month;
    const colour = m === 4 || m === 5 ? AUTUMN_LEAVES : m >= 6 && m <= 8 ? BARE_BRANCHES : m === 9 || m === 10 ? SPRING_LEAVES : p.tree;
    return lerpColour(colour, p.tree, this.night * 0.7);
  }

  /**
   * How far the colours go towards the night palette. The map's night is in its colours; a walker
   * view keeps the day's colours by night and makes the night with its light (street/look.ts).
   */
  private get mood(): number {
    return this.street.active ? 0 : this.night;
  }

  private applyPalette(): void {
    const p = (this.palette = weathered(mixPalette(DAY, NIGHT, this.mood), this.weather, this.mood));
    this.renderer.setClearColor(p.sky);
    this.sun.shadow.intensity = 1 - 0.7 * (this.weather?.cloud ?? 0);
    const fog = this.weather?.fog ?? 0;
    if (this.view !== "map") {
      // At a walker's height the map has an edge; haze it into the sky, closer in fog.
      this.scene.fog = new Fog(p.fog, 60 + 340 * (1 - fog), 220 + 1500 * (1 - fog));
    } else if (fog > 0) {
      // The camera keeps its distance; zooming changes only the frustum. Haze the far side of the view.
      const d = this.camera.position.distanceTo(this.controls.target);
      this.scene.fog = new Fog(p.fog, d - 300 - 900 * (1 - fog), d + 700 - 300 * fog);
    } else {
      this.scene.fog = null;
    }
    this.groundMaterial.color.setHex(p.ground);
    this.hemi.color.setHex(p.ambient);
    this.hemi.groundColor.setHex(p.ambientGround);
    this.hemi.intensity = p.ambientIntensity;
    this.ambient.intensity = 0.2 + this.night * 0.25;
    this.sun.color.setHex(p.sun);
    this.sun.intensity = p.sunIntensity;
    this.placeSun();
    for (const { mat, key } of this.contextMaterials) mat.color.setHex(key(p));
    this.container.style.setProperty("--scene-sky", `#${p.sky.toString(16).padStart(6, "0")}`);
    this.lightStreet();
  }

  /**
   * The walker views light the scene their own way, from the same sun, night and weather: over
   * the map's light and haze while one is open, and not at all on the map.
   */
  private lightStreet(): void {
    this.street.setLight({ sun: this.sunDirection, night: this.night, weather: this.weather });
  }

  private placeSun(): void {
    // A walker view's palette stays the day's (mood); its moon is still the night palette's.
    const p = this.street.active ? mixPalette(DAY, NIGHT, this.night) : this.palette;
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
    const walker = this.view !== "map" && this.viewWalker ? this.walkers.pose(this.viewWalker) : undefined;
    if (walker) {
      // Crisp shadows round the walker; they follow it as it goes.
      this.shadowCentre.set(walker.at[0], 0, -walker.at[1]);
      sc.left = -170;
      sc.right = 170;
      sc.top = 170;
      sc.bottom = -170;
    } else if (cur) {
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
      const [walls, roof] = mesh.userData.mapMaterial as [MeshLambertMaterial, MeshLambertMaterial];
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
      // In a walker view the walls are drawn by rule in their own colours, which a hover tints as
      // on the map; beside an open building they fade towards the ground and their rooms go dark.
      const street = this.streetMaterials.get(id);
      if (street) {
        street.color.setHex(hovered ? lerpColour(0xffffff, p.hover, 0.55) : 0xffffff);
        this.street.facades?.setAway(street, this.focus);
      }
    }
    if (this.cityMaterial) this.street.facades?.setAway(this.cityMaterial, this.focus);
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
      // The inked edges are the model's, seen from above; from a walker's height a corner shows by its light.
      edges.visible = !isSelected && this.focus < 0.5 && this.view === "map";
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

  /** What the walkers walk round and along, built when first wanted after the data changes. */
  private walkMap(): WalkMap | undefined {
    if (!this.campus) return undefined;
    this.walkMapCache ??= new WalkMap(this.campus.buildings, this.campus.floorHeight, this.lastContext);
    return this.walkMapCache;
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
      const m = new Mesh(g, this.groundMaterial);
      m.receiveShadow = true;
      m.userData.noPick = true;
      this.scene.add(m);
      return m;
    });
    this.ground.position.y = SEA_PLANE;
    // A walker view lays the plane where the walkers' feet are again (dressGround).
    this.ground.userData.mapY = undefined;
    this.dressGround();
    if (this.campus) this.setCampus(this.campus);
    if (this.lastContext) this.setContext(this.lastContext);
    this.walkers.refresh();
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
    // A floor without its own outline repeats the one below it. A strip of floor no thicker than a
    // wall is left out, as it is from outside: the Southern Underpass's ground floor would otherwise
    // put a wall 40 m long down Symonds Street.
    let outline: FlatRing[][] | undefined;
    for (const f of b.floors) {
      if (f.outline) outline = f.outline;
      if (f.i === index) break;
    }
    const key = outline ?? b.outline;
    let clean = this.cleanOutlines.get(key);
    if (!clean) this.cleanOutlines.set(key, (clean = withoutStrips(outline ?? [b.outline])));
    return clean;
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
      // The walls' street facade is shared and kept; the map's materials are the mesh's own.
      const mat = (m.userData.mapMaterial as Material[] | undefined) ?? m.material;
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
    const below = new MeshBuilder(true, true, true);
    below.facade = universityFacade(b, H, this.baseOf(b));
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
      mesh.userData.mapMaterial = mesh.material;
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
    const cut = new MeshBuilder(true, true, true);
    // The tops of the cut walls are plain wall, not roof.
    cut.facade = { ...universityFacade(b, H, this.baseOf(b)), cap: PART.plain };
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
      mesh.userData.mapMaterial = mesh.material;
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
    this.dressBuildings();
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
        const [walls, top] = child.userData.mapMaterial as MeshLambertMaterial[];
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
      // From a walker's height only the buildings near it are labelled; the rest would crowd the horizon.
      const near = this.viewWalker ? this.walkers.pose(this.viewWalker)?.at : undefined;
      for (const b of this.campus.buildings) {
        if (b.offMap) continue;
        if (near && Math.hypot(b.center[0] - near[0], b.center[1] - near[1]) > 260) continue;
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
    specs.push(...this.walkers.labels());
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
      // In a walker view the plane stays where a walker's feet are, and goes back here after (dressGround).
      const plane = this.ground.userData as { mapY?: number };
      if (plane.mapY !== undefined) {
        plane.mapY = 0;
        this.ground.position.y += GROUND_PAINT;
      }
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
  // Walkers
  // -------------------------------------------------------------------------------------------

  /** What the walkers walk round and along, for the walker commands. */
  walkingMap(): WalkMap | undefined {
    return this.walkMap();
  }

  /** The view now: from above, or behind or through the eyes of a walker. */
  get walkerView(): WalkerView {
    return this.view;
  }

  /** Which walker the walker views follow. */
  get viewedWalker(): string | undefined {
    return this.viewWalker;
  }

  /**
   * Switches between the model seen from above and the views that go with a walker: from behind
   * it, or through its eyes, in perspective at its height. Back on the map, the camera flies to
   * where the walker got to.
   */
  setWalkerView(view: WalkerView, name?: string): void {
    if (view !== "map" && (!name || !this.walkers.has(name))) view = "map";
    const was = this.viewWalker;
    if (was) {
      this.walkers.figure(was)?.setHeadVisible(true);
      this.walkers.figure(was)?.setRingVisible(true);
    }
    const from = this.view;
    this.view = view;
    this.viewWalker = view === "map" ? undefined : name;
    this.controls.enabled = view === "map";
    if (view === "eyes") {
      this.walkers.figure(name!)?.setHeadVisible(false);
      this.walkers.figure(name!)?.setRingVisible(false);
      this.eyes = { yaw: 0, pitch: -4 };
    }
    if (view === "follow" && from !== "follow") this.follow = { yaw: 0, elevation: 16, distance: 7.5 };
    if (view === "map" && from !== "map" && was) {
      const pose = this.walkers.pose(was);
      if (pose) this.flyTo(new Vector3(pose.at[0], pose.height, -pose.at[1]), Math.max(this.camera.zoom, 4), false);
    }
    this.renderer.domElement.style.cursor = view === "map" ? "" : "grab";
    this.persp.fov = view === "eyes" ? EYES_FOV : FOLLOW_FOV;
    this.persp.near = view === "eyes" ? EYES_NEAR : FOLLOW_NEAR;
    this.persp.updateProjectionMatrix();
    // The street look goes on before the palette, which then lights it (lightStreet).
    const mood = this.mood;
    if (view === "map") this.street.exit();
    else this.street.enter();
    this.dressBuildings();
    this.applyPalette();
    // By night the colours change with the view (mood): the open floor's too. applyFocus restyles the buildings.
    if (this.mood !== mood) {
      this.styleRooms();
      this.rebuildDetailColours();
      this.rebuildPin();
    }
    this.applyFocus();
    this.fitShadow();
    this.rebuildLabels();
    this.placeWalkerCamera(1);
    this.needsShadow = true;
    this.needsRender = true;
    this.needsLabels = true;
  }

  /** The walker view's camera, following its walker; `dt` seconds since the last frame. */
  private placeWalkerCamera(dt: number): void {
    if (this.view === "map") return;
    const pose = this.viewWalker ? this.walkers.pose(this.viewWalker) : undefined;
    if (!pose) {
      this.setWalkerView("map");
      return;
    }
    const [x, y] = pose.at;
    // Walked by hand, the view comes round to the way the walker goes, as in a game, unless a
    // finger or the mouse is turning it: so that forward on the stick is forward on the screen.
    if (dt < 1 && !this.drag && this.walkers.handForward(this.viewWalker!) !== 0) {
      const k = Math.exp(-dt * 2.5);
      if (this.view === "eyes") this.eyes.yaw = towardsAhead(this.eyes.yaw, k);
      else this.follow.yaw = towardsAhead(this.follow.yaw, k);
    }
    if (this.view === "eyes") {
      const yaw = ((pose.heading + this.eyes.yaw) * Math.PI) / 180;
      const pitch = (this.eyes.pitch * Math.PI) / 180;
      this.persp.position.set(x, pose.height + EYE_HEIGHT, -y);
      this.persp.lookAt(x + Math.sin(yaw) * Math.cos(pitch), pose.height + EYE_HEIGHT + Math.sin(pitch), -y - Math.cos(yaw) * Math.cos(pitch));
    } else {
      const yaw = ((pose.heading + this.follow.yaw) * Math.PI) / 180;
      const up = (this.follow.elevation * Math.PI) / 180;
      let d = this.follow.distance;
      // A wall between the walker and the camera would hide it: the camera comes in front of the wall.
      let blocked = false;
      const reach = Math.cos(up) * d;
      const map = pose.indoor ? undefined : this.walkMap();
      if (map && reach > 1) {
        const t = map.wallAlong([x, y], [x - Math.sin(yaw) * reach, y - Math.cos(yaw) * reach]);
        if (t !== undefined) {
          d = Math.max(1.2, (t * reach - 0.6) / Math.cos(up));
          blocked = true;
        }
      }
      let cy = pose.height + 1.5 + Math.sin(up) * d;
      const cx = x - Math.sin(yaw) * Math.cos(up) * d;
      const cn = y - Math.cos(yaw) * Math.cos(up) * d;
      // Never under the ground behind a walker on a slope.
      cy = Math.max(cy, this.groundAt(cx, cn) + 0.8);
      // It glides after the walker, but out from behind a wall at once.
      const k = dt >= 1 || blocked ? 1 : 1 - Math.exp(-dt * 7);
      const want = new Vector3(cx, cy, -cn);
      if (k >= 1) this.persp.position.copy(want);
      else this.persp.position.lerp(want, k);
      this.persp.lookAt(x + Math.sin(yaw) * 2, pose.height + 1.35, -y - Math.cos(yaw) * 2);
    }
    this.persp.updateMatrixWorld();
    // The shadows follow the walker round the map.
    if (Math.hypot(this.shadowCentre.x - x, this.shadowCentre.z + y) > 70) this.fitShadow();
    // Draw only when the view moved: a walker standing still in a still view costs nothing.
    const e = this.persp.matrixWorld.elements;
    const moved = !this.lastView || e.some((v, i) => Math.abs(v - this.lastView![i]!) > 1e-5);
    if (moved || dt >= 1) {
      this.lastView = e.slice();
      this.needsRender = true;
      this.needsLabels = true;
    }
  }
  /** The walker view's camera matrix when last drawn. */
  private lastView?: number[];

  /** Turns the walker view by a drag of the pointer, in pixels. */
  private turnWalkerView(dx: number, dy: number): void {
    if (this.view === "eyes") {
      this.eyes.yaw = (((this.eyes.yaw + dx * 0.25) % 360) + 360) % 360;
      this.eyes.pitch = Math.max(-60, Math.min(50, this.eyes.pitch - dy * 0.2));
    } else if (this.view === "follow") {
      this.follow.yaw = (((this.follow.yaw - dx * 0.3) % 360) + 360) % 360;
      this.follow.elevation = Math.max(-5, Math.min(70, this.follow.elevation + dy * 0.2));
    }
    this.needsRender = true;
  }

  /** Looks round in the walker view, degrees from straight ahead: for agents and tests. */
  setWalkerLook(yaw: number, pitch = 0): void {
    if (this.view === "eyes") this.eyes = { yaw: ((yaw % 360) + 360) % 360, pitch: Math.max(-60, Math.min(50, pitch)) };
    else if (this.view === "follow") this.follow = { ...this.follow, yaw: ((yaw % 360) + 360) % 360, elevation: Math.max(-5, Math.min(70, 16 + pitch)) };
    this.placeWalkerCamera(1);
  }

  /** Where the walker view looks, degrees from straight ahead, as setWalkerLook takes it: for tests. */
  walkerLook(): { yaw: number; pitch: number } {
    return this.view === "eyes" ? { ...this.eyes } : { yaw: this.follow.yaw, pitch: this.follow.elevation - 16 };
  }

  private onWheel = (e: WheelEvent): void => {
    if (this.view !== "follow") return;
    e.preventDefault();
    this.follow.distance = Math.max(2.5, Math.min(40, this.follow.distance * Math.exp(e.deltaY * 0.0012)));
    this.needsRender = true;
  };

  /** Where a click in a walker view sends the walker: a University building, or a point on the ground. */
  private walkPickAt(clientX: number, clientY: number): { building?: string; at?: [number, number] } | undefined {
    const { pick } = this.probeAt(clientX, clientY);
    if (pick?.type === "building") return { building: pick.id };
    const hits = this.raycaster.intersectObjects([...this.terrainMeshes, this.ground], false);
    const hit = hits[0];
    if (!hit || hit.distance > 1500) return undefined;
    return { at: [hit.point.x, -hit.point.z] };
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
    this.raycaster.setFromCamera(ndc, this.activeCamera);
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
    if (this.view !== "map") {
      // A drag turns the walker view; a click sends the walker.
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      this.renderer.domElement.setPointerCapture?.(e.pointerId);
      this.renderer.domElement.style.cursor = "grabbing";
      return;
    }
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.view !== "map") {
      const drag = this.drag;
      this.drag = undefined;
      this.renderer.domElement.style.cursor = "grab";
      if (drag && !drag.moved && e.button === 0) {
        const pick = this.walkPickAt(e.clientX, e.clientY);
        if (pick) this.onWalkPick?.(pick);
      }
      return;
    }
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

  /** A touch the browser took over (a scroll, a system gesture) ends a drag, and selects nothing. */
  private onPointerCancel = (): void => {
    this.drag = undefined;
    this.pointerDown = undefined;
    if (this.view !== "map") this.renderer.domElement.style.cursor = "grab";
  };

  private labelAt(clientX: number, clientY: number): LabelSpec | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.labels.hit(clientX - rect.left, clientY - rect.top);
  }

  private lastHoverCheck = 0;
  private onPointerMove = (e: PointerEvent): void => {
    if (this.view !== "map") {
      const drag = this.drag;
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      this.turnWalkerView(dx, dy);
      return;
    }
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
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    this.applyViewShift();
    this.needsRender = true;
    this.needsLabels = true;
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    // Walkers move by the clock, not by frames: on a slow renderer a frame can take a second, and
    // a walk must still take as long as it takes. A long gap (a hidden tab) counts as two seconds.
    const dt = this.lastFrame ? Math.min(2, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    if (this.tweens.length) {
      this.tweens = this.tweens.filter((t) => {
        const k = Math.min(1, (now - t.start) / t.duration);
        t.step(k);
        if (k >= 1) t.done?.();
        return k < 1;
      });
    }
    if (this.walkers.size && this.walkers.step(dt, now)) {
      this.needsRender = true;
      this.needsLabels = true;
    }
    // Also when the last walker has just gone: its name and words come off the map with it.
    if (this.walkers.labelsVersion !== this.walkerLabelsVersion) {
      this.walkerLabelsVersion = this.walkers.labelsVersion;
      this.rebuildLabels();
    }
    if (this.view === "map") this.controls.update();
    else this.placeWalkerCamera(dt);
    if (!this.needsRender) return;
    this.needsRender = false;
    if (this.needsShadow && this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.needsUpdate = true;
      this.needsShadow = false;
    }
    this.draw();
    if (this.needsLabels) {
      this.needsLabels = false;
      this.labels.update(this.activeCamera, this.width, this.height);
    }
    this.frames++;
  };

  /** The camera the picture is drawn with. */
  private get activeCamera(): OrthographicCamera | PerspectiveCamera {
    return this.view === "map" ? this.camera : this.persp;
  }

  /** A frame of the scene, with an open floor below the ground drawn through it. */
  private draw(): void {
    // A walker view has a look of its own. From a walker's height the ground hides what lies under
    // it, as it does on a street, so the floor under the ground is not drawn through it there.
    if (this.street.active) {
      this.street.render();
      return;
    }
    const camera = this.activeCamera;
    this.renderer.render(this.scene, camera);
    if (!this.openBelowGround) return;
    // The open floor again, over the picture, and then the ground over that, see-through.
    const shown = this.scene.children.map((c) => c.visible);
    const only = (keep: (o: Object3D) => boolean) => this.scene.children.forEach((c, k) => (c.visible = shown[k]! && (keep(c) || (c as DirectionalLight).isLight === true)));
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    only((c) => c === this.detailGroup || c === this.pinGroup || c === this.walkers.group);
    this.renderer.render(this.scene, camera);
    only((c) => c === this.ground || this.terrainMeshes.includes(c as Mesh));
    this.groundVeil.color.setHex(this.palette.ground);
    this.scene.overrideMaterial = this.groundVeil;
    this.renderer.render(this.scene, camera);
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
      return !!mesh && !!(mesh.userData.mapMaterial as MeshLambertMaterial[])[0]?.map;
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
   * What of the open floor in building view a level line meets on its way from one point to
   * another, metres east and north, at a height in metres over the floor's slab: the roles of the
   * meshes it passes through ("slab", "cut", "plan", ...). It looks both ways, as a wall of no
   * thickness has one face. For tests.
   */
  openFloorAcross(ax: number, ay: number, bx: number, by: number, above: number): string[] {
    const cur = this.currentFloor();
    if (!cur) return [];
    const height = this.floorY(cur.b, cur.floor.i) + above;
    const a = new Vector3(ax, height, -ay);
    const b = new Vector3(bx, height, -by);
    const meshes = this.detailGroup.children.filter((o): o is Mesh => o instanceof Mesh);
    const roles = [a, b].flatMap((from, k) => {
      const along = (k ? a : b).clone().sub(from);
      const ray = new Raycaster(from, along.clone().normalize(), 0, along.length());
      return ray.intersectObjects(meshes, false).map((h) => String(h.object.userData.role));
    });
    return [...new Set(roles)];
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

  /**
   * How the walker views are drawn now: tier, passes, sky and exposure, and how many buildings
   * wear the facades drawn by rule; "off" and none on the map. For tests.
   */
  streetState(): StreetState & { facades: FacadeCount; ground: GroundCount; trees: TreeCount } {
    const street = (m: Material | Material[]) => !Array.isArray(m) && m.name.startsWith("StreetFacade");
    const ground = (m: Material | Material[]) => !Array.isArray(m) && m.name.startsWith("StreetGround");
    const surfaces = [...this.terrainMeshes, this.ground, ...this.groundLayers].filter((m) => ground(m.material));
    return {
      ...this.street.state(),
      facades: {
        university: [...this.buildingMeshes.values()].filter((m) => street(m.material)).length,
        city: this.cityBuildings && street(this.cityBuildings.mesh.material) ? 1 : 0,
      },
      ground: {
        surfaces: surfaces.length,
        water: surfaces.some((m) => (m.material as Material).name === "StreetGround-water"),
      },
      trees: this.street.trees?.count() ?? { street: 0, cards: 0 },
    };
  }

  /**
   * Gives every building the walls of the view it is seen in: in a walker view the facades drawn by
   * rule (street/facade.ts), once they have loaded; on the map its own materials, as they were.
   */
  private dressBuildings(): void {
    const facades = this.street.facades;
    const first = !!facades && this.street.depthFirst;
    const city = this.cityBuildings;
    if (city) {
      city.mesh.material = facades ? (this.cityMaterial ??= facades.material("city")) : city.map;
      this.depthFirst(city.mesh, first);
    }
    for (const [id, mesh] of this.buildingMeshes) {
      let street = this.streetMaterials.get(id);
      if (facades && !street) this.streetMaterials.set(id, (street = facades.material("university")));
      mesh.material = facades && street ? street : (mesh.userData.mapMaterial as Material[]);
      this.depthFirst(mesh, first);
    }
    if (facades && !this.openMaterials) {
      const cut = facades.material("university");
      // Where a room or a shape meets the outer wall their faces coincide; the outer wall wins.
      cut.polygonOffset = true;
      cut.polygonOffsetFactor = -1;
      cut.polygonOffsetUnits = -1;
      this.openMaterials = { below: facades.material("university"), cut };
    }
    for (const child of this.detailGroup.children) {
      const role = child.userData.role as string | undefined;
      if (role !== "below" && role !== "cut") continue;
      const mesh = child as Mesh;
      const street = this.openMaterials?.[role];
      mesh.material = facades && street ? street : (mesh.userData.mapMaterial as Material[]);
      // The cut walls stand in front of what they meet; they are few, and drawn without a twin.
      this.depthFirst(mesh, first && role === "below");
    }
    this.dressGround();
    this.dressTrees();
    this.restyle();
    this.needsRender = true;
  }

  /**
   * Gives the trees the look of the view they are seen in: in a walker view, once it has loaded,
   * trees of bark and leaves drawn by rule where the map's stand (street/trees.ts), planted the
   * first time; on the map its own, as they were. Both stand in the map's group of trees, which
   * goes while a building is open.
   */
  private dressTrees(): void {
    const group = this.trees;
    const trees = this.street.trees;
    if (!group) return;
    if (trees && this.treesPlanted !== this.treeSpecs) {
      trees.plant(this.treeSpecs);
      this.treesPlanted = this.treeSpecs;
    }
    if (trees && trees.group.parent !== group) group.add(trees.group);
    // The shadows are drawn again only when the trees that cast them change.
    let changed = false;
    for (const child of group.children) {
      const show = child.name === "StreetTrees" ? !!trees : !trees;
      if (child.visible !== show) changed = true;
      child.visible = show;
    }
    if (changed) this.needsShadow = true;
  }

  /**
   * Gives the ground the materials of the view it is seen in: in a walker view, once they have
   * loaded, the ground drawn by rule (street/ground.ts), laid where a walker's feet stand; on the
   * map its own, as it was. In a walker view the terrain is lifted to the walker's feet, the paint
   * lowered to it in its shader, and the paint drawn top layer first, before the ground under it.
   */
  private dressGround(): void {
    const ground = this.street.ground;
    const twins = !!ground && this.street.depthFirst;
    for (const mesh of [...this.terrainMeshes, this.ground]) {
      mesh.material = ground ? ground.open : this.groundMaterial;
      // On a graphics card the ground's depth goes in first and its colour after the paint; elsewhere it is drawn before.
      mesh.renderOrder = !ground ? 0 : twins ? GROUND_ORDER_AFTER : GROUND_ORDER_BEFORE;
      if (mesh !== this.ground) {
        mesh.position.y = ground ? GROUND_PAINT : 0;
        this.depthFirst(mesh, twins);
      }
    }
    // The plane round the terrain goes back to exactly where the map had it.
    const plane = this.ground.userData as { mapY?: number };
    if (ground && plane.mapY === undefined) {
      plane.mapY = this.ground.position.y;
      this.ground.position.y += GROUND_PAINT;
    } else if (!ground && plane.mapY !== undefined) {
      this.ground.position.y = plane.mapY;
      plane.mapY = undefined;
    }
    for (const mesh of this.groundLayers) {
      const { kind, lift } = mesh.userData.groundLayer as { kind: Exclude<GroundKind, "open">; lift: number };
      mesh.material = ground ? ground.paint(kind, lift - GROUND_PAINT) : (mesh.userData.mapMaterial as Material);
      mesh.renderOrder = ground ? PAINT_ORDER - GROUND[kind] / 100 : 0;
      mesh.userData.noAO = !!ground;
    }
  }

  /**
   * In a walker view on a graphics card a building's walls are first drawn into the depth buffer
   * alone (StreetLook.depthFirst), so that the facades drawn after them shade only what is in
   * front: a street of buildings in no particular order would otherwise shade the walls behind as
   * well. The copy is a little further off than the walls, so that they always pass over it, and
   * it cannot be picked or cast a shadow.
   */
  private depthFirst(mesh: Mesh, on: boolean): void {
    let twin = mesh.userData.depthTwin as Mesh | undefined;
    if (on && !twin) {
      twin = new Mesh(mesh.geometry, this.depthOnly);
      twin.renderOrder = -1;
      twin.matrixAutoUpdate = false;
      twin.userData.noPick = true;
      twin.raycast = () => {};
      mesh.add(twin);
      mesh.userData.depthTwin = twin;
    }
    if (twin) twin.visible = on;
  }
  private depthOnly = Object.assign(new MeshBasicMaterial({ colorWrite: false }), { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

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
      p.project(this.activeCamera);
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
    v.project(this.activeCamera);
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
    this.walkers.clear();
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.street.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.clear();
  }
}
