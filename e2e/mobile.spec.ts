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
  // Every floor of a tall building must be reachable by scrolling the strip, not just the first few.
  const top = page.locator('.floor[data-floor="7"]');
  await top.scrollIntoViewIfNeeded();
  await expect(top).toBeInViewport();
  await top.tap();
  await settle(page);
  expect(params(page).get("floor")).toBe("7");
  await expect(page.locator(".floor.on")).toBeInViewport();

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

test("phone: the top bar holds the site name, the source link, About, Search and the time side by side, down to a 360 px screen", async ({ page }) => {
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 780 });
    for (const query of ["?light=day", "?light=day&building=260"]) {
      await open(page, query);
      await expect(page.locator("#repo-link")).toBeVisible();
      const boxes = await page.locator(".topbar > *:not(.topbar-spacer)").evaluateAll((els) =>
        els
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0)
          .map((r) => ({ left: r.left, right: r.right, width: r.width })),
      );
      expect(boxes.length).toBe(5);
      expect(boxes[0]!.left).toBeGreaterThanOrEqual(0);
      expect(boxes.at(-1)!.right, `${width} px, ${query}`).toBeLessThanOrEqual(width);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.left, `${width} px, ${query}, item ${i}`).toBeGreaterThanOrEqual(boxes[i - 1]!.right);
      // Nothing is squeezed below a size a finger can hit.
      for (const b of boxes) expect(b.width).toBeGreaterThanOrEqual(36);
    }
  }
});

test("phone: the way to other worlds sits in the status strip, inside the screen, and starts a flight that can be called off", async ({ page }) => {
  // The other site is never called. Should the flight run its course, the page stays where it is.
  await page.route("https://tsinghua-world-model.pages.dev/**", (route) => route.abort());
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 780 });
    await open(page, "?light=day");
    const link = page.locator('#status-strip a[data-world="tsinghua"]');
    await expect(link).toBeVisible();
    const box = (await link.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${width} px`).toBeLessThanOrEqual(width);
    // The strip leaves the top bar and most of the map alone.
    const strip = (await page.locator("#status-strip").boundingBox())!;
    expect(strip.y, `${width} px`).toBeGreaterThan(780 * 0.6);
    expect(strip.x + strip.width).toBeLessThanOrEqual(width);
  }
  await shot(page, "13-mobile-worlds");

  await page.locator('#status-strip a[data-world="tsinghua"]').tap();
  const flight = page.getByRole("dialog", { name: "Travelling to Tsinghua World Model" });
  await expect(flight).toBeVisible();
  await expect(flight.locator(".travel-distance")).toHaveText(/^[\d,]+ km$/);
  await shot(page, "13-mobile-travel");
  await flight.getByRole("button", { name: "Stay in Auckland" }).tap();
  await expect(flight).toHaveCount(0);
  await expect(page.locator("#status-strip")).toBeVisible();
});
