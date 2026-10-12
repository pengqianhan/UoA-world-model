// Criterion 6: on a 390 px wide phone the campus is visible and search leads to building and room details.
import { expect, test } from "@playwright/test";
import { expectRealRender, open, params, settle, shot } from "./helpers.ts";

test("6. phone: search for a room and see the building and class information", async ({ page }) => {
  await open(page, "?light=day");
  expect(page.viewportSize()?.width).toBe(390);
  await expectRealRender(page);
  // Nothing may overflow the viewport horizontally.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator(".brand-name")).toBeVisible();
  await expect(page.locator("#status-strip")).toContainText("Semester");
  await shot(page, "06-mobile-campus");

  await page.locator("#search-button").tap();
  const input = page.locator("#search-input");
  await input.fill("260-098");
  await shot(page, "06-mobile-search");
  await page.locator(".result-main").first().tap();
  await settle(page);

  expect(params(page).get("room")).toBe("260-098");
  await expect(page.locator(".search-panel")).toHaveCount(0);
  const bar = page.locator("#building-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("260");
  await expect(bar).toContainText("Sir Owen G Glenn Building");
  const card = page.locator("#room-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("260-098");
  await expect(card).toContainText("Floor 0");
  await expect(card.locator("#no-timetable")).toBeVisible();
  // The floor strip is usable on a phone.
  await expect(page.locator(".floor.on")).toHaveAttribute("data-floor", "0");
  await expectRealRender(page);
  await shot(page, "06-mobile-room");

  await page.locator('.floor[data-floor="1"]').tap();
  await settle(page);
  expect(params(page).get("floor")).toBe("1");
  await shot(page, "06-mobile-floor");

  // Building search works too.
  await page.locator("#search-button").tap();
  await input.fill("engineering");
  await expect(page.locator(".result-main").first()).toContainText("Engineering");
  await page.locator(".result-main").first().tap();
  await settle(page);
  await expect(bar).toContainText("Engineering");

  // About is reachable and readable.
  await page.getByRole("button", { name: "About", exact: true }).tap();
  await expect(page.locator("#unofficial-notice")).toBeVisible();
  await shot(page, "06-mobile-about");
});
