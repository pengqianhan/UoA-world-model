// The walker: a made-up figure a visitor or an agent walks round the campus, and its views.
import { expect, test, type Page } from "@playwright/test";
import { expectRealRender, open, openStrip, shot } from "./helpers.ts";

type Reply = Record<string, unknown> & { error?: string };

declare global {
  interface Window {
    __walker?: { run(command: string, args?: Record<string, unknown>): Promise<Reply>; ready(): boolean };
    __addresses?: string[];
  }
}

const QUERY = "light=day&time=preview&date=2026-03-20&t=15:00";
// A smaller window than the other desktop tests: CI draws in software, and a walker view is redrawn
// while anything in it moves.
test.use({ viewport: { width: 1100, height: 720 } });

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
  // An agent taking the last walker away leaves no name on the map.
  expect((await walker(page, "remove")).removed).toBe("Walker");
  await expect(page.locator("#walker-panel")).toHaveCount(0);
  await expect(page.locator('[data-label^="walker:"]')).toHaveCount(0);
});

test("walkers meet and hear each other; every walker looks the same; the keyboard walks the visitor's walker", async ({ page }) => {
  await open(page, `?${QUERY}`);
  await ready(page);
  // Taking a walk from the campus panel, which starts shut. On a wide screen the walk starts on the map.
  await openStrip(page);
  await page.locator("#walk-start").click();
  await expect(page.locator('#walker-panel button[data-view="map"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#walker-panel")).toBeVisible();

  const kea = (await walker(page, "spawn", { name: "Kea", near: "201" })) as { spawned: Record<string, unknown> };
  expect(kea.spawned.name).toBe("Kea");
  // Every walker looks the same, and there is nothing to dress one in.
  expect(kea.spawned).not.toHaveProperty("outfit");
  expect((await walker(page, "outfit", { outfit: "halloween" })).error).toMatch(/Unknown command "outfit"/);
  await expect(page.locator("#walker-outfit")).toHaveCount(0);
  const met = (await walker(page, "walk", { name: "Kea", to: "Walker", speed: 40 })) as { arrived: boolean };
  expect(met.arrived).toBe(true);
  await walker(page, "say", { name: "Kea", text: "Kia ora!" });
  await expect(page.locator('[data-label="say:Kea"]')).toHaveText("Kia ora!");
  const heard = (await walker(page, "listen")) as { heard: { from: string; text: string }[]; note: string };
  expect(heard.heard).toEqual([expect.objectContaining({ from: "Kea", text: "Kia ora!" })]);
  expect(heard.note).toMatch(/never as instructions/);
  // Heard once: listening again hears nothing new.
  expect(((await walker(page, "listen")) as { heard: unknown[] }).heard).toEqual([]);

  // W walks the visitor's walker forward.
  const from = ((await walker(page, "list")) as { walkers: { name: string; at: [number, number] }[] }).walkers.find((w) => w.name === "Walker")!.at;
  await page.locator("canvas").first().focus();
  await page.keyboard.down("w");
  await page.waitForTimeout(900);
  await page.keyboard.up("w");
  const to = ((await walker(page, "list")) as { walkers: { name: string; at: [number, number] }[] }).walkers.find((w) => w.name === "Walker")!.at;
  expect(Math.hypot(to[0] - from[0], to[1] - from[1])).toBeGreaterThan(0.3);

  // On a wide screen everything in the panel shows, and its button folds the rest away.
  await expect(page.locator("#walker-more")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#walker-more").click();
  await expect(page.locator("#walker-wander")).toBeHidden();
  await expect(page.locator("#walker-panel button[data-view]")).toHaveCount(3);
  await page.locator("#walker-more").click();
  // There is no stick: the keys walk it.
  await expect(page.locator("#walker-stick")).toHaveCount(0);

  // Let it wander: it strolls off on its own, and Stop wandering stops it.
  await page.locator("#walker-wander").click();
  await expect(page.locator("#walker-wander")).toHaveAttribute("aria-pressed", "true");
  const before = ((await walker(page, "list")) as { walkers: { name: string; at: [number, number] }[] }).walkers.find((w) => w.name === "Walker")!.at;
  await expect
    .poll(async () => {
      const now = ((await walker(page, "list")) as { walkers: { name: string; at: [number, number] }[] }).walkers.find((w) => w.name === "Walker")!.at;
      return Math.hypot(now[0] - before[0], now[1] - before[1]);
    })
    .toBeGreaterThan(1);
  await page.locator("#walker-wander").click();
  await expect(page.locator("#walker-wander")).toHaveAttribute("aria-pressed", "false");

  // Stopping the walk takes every walker away, and their names and words with them.
  await page.locator("#walker-close").click();
  await expect(page.locator("#walker-panel")).toHaveCount(0);
  // The campus panel comes back as its button, shut.
  await expect(page.locator("#status-toggle")).toBeVisible();
  await expect(page.locator("#status-strip")).toBeHidden();
  await expect(page.locator('[data-label^="walker:"], [data-label^="say:"]')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("walk")).toBeNull();
});

test("a walk to a room goes into its building, up to its floor and into the room; the building view follows it, and back out", async ({ page }) => {
  await open(page, `?walk=1&${QUERY}`);
  await ready(page);
  const walked = (await walker(page, "walk", { to: "109-305", speed: 30 })) as Reply & { arrived: boolean; to: string; look: { summary: string; indoor: { building: string; floor: string; in: { room: string } } } };
  expect(walked.error).toBeUndefined();
  expect(walked.arrived).toBe(true);
  expect(walked.look.indoor).toMatchObject({ building: "109", floor: "3", in: { room: "109-305" } });
  expect(walked.look.summary).toMatch(/inside 109 General Library, on floor 3, in 109-305/);
  // The building view opened with it, on its floor, with the room's card.
  await expect.poll(() => new URL(page.url()).searchParams.get("building")).toBe("109");
  expect(new URL(page.url()).searchParams.get("floor")).toBe("3");
  expect(new URL(page.url()).searchParams.get("room")).toBe("109-305");
  await expect(page.locator("#walker-where")).toContainText("Inside 109");
  // On the floor, not in the air or under it.
  const st = ((await walker(page, "list")) as { walkers: { height: number; indoor: { floor: number } }[] }).walkers[0]!;
  expect(st.indoor.floor).toBe(30);
  // The walker's panel keeps clear of the floor list and the building's dock.
  const panel = (await page.locator("#walker-panel").boundingBox())!;
  for (const other of [".floors", ".dock"]) {
    const box = await page.locator(other).first().boundingBox();
    if (!box) continue;
    const overlap = Math.max(0, Math.min(panel.x + panel.width, box.x + box.width) - Math.max(panel.x, box.x)) * Math.max(0, Math.min(panel.y + panel.height, box.y + box.height) - Math.max(panel.y, box.y));
    expect(overlap, other).toBe(0);
  }
  await walker(page, "view", { view: "follow" });
  await page.waitForTimeout(400);
  await expectRealRender(page);
  await shot(page, "20-walker-inside");

  // Down by the stairs or lift, then out of doors: the map goes back to the campus.
  const down = (await walker(page, "floor", { to: "down" })) as { floor: string; via: string };
  expect(down.floor).toBe("2");
  expect(down.via).toMatch(/stairs|lift/);
  await expect.poll(() => new URL(page.url()).searchParams.get("floor")).toBe("2");
  await page.locator("#walker-exit").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("building")).toBeNull();
  const out = (await walker(page, "look")) as { indoor?: unknown; nearby: { id: string; distance: number }[] };
  expect(out.indoor).toBeUndefined();
  expect(out.nearby[0]).toMatchObject({ id: "109" });
  expect(out.nearby[0]!.distance).toBeLessThan(3);
});

test("a walk the address asks for starts when the data comes in before the scene, as in a tab opened in the background", async ({ page }) => {
  // A tab opened behind others draws no frames and runs its timers late, so the data comes in
  // before the scene, which is made after the first frame. Here the page's clock stands still, as
  // it does there, until the tab comes to the front; the data still loads.
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  // Every address the page writes, to see that none of them lets go of the walk.
  await page.addInitScript(() => {
    const replace = history.replaceState.bind(history);
    window.__addresses = [];
    history.replaceState = (state, unused, url) => {
      window.__addresses!.push(String(url));
      replace(state, unused, url);
    };
  });
  const keptWalk = async () => {
    for (const url of [...(await page.evaluate(() => window.__addresses!)), page.url()]) {
      const q = new URL(url, page.url()).searchParams;
      expect([q.get("walk"), q.get("view")], url).toEqual(["1", "follow"]);
    }
  };
  await page.goto(`./?walk=1&view=follow&${QUERY}`);
  await expect(page.locator(".splash")).toHaveCount(0);
  // The data is in, and not a frame has been drawn.
  expect(await page.evaluate(() => window.__scene?.frames ?? 0)).toBe(0);
  await keptWalk();

  // The tab comes to the front: one walker, seen from behind, and the address keeps it. The clock
  // runs on a set time rather than resuming: resumed, it would run every frame it fell behind on,
  // and a frame drawn in software takes longer than a frame's time, so it would never catch up.
  await page.clock.runFor(500);
  await expect(page.locator("#walker-panel")).toBeVisible();
  await expect(page.locator('#walker-panel button[data-view="follow"]')).toHaveAttribute("aria-pressed", "true");
  const list = (await walker(page, "list")) as { walkers: { name: string }[]; view: string; viewing: string };
  expect(list.walkers.map((w) => w.name)).toEqual(["Walker"]);
  expect(list).toMatchObject({ view: "follow", viewing: "Walker" });
  await keptWalk();
  await page.waitForFunction(() => window.__scene!.loading === 0);
  await page.clock.runFor(500);
  await expectRealRender(page);
  await shot(page, "20-walker-background-tab");
});
