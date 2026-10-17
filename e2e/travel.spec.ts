// The way to another university's campus map: the link, the flight through space, and the ways out of it.
// The other site is never called: a stand-in answers in its place.
import { expect, test, type Page } from "@playwright/test";
import { open, openStrip, settle, shot } from "./helpers.ts";

const TSINGHUA = "https://tsinghua-world-model.pages.dev/?campus=1&classMode=live";
const HOST = "https://tsinghua-world-model.pages.dev/**";

/** What the page was showing at the moment the browser set off for somewhere else. */
interface Departure {
  flight: { role: string | null; name: string | null; from: string; to: string; place: string; distance: string } | null;
  /** Strokes drawn on the flight's canvas up to then: one for a star in a frame. */
  stars: number;
}

/**
 * Answers for the other site, at once or only when `release` is called.
 * Playwright holds every look at a page back while that page is on its way elsewhere, so the page
 * reports for itself: on leaving, it sends what it was showing.
 */
async function standIn(page: Page, hold = false) {
  let release = () => {};
  const held = hold ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
  const seen = { requests: 0, release, departures: [] as Departure[] };
  await page.exposeFunction("__departing", (d: Departure) => void seen.departures.push(d));
  await page.addInitScript(() => {
    // Counted as they are drawn. Reading the canvas back on leaving would hold the departure up on a slow renderer.
    let stars = 0;
    const stroke = CanvasRenderingContext2D.prototype.stroke as (this: CanvasRenderingContext2D, ...a: unknown[]) => void;
    (CanvasRenderingContext2D.prototype as unknown as { stroke: typeof stroke }).stroke = function (...a) {
      if (this.canvas.closest("#travel")) stars++;
      return stroke.apply(this, a);
    };
    window.addEventListener("beforeunload", () => {
      const el = document.querySelector("#travel");
      const text = (selector: string) => el?.querySelector(selector)?.textContent ?? "";
      const flight = el && {
        role: el.getAttribute("role"),
        name: el.getAttribute("aria-label"),
        from: text(".travel-from"),
        to: text(".travel-to"),
        place: text(".travel-place"),
        distance: text(".travel-distance"),
      };
      (window as unknown as { __departing(d: unknown): void }).__departing({ flight, stars });
    });
  });
  await page.route(HOST, async (route) => {
    seen.requests++;
    await held;
    // A journey called off after departure leaves nothing to answer.
    await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stand-in</title><p>A stand-in for the other site.</p>" }).catch(() => {});
  });
  return seen;
}

const worldLink = (page: Page) => page.locator('#status-strip a[data-world="tsinghua"]');
const flightOf = (page: Page) => page.getByRole("dialog", { name: "Travelling to Tsinghua World Model" });

test("the campus view offers the Tsinghua World Model as another world; following it plays a flight through space and then leaves for that site", async ({ page }) => {
  const other = await standIn(page);
  await open(page, "?light=day");
  // Offered in the campus panel, which starts shut.
  await openStrip(page);
  const link = worldLink(page);
  await expect(link).toHaveText("Tsinghua World Model");
  await expect(link).toHaveAttribute("href", TSINGHUA);
  await expect(page.locator("#status-strip")).toContainText("Other worlds");

  // No picture is taken mid-flight: a screenshot that is still being made when the browser sets off never returns.
  await link.click();
  await page.waitForURL(TSINGHUA);
  expect(other.requests).toBe(1);

  // When the browser set off, the flight was on screen, the stars were out and the whole distance was counted.
  const left = other.departures[0]!;
  expect(left.flight).toEqual({
    role: "dialog",
    name: "Travelling to Tsinghua World Model",
    from: "Leaving Auckland",
    to: "Tsinghua World Model",
    place: "Tsinghua University, Beijing",
    distance: expect.stringMatching(/^10,4\d0 km$/),
  });
  expect(left.stars, "strokes on the star canvas").toBeGreaterThan(400);

  // Back again: the campus, not a flight frozen in mid-air.
  await page.goBack();
  await settle(page);
  await expect(page.locator("#travel")).toHaveCount(0);
  await expect(page.locator(".app")).not.toHaveClass(/travelling/);
  await openStrip(page);
  await expect(link).toBeVisible();
});

test("a flight can be called off: with Escape, with Stay in Auckland, and even after the browser has been sent on its way", async ({ page }) => {
  const other = await standIn(page, true);
  await open(page, "?light=day");
  await openStrip(page);
  const link = worldLink(page);
  const flight = flightOf(page);

  await link.click();
  await expect(flight).toBeVisible();
  await expect(flight).toContainText("Leaving Auckland");
  await page.keyboard.press("Escape");
  await expect(flight).toHaveCount(0);
  await expect(page.locator(".app")).not.toHaveClass(/travelling/);
  await expect(link).toBeFocused();

  await link.click();
  await flight.getByRole("button", { name: "Stay in Auckland" }).click();
  await expect(flight).toHaveCount(0);
  // Long enough for a flight to have finished, had it not been called off.
  await page.waitForTimeout(2600);
  expect(other.requests).toBe(0);

  // A browser that keeps the page as it was left hands it back mid-flight on Back; the flight is cleared then.
  // (The test browser reloads on Back instead, so the event is sent by hand.)
  await link.click();
  await expect(flight).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(flight).toHaveCount(0);
  await page.waitForTimeout(2600);
  expect(other.requests).toBe(0);

  // After departure, while the other site has not answered yet.
  await link.click();
  await expect.poll(() => other.requests).toBe(1);
  await page.keyboard.press("Escape");
  await expect(flight).toHaveCount(0);
  other.release();
  await page.waitForTimeout(800);
  expect(new URL(page.url()).hostname).not.toContain("tsinghua");
  await expect(page.locator("#status-strip")).toBeVisible();
});

test("a visitor who asked for less motion gets a plain link, with no flight", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const other = await standIn(page);
  await open(page, "?light=day");
  await openStrip(page);
  await worldLink(page).click();
  await page.waitForURL(TSINGHUA);
  expect(other.requests).toBe(1);
  expect(other.departures[0]).toEqual({ flight: null, stars: 0 });
});

test("About names the Tsinghua World Model as the inspiration and offers the same way there", async ({ page }) => {
  // The other site is never called. The flight is called off long before it would be.
  await page.route(HOST, (route) => route.abort());
  await open(page, "?light=day");
  await page.getByRole("button", { name: "About", exact: true }).click();
  const about = page.locator(".about-panel");
  await expect(about.locator("#inspiration")).toContainText("inspired by the Tsinghua World Model");
  await expect(about.locator("#inspiration")).toContainText("made separately");
  const link = about.locator('a[data-world="tsinghua"]');
  await expect(link).toHaveAttribute("href", TSINGHUA);
  await link.scrollIntoViewIfNeeded();
  await shot(page, "13-about-inspiration");

  await link.click();
  await expect(flightOf(page)).toBeVisible();
  // The first Escape calls the flight off and leaves About open; the second closes About.
  await page.keyboard.press("Escape");
  await expect(flightOf(page)).toHaveCount(0);
  await expect(about).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(about).toHaveCount(0);
});
