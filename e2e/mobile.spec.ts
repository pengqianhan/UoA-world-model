// Criterion 6: on a 390 px wide phone the campus is visible and search leads to building and room details.
import { expect, test, type Page } from "@playwright/test";
import { expectRealRender, open, openStrip, params, settle, shot } from "./helpers.ts";

test("6. phone: search for a room and see the building and class information", async ({ page }) => {
  await open(page, "?light=day");
  expect(page.viewportSize()?.width).toBe(390);
  await expectRealRender(page);
  // Nothing may overflow the viewport horizontally.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator(".brand-name")).toBeVisible();
  // The campus panel waits as a button, so the campus has the screen.
  await expect(page.locator("#status-toggle")).toBeVisible();
  await expect(page.locator("#status-strip")).toBeHidden();
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
  // The open floor fills most of the phone's width, between the floor strip and the building bar.
  const box = (await page.evaluate(() => window.__scene!.openFloorBox()))!;
  expect(box.right - box.left).toBeGreaterThan(390 * 0.6);
  const strip = (await page.locator(".floors").boundingBox())!;
  const dock = (await bar.boundingBox())!;
  expect(box.top).toBeGreaterThan(strip.y + strip.height - 10);
  expect(box.bottom).toBeLessThan(dock.y + 10);
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

test("phone: a tap on an unnamed space says its type on the campus map, inside the screen, and selects nothing", async ({ page }) => {
  await open(page, "?building=405&floor=8&light=day");
  const pt = (await page.evaluate(() => window.__scene!.planPoint()))!;
  const type = (await page.evaluate(({ x, y }) => window.__scene!.spaceAt(x, y), pt))!;
  await page.touchscreen.tap(pt.x, pt.y);
  const tip = page.locator("#space-tip");
  await expect(tip).toContainText(`Campus map type: ${type.text}`);
  await expect(tip).toBeInViewport({ ratio: 1 });
  expect(params(page).get("room")).toBeNull();
  expect(params(page).get("building")).toBe("405");
  await shot(page, "06-mobile-space");
  // Another floor takes the tip away with the shapes.
  await page.locator('.floor[data-floor="7"]').tap();
  await settle(page);
  await expect(tip).toHaveCount(0);
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
  // The other site is never called. The flight is called off long before it would be.
  await page.route("https://tsinghua-world-model.pages.dev/**", (route) => route.abort());
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 780 });
    await open(page, "?light=day");
    await openStrip(page);
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
  await flight.getByRole("button", { name: "Stay in Auckland" }).tap();
  await expect(flight).toHaveCount(0);
  await expect(page.locator("#status-strip")).toBeVisible();
});

/**
 * Fingers on the screen through the browser itself, so that two can be down at once, as two thumbs
 * are. The browser lifts them all together: it has no way to lift one and leave the other down.
 */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const down = new Map<number, { x: number; y: number }>();
  const send = (type: "touchStart" | "touchMove" | "touchEnd") =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [...down].map(([id, p]) => ({ id, ...p })) });
  return {
    async down(id: number, x: number, y: number) {
      down.set(id, { x, y });
      await send("touchStart");
    },
    async move(id: number, x: number, y: number, steps = 1) {
      const from = down.get(id)!;
      for (let i = 1; i <= steps; i++) {
        down.set(id, { x: from.x + ((x - from.x) * i) / steps, y: from.y + ((y - from.y) * i) / steps });
        await send("touchMove");
        await page.waitForTimeout(30);
      }
    },
    async lift() {
      down.clear();
      await send("touchEnd");
    },
  };
}

async function walkerAt(page: Page): Promise<[number, number]> {
  const r = (await page.evaluate(() => window.__walker!.run("list"))) as { walkers: { at: [number, number] }[] };
  return r.walkers[0]!.at;
}

/** A look's turn from straight ahead, -180 to 180 degrees. */
const offAhead = (yaw: number) => ((((yaw + 180) % 360) + 360) % 360) - 180;

test("phone: a walk is steered with two thumbs, as in a game: a stick walks and turns the walker while the other thumb drags the view round", async ({ page }) => {
  await open(page, "?light=day&time=preview&date=2026-03-20&t=15:00");
  await openStrip(page);
  await page.locator("#walk-start").click();
  await page.waitForFunction(() => window.__walker?.ready(), undefined, { timeout: 30_000 });
  const panel = page.locator("#walker-panel");
  await expect(panel).toBeVisible();
  // On a touch screen the walk starts from behind the walker.
  await expect(panel.locator('button[data-view="follow"]')).toHaveAttribute("aria-pressed", "true");
  // A bar under the top bar takes a slice of the screen; the rest of the panel waits behind a button.
  const bar = (await panel.boundingBox())!;
  const top = (await page.locator(".topbar").boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(0);
  expect(bar.x + bar.width).toBeLessThanOrEqual(390);
  expect(bar.y).toBeGreaterThanOrEqual(top.y + top.height);
  expect(bar.height).toBeLessThan(844 * 0.13);
  await expect(page.locator("#walker-to")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // The stick in the bottom left corner, for the left thumb, above the attribution.
  const stick = (await page.locator("#walker-stick").boundingBox())!;
  expect(stick.x).toBeLessThan(24);
  expect(stick.y).toBeGreaterThan(844 * 0.7);
  expect(stick.y + stick.height).toBeLessThan(844 - 20);

  // Two thumbs at once: the left pushes the stick forward while the right drags the view round.
  const touch = await fingers(page);
  const from = await walkerAt(page);
  const sx = stick.x + stick.width / 2;
  const sy = stick.y + stick.height / 2;
  await touch.down(1, sx, sy);
  await touch.move(1, sx, sy - stick.height / 2, 4);
  await page.waitForTimeout(400);
  await touch.down(2, 300, 450);
  await touch.move(2, 180, 450, 6);
  await page.waitForTimeout(200);
  const turned = offAhead((await page.evaluate(() => window.__scene!.walkerLook())).yaw);
  expect(Math.abs(turned), "the right thumb turned the view").toBeGreaterThan(15);
  const mid = await walkerAt(page);
  expect(Math.hypot(mid[0] - from[0], mid[1] - from[1]), "the left thumb walked it meanwhile").toBeGreaterThan(1);
  await touch.lift();
  // Walked on again, the view comes back round behind the walker, as in a game.
  await touch.down(1, sx, sy);
  await touch.move(1, sx, sy - stick.height / 2, 4);
  await page.waitForTimeout(1500);
  const settled = offAhead((await page.evaluate(() => window.__scene!.walkerLook())).yaw);
  await touch.lift();
  expect(Math.abs(settled)).toBeLessThan(Math.abs(turned) * 0.7);
  await expectRealRender(page);
  await shot(page, "20-walker-phone");

  // Pushed to the side, the stick turns the walker on the spot.
  const heading = async () => ((await page.evaluate(() => window.__walker!.run("list"))) as { walkers: { heading: number }[] }).walkers[0]!.heading;
  const before = await heading();
  await touch.down(1, sx, sy);
  await touch.move(1, sx + stick.width / 2, sy, 3);
  await page.waitForTimeout(700);
  await touch.lift();
  expect(offAhead((await heading()) - before)).toBeGreaterThan(20);

  // The rest waits behind its button: a walk to a place, wandering, and how to steer.
  await page.locator("#walker-more").tap();
  await expect(page.locator("#walker-to")).toBeVisible();
  await expect(page.locator("#walker-menu")).toContainText("Push the stick");
  await shot(page, "20-walker-phone-menu");
  await page.locator("#walker-more").tap();
  await expect(page.locator("#walker-to")).toBeHidden();

  // Beside a building, the way in is under the right thumb.
  expect(((await page.evaluate(() => window.__walker!.run("walk", { to: "109", speed: 40 }))) as { arrived: boolean }).arrived).toBe(true);
  const enter = page.locator("#walker-enter");
  await expect(enter).toBeVisible();
  const e = (await enter.boundingBox())!;
  expect(e.x + e.width).toBeGreaterThan(390 - 30);
  expect(e.y).toBeGreaterThan(844 * 0.7);
  await enter.tap();
  await expect.poll(() => params(page).get("building")).toBe("109");
  await settle(page);
  // Inside, the floor strip stays in sight above the bar, and the thumbs' controls stand above the building's card.
  const floors = (await page.locator(".floors").boundingBox())!;
  expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(floors.y + floors.height);
  const dock = (await page.locator("#building-bar").boundingBox())!;
  const lifted = (await page.locator("#walker-stick").boundingBox())!;
  expect(lifted.y + lifted.height).toBeLessThanOrEqual(dock.y);
  for (const id of ["#walker-up", "#walker-down", "#walker-exit"]) {
    const b = (await page.locator(id).boundingBox())!;
    expect(b.y + b.height, id).toBeLessThanOrEqual(dock.y);
  }
  await expectRealRender(page);
  await shot(page, "20-walker-phone-inside");
});

test("phone on its side: the map keeps the screen, and a walk puts the stick under the left thumb, clear of the bar", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await open(page, "?light=day&time=preview&date=2026-03-20&t=15:00");
  await expect(page.locator("#status-strip")).toBeHidden();
  const toggle = (await page.locator("#status-toggle").boundingBox())!;
  expect(toggle.height).toBeLessThanOrEqual(44);
  expect(toggle.y + toggle.height).toBeGreaterThan(390 - 30);
  await shot(page, "06-mobile-landscape");

  await openStrip(page);
  await page.locator("#walk-start").click();
  await page.waitForFunction(() => window.__walker?.ready(), undefined, { timeout: 30_000 });
  const panel = page.locator("#walker-panel");
  await expect(panel).toHaveClass(/touch/);
  const bar = (await panel.boundingBox())!;
  const stick = (await page.locator("#walker-stick").boundingBox())!;
  expect(bar.width).toBeLessThanOrEqual(440);
  expect(bar.y + bar.height).toBeLessThan(stick.y);
  expect(stick.x).toBeLessThan(30);
  expect(stick.y + stick.height).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);

  const touch = await fingers(page);
  const from = await walkerAt(page);
  const sx = stick.x + stick.width / 2;
  const sy = stick.y + stick.height / 2;
  await touch.down(1, sx, sy);
  await touch.move(1, sx, sy - stick.height / 2, 3);
  await page.waitForTimeout(900);
  await touch.lift();
  const to = await walkerAt(page);
  expect(Math.hypot(to[0] - from[0], to[1] - from[1])).toBeGreaterThan(1);
  await expectRealRender(page);
  await shot(page, "20-walker-phone-landscape");
});
