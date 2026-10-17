// The street look: what a walker sees has a sky, a light and a haze of its own, and the map is
// drawn as it always was once the walker view is left.
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
  await openStreet(page, `?walk=1&view=eyes&light=day&${T}&t=15:00`);
  const day = await street(page);
  expect(day).toMatchObject({ active: true, sky: true });
  // The full tier on a graphics card; the basic one in software (CI) and on phones.
  expect(["full", "basic"]).toContain(day.tier);
  expect(day.passes[0]).toBe("scene");
  // The distance is hazed into the sky.
  expect((await page.evaluate(() => window.__scene!.lightState())).fog).toBe(true);
  await expectRealRender(page);
  await shot(page, "21-street-eyes-day");

  // Escape goes back to the map: the look is gone, and the map by day has no haze, as before.
  await page.keyboard.press("Escape");
  await expect(page.locator('#walker-panel button[data-view="map"]')).toHaveAttribute("aria-pressed", "true");
  expect(await street(page)).toMatchObject({ active: false, tier: "off", passes: [], exposure: 1 });
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
