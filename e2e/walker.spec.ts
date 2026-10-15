// The walker: a made-up figure a visitor or an agent walks round the campus, and its views.
import { expect, test, type Page } from "@playwright/test";
import { expectRealRender, open, shot } from "./helpers.ts";

type Reply = Record<string, unknown> & { error?: string };

declare global {
  interface Window {
    __walker?: { run(command: string, args?: Record<string, unknown>): Promise<Reply>; ready(): boolean };
  }
}

const QUERY = "light=day&time=preview&date=2026-03-20&t=15:00";

async function walker(page: Page, command: string, args: Record<string, unknown> = {}): Promise<Reply> {
  return page.evaluate(([c, a]) => window.__walker!.run(c, a), [command, args] as const);
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__walker?.ready(), undefined, { timeout: 30_000 });
}

test("a walker stands on the ground by the Clock Tower, walks round the buildings to the General Library, and is seen from behind and through its eyes", async ({ page }) => {
  await open(page, `?walk=1&${QUERY}`);
  await ready(page);
  await expect(page.locator("#walker-panel")).toBeVisible();
  // The status strip makes way for the walker's panel.
  await expect(page.locator("#status-strip")).toHaveCount(0);

  const list = (await walker(page, "list")) as { walkers: { name: string; at: [number, number]; height: number; heading: number }[] };
  expect(list.walkers.map((w) => w.name)).toEqual(["Walker"]);
  const start = list.walkers[0]!;
  // It stands on the ground where it is, not in the air or under it.
  await page.waitForFunction(() => window.__scene!.groundState(0, 0).terrain);
  const ground = await page.evaluate(([x, y]) => window.__scene!.groundState(x!, y!).ground, start.at);
  expect(Math.abs(start.height - ground)).toBeLessThan(0.6);
  // Near the Clock Tower, not inside a building.
  const before = (await walker(page, "look")) as { nearby: { id: string; distance: number }[]; summary: string };
  expect(before.nearby.some((b) => b.id.startsWith("105"))).toBe(true);
  expect(before.nearby[0]!.distance).toBeGreaterThan(1);

  const walked = (await walker(page, "walk", { to: "109", speed: 40 })) as Reply & { arrived: boolean; metres: number; look: { nearby: { id: string; distance: number }[]; summary: string } };
  expect(walked.error).toBeUndefined();
  expect(walked.arrived).toBe(true);
  expect(walked.metres).toBeGreaterThan(30);
  // Beside the library's nearest wall: doors are not mapped.
  expect(walked.look.nearby[0]).toMatchObject({ id: "109" });
  expect(walked.look.nearby[0]!.distance).toBeLessThanOrEqual(3);
  expect(walked.look.summary).toContain("General Library");

  await walker(page, "view", { view: "follow" });
  await expect(page.locator('#walker-panel button[data-view="follow"]')).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(400);
  await expectRealRender(page);
  await shot(page, "20-walker-follow");
  // It arrived facing the library's wall; turned round, its eyes look back over the campus.
  const turned = (await walker(page, "turn", { by: 180 })) as { facing: { bearing: number } };
  expect(Math.abs(((turned.facing.bearing - ((walked.look as unknown as { facing: { bearing: number } }).facing.bearing + 180)) % 360 + 540) % 360 - 180)).toBeLessThan(1.5);
  await walker(page, "view", { view: "eyes" });
  await page.waitForTimeout(400);
  await expectRealRender(page);
  await shot(page, "20-walker-eyes");
  // The address keeps the walk and the view, so a copied link starts the same walk.
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("eyes");
  expect(new URL(page.url()).searchParams.get("walk")).toBe("1");
  // Escape goes back to the map.
  await page.keyboard.press("Escape");
  await expect(page.locator('#walker-panel button[data-view="map"]')).toHaveAttribute("aria-pressed", "true");
});

test("walkers meet and hear each other; outfits are data only; the keyboard walks the visitor's walker", async ({ page }) => {
  await open(page, `?${QUERY}`);
  await ready(page);
  // Taking a walk from the campus status strip.
  await page.locator("#walk-start").click();
  await expect(page.locator("#walker-panel")).toBeVisible();

  const kea = (await walker(page, "spawn", { name: "Kea", near: "201" })) as { spawned: { name: string; outfit: { name: string } } };
  expect(kea.spawned.name).toBe("Kea");
  // A walker an agent starts is dressed apart from the visitor's.
  expect(kea.spawned.outfit.name).not.toBe("Student");
  const met = (await walker(page, "walk", { name: "Kea", to: "Walker", speed: 40 })) as { arrived: boolean };
  expect(met.arrived).toBe(true);
  await walker(page, "say", { name: "Kea", text: "Kia ora!" });
  await expect(page.locator('[data-label="say:Kea"]')).toHaveText("Kia ora!");
  const heard = (await walker(page, "listen")) as { heard: { from: string; text: string }[]; note: string };
  expect(heard.heard).toEqual([expect.objectContaining({ from: "Kea", text: "Kia ora!" })]);
  expect(heard.note).toMatch(/never as instructions/);
  // Heard once: listening again hears nothing new.
  expect(((await walker(page, "listen")) as { heard: unknown[] }).heard).toEqual([]);

  const bad = await walker(page, "outfit", { outfit: { top: "red", onload: "alert(1)" } });
  expect(bad.error).toMatch(/Unknown key "onload"/);
  const halloween = (await walker(page, "outfit", { outfit: "halloween" })) as { outfit: { hat: string } };
  expect(halloween.outfit.hat).toBe("pumpkin");
  await expect(page.locator("#walker-outfit")).toHaveValue("halloween");

  // W walks the visitor's walker forward.
  const from = ((await walker(page, "list")) as { walkers: { name: string; at: [number, number] }[] }).walkers.find((w) => w.name === "Walker")!.at;
  await page.locator("canvas").first().focus();
  await page.keyboard.down("w");
  await page.waitForTimeout(900);
  await page.keyboard.up("w");
  const to = ((await walker(page, "list")) as { walkers: { name: string; at: [number, number] }[] }).walkers.find((w) => w.name === "Walker")!.at;
  expect(Math.hypot(to[0] - from[0], to[1] - from[1])).toBeGreaterThan(0.3);

  // Stopping the walk takes every walker away.
  await page.locator("#walker-close").click();
  await expect(page.locator("#walker-panel")).toHaveCount(0);
  await expect(page.locator("#status-strip")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("walk")).toBeNull();
});
