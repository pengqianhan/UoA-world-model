import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const SHOTS = path.join("e2e", "screenshots");

interface SceneHandle {
  frames: number;
  animating: boolean;
  loading: number;
  planShapes: number;
  planPoint(): { x: number; y: number } | undefined;
  spaceAt(x: number, y: number): { text: string; kind: string } | undefined;
  spaceFloors(): { kind: string; colour: number }[];
  groundState(x: number, y: number, building?: string): { terrain: boolean; ground: number; base?: number; low?: number; meshY?: number };
  buildingsAcross(ax: number, ay: number, bx: number, by: number, height: number): string[];
  openFloorAcross(ax: number, ay: number, bx: number, by: number, above: number): string[];
  showCampus(center: [number, number], span: number, animate?: boolean): void;
  pinOutline(): { text: string; kind: string; icon?: string } | undefined;
  lightState(): {
    azimuth: number;
    elevation: number;
    weather?: { cloud: number; wet: number; fog: number };
    fog: boolean;
    deciduous: number;
    deciduousTrees: number;
  };
  floorWalls(): { planWallFaces: number; rooms: number; walledRooms: number; outerWalls: boolean; windowsBelow: boolean };
  openFloorBox(): { left: number; top: number; right: number; bottom: number } | undefined;
  probe(): { width: number; height: number; distinctColours: number; samples: number };
  cameraState(): { azimuth: number; polar: number; zoom: number; target: [number, number, number] };
  walkerLook(): { yaw: number; pitch: number };
  screenPoint(kind: "building" | "room", id: string): { x: number; y: number } | undefined;
}

declare global {
  interface Window {
    __scene?: SceneHandle;
  }
}

/** Opens a path relative to the site root and waits until the 3D scene has drawn and settled. */
export async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`./${query}`);
  await settle(page);
}

/** Waits for data, the first frames, and any camera animation to finish. */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__scene && window.__scene.frames > 2, undefined, { timeout: 30_000 });
  await expect(page.locator(".splash")).toHaveCount(0);
  await page.waitForFunction(() => !window.__scene!.animating && !window.__scene!.loading);
  // Let label layout and the last frame land.
  await page.waitForTimeout(250);
}

/**
 * Fails unless the canvas holds a real picture. Headless WebGL can "work" and still draw nothing,
 * so the scene is re-rendered and sampled on a grid.
 */
export async function expectRealRender(page: Page, minColours = 12): Promise<void> {
  const probe = await page.evaluate(() => window.__scene!.probe());
  expect(probe.width).toBeGreaterThan(100);
  expect(probe.distinctColours, `distinct colours in ${probe.samples} samples`).toBeGreaterThan(minColours);
}

/** Opens the campus panel, which starts shut as a button with the campus's name. */
export async function openStrip(page: Page): Promise<void> {
  const strip = page.locator("#status-strip");
  if (await strip.isVisible()) return;
  await page.locator("#status-toggle").click();
  await expect(strip).toBeVisible();
}

export async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

export function params(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

/**
 * A timetable that is obviously not real, used to exercise the timetable features end to end.
 * It is served only inside the test browser; the published site never contains it.
 */
export function fixtureSchedule() {
  const session = (course: number, day: number, start: number, end: number, room: string, floor: number, component = "LEC") => ({
    course,
    term: "1265",
    component,
    section: "T01",
    day,
    start,
    end,
    startDate: "2026-07-20",
    endDate: "2026-10-23",
    sourceText: room,
    room,
    building: room.split("-")[0],
    floor,
    campus: "city",
    precision: "room",
  });
  return {
    version: 1,
    generatedAt: "2026-10-13T00:00:00.000Z",
    available: true,
    snapshotDate: "2026-10-13",
    terms: ["1265"],
    courses: [
      { code: "TESTFIX 101", subject: "TESTFIX", catalogNbr: "101", title: { en: "Fixture Course One (not a real course)" } },
      { code: "TESTFIX 202", subject: "TESTFIX", catalogNbr: "202", title: { en: "Fixture Course Two (not a real course)" } },
    ],
    sessions: [
      session(0, 2, 600, 660, "303-G23", 0),
      session(0, 4, 600, 660, "303-G23", 0),
      session(1, 2, 630, 720, "303-G20", 0),
      session(1, 2, 840, 900, "303-G23", 0, "TUT"),
    ],
    exclusions: [],
  };
}

export async function withFixtureSchedule(page: Page): Promise<void> {
  await page.route("**/data/schedule.json", (route) => route.fulfill({ json: fixtureSchedule() }));
}
