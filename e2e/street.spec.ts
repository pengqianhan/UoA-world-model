// The street look: what a walker sees has a sky, a light and a haze of its own, buildings with
// storeys, windows and walls drawn by rule, ground of asphalt, kerbs, paving, grass and water drawn
// by rule, trees of bark and leaves drawn by rule, and the map is drawn as it always was once the
// walker view is left.
import { expect, test, type Page } from "@playwright/test";
import { expectRealRender, open, shot } from "./helpers.ts";

const T = "time=preview&date=2026-03-20";
// The walker tests' window: CI draws in software, and a walker view is redrawn while anything in it moves.
test.use({ viewport: { width: 1100, height: 720 } });

const street = (page: Page) => page.evaluate(() => window.__scene!.streetState());

/** Opens a walker view and waits for the walker and for the sky, which comes in a chunk of its own. */
async function openStreet(page: Page, query: string): Promise<void> {
  await open(page, query);
  await page.waitForFunction(() => (window as unknown as { __walker?: { ready(): boolean } }).__walker?.ready(), undefined, { timeout: 30_000 });
  await page.waitForFunction(() => window.__scene!.streetState().sky, undefined, { timeout: 30_000 });
}

test("through a walker's eyes the street has a sky, a light and a haze of its own, by day and by night, and the map is lit as before after it", async ({ page }) => {
  // By day on Princes Street, by the Clock Tower.
  await openStreet(page, `?walk=-12,214&view=eyes&light=day&${T}&t=15:00`);
  const day = await street(page);
  expect(day).toMatchObject({ active: true, sky: true });
  // The full tier on a graphics card; the basic one in software (CI) and on phones.
  expect(["full", "basic"]).toContain(day.tier);
  expect(day.passes[0]).toBe("scene");
  // The distance is hazed into the sky.
  expect((await page.evaluate(() => window.__scene!.lightState())).fog).toBe(true);
  // The ground and every layer of paint over it, the city's ponds among them, wear surfaces drawn by rule.
  expect(day.ground.surfaces).toBeGreaterThan(10);
  expect(day.ground.water).toBe(true);
  // Every tree on the map stands again in bark and leaves, with cards of leaves on those round the walker.
  expect(day.trees.street).toBeGreaterThan(1000);
  await expect.poll(async () => (await street(page)).trees.cards).toBeGreaterThan(100);
  await expectRealRender(page);
  await shot(page, "21-street-eyes-day");

  // Down the street at eye level: asphalt with a white line down it, kerbs and footpaths.
  await page.evaluate(async () => {
    const walker = (window as unknown as { __walker: { run(c: string): Promise<{ walkers: { heading: number }[] }> } }).__walker;
    const { heading } = (await walker.run("list")).walkers[0]!;
    window.__scene!.setWalkerLook(200 - heading, -6);
  });
  await expectRealRender(page);
  await shot(page, "21-street-ground");

  // West across the street into Albert Park: crowns of leaves on trunks of bark across the lawn.
  await page.evaluate(async () => {
    const walker = (window as unknown as { __walker: { run(c: string): Promise<{ walkers: { heading: number }[] }> } }).__walker;
    const { heading } = (await walker.run("list")).walkers[0]!;
    window.__scene!.setWalkerLook(255 - heading, -2);
  });
  await expectRealRender(page);
  await shot(page, "21-street-trees");

  // Escape goes back to the map: the look is gone, and the map by day has no haze, as before.
  await page.keyboard.press("Escape");
  await expect(page.locator('#walker-panel button[data-view="map"]')).toHaveAttribute("aria-pressed", "true");
  expect(await street(page)).toMatchObject({ active: false, tier: "off", passes: [], exposure: 1, ground: { surfaces: 0, water: false }, trees: { street: 0, cards: 0 } });
  expect((await page.evaluate(() => window.__scene!.lightState())).fog).toBe(false);
  await expectRealRender(page);

  // By night: the same look, the picture opened up for the dark.
  await openStreet(page, `?walk=1&view=eyes&light=night&${T}&t=21:00`);
  const night = await street(page);
  expect(night).toMatchObject({ active: true, sky: true });
  expect(night.exposure).toBeGreaterThan(day.exposure);
  await expectRealRender(page);
  await shot(page, "21-street-eyes-night");
});

test("from a walker's height every building has storeys, windows and walls drawn by rule, and the map keeps its own after", async ({ page }) => {
  await openStreet(page, `?walk=1&view=eyes&light=day&${T}&t=15:00`);
  // Every University building on the map, and the city round them, which is one mesh.
  const on = await street(page);
  expect(on.facades.university).toBeGreaterThan(100);
  expect(on.facades.city).toBe(1);

  // Close to a wall of the Clock Tower, at eye level: a walk to a building ends beside its nearest wall.
  const walked = await page.evaluate(() => (window as unknown as { __walker: { run(c: string, a: object): Promise<{ arrived: boolean }> } }).__walker.run("walk", { to: "105", speed: 40 }));
  expect(walked.arrived).toBe(true);
  await page.evaluate(() => window.__scene!.setWalkerLook(0, 8));
  await page.waitForTimeout(400);
  await expectRealRender(page);
  await shot(page, "21-street-facade");

  // Back on the map every building has the map's materials again, and the map's trees are back.
  await page.keyboard.press("Escape");
  await expect(page.locator('#walker-panel button[data-view="map"]')).toHaveAttribute("aria-pressed", "true");
  const off = await street(page);
  expect(off.facades).toEqual({ university: 0, city: 0 });
  expect(off.trees).toEqual({ street: 0, cards: 0 });
});
