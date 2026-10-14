// The sky over the campus: the sun where it really stands at the time shown, deciduous trees by
// the season, and in Now mode the current weather from Open-Meteo.
import { expect, test, type Page } from "@playwright/test";
import { open, shot } from "./helpers.ts";

const light = (page: Page) => page.evaluate(() => window.__scene!.lightState());

/** Open-Meteo's answer, served only inside the test browser. */
async function weatherNow(page: Page, current: Record<string, number>): Promise<void> {
  await page.unroute("**/api.open-meteo.com/**");
  await page.route("**/api.open-meteo.com/**", (route) => route.fulfill({ json: { current } }));
}

test("the sun stands where it really does at the time shown, and deciduous trees follow the season", async ({ page }) => {
  // Winter noon: the sun due north and low, 90° - 36.85° - 23.44°.
  await open(page, "?time=preview&date=2026-06-22&t=12:20");
  let l = await light(page);
  expect(l.elevation).toBeGreaterThan(28);
  expect(l.elevation).toBeLessThan(31.5);
  expect(Math.min(l.azimuth, 360 - l.azimuth)).toBeLessThan(5);
  expect(l.weather).toBeUndefined();
  expect(l.deciduousTrees).toBeGreaterThan(10);
  const winter = l.deciduous;
  await shot(page, "17-sun-winter-noon");

  // Summer noon: high in the north.
  await open(page, "?time=preview&date=2026-12-21&t=13:20");
  l = await light(page);
  expect(l.elevation).toBeGreaterThan(74);
  expect(l.elevation).toBeLessThan(79);
  expect(l.deciduous).not.toBe(winter);
  await shot(page, "17-sun-summer-noon");

  // A summer morning: low in the east-north-east, held at 10° so shadows stay on the map.
  await open(page, "?time=preview&date=2026-12-21&t=06:40");
  l = await light(page);
  expect(l.azimuth).toBeGreaterThan(95);
  expect(l.azimuth).toBeLessThan(130);
  expect(l.elevation).toBeCloseTo(10, 0);

  // Autumn leaves differ from both.
  await open(page, "?time=preview&date=2026-04-28&t=12:00");
  l = await light(page);
  expect(l.deciduous).not.toBe(winter);
});

test("in Now mode the sky follows Open-Meteo's current weather: rain falls and darkens the streets, fog hazes the view", async ({ page }) => {
  await weatherNow(page, { temperature_2m: 14.2, weather_code: 63, cloud_cover: 100, precipitation: 2.4, wind_speed_10m: 28, wind_direction_10m: 250 });
  await open(page, "");
  await page.waitForFunction(() => !!window.__scene!.lightState().weather);
  let l = await light(page);
  expect(l.weather!.wet).toBe(1);
  expect(l.weather!.cloud).toBeGreaterThanOrEqual(0.85);
  expect(l.fog).toBe(false);
  await expect(page.locator("#rain-layer")).toBeVisible();
  await expect(page.locator(".chip-weather")).toContainText("14°");
  await shot(page, "17-weather-rain");

  // Fog: no rain, a hazy distance.
  await weatherNow(page, { temperature_2m: 11, weather_code: 45, cloud_cover: 100, precipitation: 0, wind_speed_10m: 4, wind_direction_10m: 90 });
  await open(page, "");
  await page.waitForFunction(() => window.__scene!.lightState().weather?.fog === 1);
  l = await light(page);
  expect(l.fog).toBe(true);
  await expect(page.locator("#rain-layer")).toHaveCount(0);

  // Preview shows no weather: past and future weather is not known here.
  await open(page, "?time=preview&date=2026-08-12&t=14:05");
  await page.waitForTimeout(2000);
  l = await light(page);
  expect(l.weather).toBeUndefined();
  expect(l.fog).toBe(false);
  await expect(page.locator("#rain-layer")).toHaveCount(0);
});
