// The ground under the map: real heights from the LINZ 8 m DEM, with the University's buildings,
// the city round them and the open floor all standing on it.
import { expect, test } from "@playwright/test";
import { expectRealRender, open, shot } from "./helpers.ts";

// Points in the local frame, metres east and north of the origin on Symonds Street.
const SCIENCE_CENTRE = [-89.4, -31.4] as const;
const GRAFTON_GULLY = [258.6, -410.6] as const;
const LOWER_QUEEN_STREET = [-142.7, 887.8] as const;
// Lines from west to east across the Southern Underpass (331): over the middle of its passage
// under Symonds Street, and over its south stairway.
const ACROSS_THE_PASSAGE = [30, -47, 48, -47] as const;
const ACROSS_THE_STAIRWAY = [30, -74, 48, -74] as const;

test("the campus stands on the ground's real heights: the City Campus on its ridge, Grafton Gully and the harbour below", async ({ page }) => {
  await open(page, "?light=day&time=preview&date=2026-03-20&t=15:00");
  await page.waitForFunction(() => window.__scene!.groundState(0, 0).terrain);
  const science = await page.evaluate(([x, y]) => window.__scene!.groundState(x, y, "303"), SCIENCE_CENTRE);
  expect(science.base!).toBeGreaterThan(30);
  // The building's mesh stands at its floor, and a footing reaches no more than 4 m lower.
  expect(science.meshY!).toBeCloseTo(science.base!, 3);
  expect(science.base! - science.low!).toBeLessThanOrEqual(4.001);
  const gully = await page.evaluate(([x, y]) => window.__scene!.groundState(x, y).ground, GRAFTON_GULLY);
  expect(gully).toBeLessThan(science.base! - 10);
  const harbour = await page.evaluate(([x, y]) => window.__scene!.groundState(x, y).ground, LOWER_QUEEN_STREET);
  expect(harbour).toBeLessThan(15);
  await expectRealRender(page);
  await shot(page, "18-ground-campus");

  // In building view the open floor is framed where it stands, high on the ridge.
  await open(page, "?building=303&floor=1&light=day&time=preview&date=2026-03-20&t=15:00");
  const camera = await page.evaluate(() => window.__scene!.cameraState());
  expect(camera.target[1]).toBeGreaterThan(30);
  await expect(page.locator('[data-label="room:303-101"]')).toBeVisible();
  await shot(page, "18-ground-303");
});

test("an underpass lies under its street: of the Southern Underpass only the two stairways stand above Symonds Street", async ({ page }) => {
  await open(page, "?light=day&time=preview&date=2026-03-20&t=15:00");
  await page.waitForFunction(() => window.__scene!.groundState(0, 0).terrain);
  const { base, low } = await page.evaluate(() => window.__scene!.groundState(38, -47, "331"));
  expect(base! - low!).toBeGreaterThan(0.05);
  const across = (line: readonly number[], height: number) =>
    page.evaluate(([ax, ay, bx, by, h]) => window.__scene!.buildingsAcross(ax!, ay!, bx!, by!, h!), [...line, height]);
  // Over the passage nothing stands at storey height, and no footing fills the ground under it.
  expect(await across(ACROSS_THE_PASSAGE, base! + 1.8)).not.toContain("331");
  expect(await across(ACROSS_THE_PASSAGE, (base! + low!) / 2)).not.toContain("331");
  expect(await across(ACROSS_THE_STAIRWAY, base! + 1.8)).toContain("331");
  await page.evaluate(() => window.__scene!.showCampus([37.6, -48.5], 70, false));
  await expectRealRender(page);
  await shot(page, "18-ground-underpass");
});

test("a campus away from the centre stands on its own ground", async ({ page }) => {
  await open(page, "?campus=leigh&light=day&time=preview&date=2026-03-20&t=15:00");
  await page.waitForFunction(() => window.__scene!.groundState(2610, 64695).terrain);
  const lab = await page.evaluate(() => window.__scene!.groundState(2610, 64695, "604"));
  expect(lab.base!).toBeGreaterThan(0);
  expect(lab.meshY!).toBeCloseTo(lab.base!, 3);
  await expectRealRender(page);
  await shot(page, "18-ground-leigh");
});
