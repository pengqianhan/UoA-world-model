// End-to-end checks of the acceptance criteria, numbered as in the project brief.
// They run against a local build by default and against the deployed site when E2E_BASE_URL is set.
import { expect, test } from "@playwright/test";
import { expectRealRender, open, params, settle, shot, withFixtureSchedule } from "./helpers.ts";

/** What the clocks in Auckland show right now, computed independently of the app. */
function aucklandNow(): { hhmm: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return { hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, minutes: h * 60 + m };
}

test("1. the City Campus renders in 3D with labelled buildings, and can be rotated and zoomed", async ({ page }) => {
  await open(page, "?light=day");
  await expect(page).toHaveTitle(/UoA World Model/);
  await expectRealRender(page);

  const labels = page.locator(".lbl-building.on");
  expect(await labels.count()).toBeGreaterThan(10);
  await expect(page.locator('[data-label="b:303"]')).toContainText("Science Centre");
  await expect(page.locator('[data-label="b:109"]')).toContainText("General Library");
  await shot(page, "01-campus-desktop");

  const before = await page.evaluate(() => window.__scene!.cameraState());
  const canvas = page.locator(".stage canvas");
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width * 0.55;
  const cy = box.y + box.height * 0.5;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy + 40, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => window.__scene!.cameraState());
  expect(Math.abs(after.azimuth - before.azimuth), "drag rotates").toBeGreaterThan(5);
  expect(after.zoom, "wheel zooms in").toBeGreaterThan(before.zoom * 1.1);
  await expectRealRender(page);
  await shot(page, "01-campus-rotated");
});

test("2. click a building, switch floors, pick a room, and see what is timetabled there", async ({ page }) => {
  await open(page, "?light=day");

  // Click the building itself in the 3D view, not a label.
  const pt = (await page.evaluate(() => window.__scene!.screenPoint("building", "303")))!;
  await page.mouse.click(pt.x, pt.y);
  await settle(page);
  await expect(page.locator("#building-bar")).toContainText("303");
  await expect(page.locator("#building-bar")).toContainText("Science Centre");
  expect(params(page).get("building")).toBe("303");
  await shot(page, "02-building");

  // Floors: the list shows every level; switching changes the rooms shown.
  await expect(page.locator(".floor")).toHaveCount(13);
  await page.locator('.floor[data-floor="1"]').click();
  await settle(page);
  expect(params(page).get("floor")).toBe("1");
  await expect(page.locator('[data-label="room:303-101"]')).toBeVisible();
  await page.locator('.floor[data-floor="G"]').click();
  await settle(page);
  await expect(page.locator('[data-label="room:303-G23"]')).toBeVisible();
  await shot(page, "02-floor");

  // Pick a room by clicking it in the model.
  const room = (await page.evaluate(() => window.__scene!.screenPoint("room", "303-G23")))!;
  await page.mouse.click(room.x, room.y);
  await settle(page);
  expect(params(page).get("room")).toBe("303-G23");
  const card = page.locator("#room-card");
  await expect(card).toContainText("303-G23");
  await expect(card).toContainText("Lecture Theatre");
  await expect(card.locator("#precision-note")).toContainText("official campus map");
  // The selected room keeps a visible, highlighted label.
  const selectedLabel = page.locator('[data-label="room:303-G23"]');
  await expect(selectedLabel).toHaveClass(/(^| )sel( |$)/);
  await expect(selectedLabel).toHaveClass(/(^| )on( |$)/);
  // The published site has no timetable snapshot: the room card must say so rather than show nothing.
  await expect(card.locator("#no-timetable")).toContainText("not available without signing in");
  await expectRealRender(page);
  await shot(page, "02-room");

  // The room selector offers the same rooms.
  await page.locator("#room-select").selectOption("303-G20");
  await settle(page);
  await expect(card).toContainText("303-G20");

  await page.getByRole("button", { name: "Campus", exact: true }).click();
  await settle(page);
  await expect(page.locator("#building-bar")).toHaveCount(0);
  expect(params(page).get("building")).toBeNull();
});

test("3. search finds real room codes, buildings and course codes, and moves the camera there", async ({ page }) => {
  await open(page, "?light=day");
  const home = await page.evaluate(() => window.__scene!.cameraState());

  await page.locator("#search-button").click();
  const input = page.locator("#search-input");
  await expect(input).toBeFocused();

  // Room code, typed loosely.
  await input.fill("303 g23");
  const first = page.locator(".result-main").first();
  await expect(first).toContainText("303-G23");
  await first.click();
  await settle(page);
  expect(params(page).get("room")).toBe("303-G23");
  expect(params(page).get("floor")).toBe("G");
  const atRoom = await page.evaluate(() => window.__scene!.cameraState());
  expect(atRoom.zoom, "camera zoomed in to the room").toBeGreaterThan(home.zoom * 3);
  await shot(page, "03-search-room");

  // Building by name.
  await page.locator("#search-button").click();
  await input.fill("general library");
  await expect(page.locator(".result-main").first()).toContainText("109");
  await shot(page, "03-search-results");
  await page.locator(".result-main").first().click();
  await settle(page);
  expect(params(page).get("building")).toBe("109");
  await expect(page.locator("#building-bar")).toContainText("General Library");

  // Māori names match with or without macrons.
  await page.locator("#search-button").click();
  await input.fill("te putahi tangata");
  await expect(page.locator(".result-main").first()).toContainText("Te Pūtahi Tangata");
  await input.fill("maori");
  await expect(page.locator(".results")).toContainText("Māori Studies");

  // A real course code: with no public timetable the site says so instead of guessing a room.
  await input.fill("COMPSCI 101");
  const subject = page.locator(".result.type-subject").first();
  await expect(subject).toContainText("COMPSCI 101");
  await expect(subject).toContainText("Computer Science");
  await expect(subject).toContainText("timetable is not public");

  // A room the campus map knows but whose outline is not published: found and pinned.
  await input.fill("104-G53");
  const marker = page.locator(".result.type-marker");
  await expect(marker).toContainText("104-G53");
  await expect(marker).toContainText("outline not shown");
  await marker.locator(".result-main").click();
  await settle(page);
  expect(params(page).get("building")).toBe("104");
  expect(params(page).get("room")).toBe("104-G53");
  await expect(page.locator('[data-label="pin"]')).toBeVisible();
  await expect(page.locator("#precision-note")).toContainText("outline not shown");
  await shot(page, "03-search-pin");

  // An unknown room in a known building falls back to an inferred floor, and says so.
  await page.locator("#search-button").click();
  await input.fill("303-977");
  await expect(page.locator(".result.type-marker")).toContainText("inferred from the room number");

  // Nonsense gives a helpful empty state.
  await input.fill("zzzzqqq");
  await expect(page.locator(".count")).toContainText("Nothing matches");
});

test("4. Now follows Auckland time; Preview takes any day and time; non-teaching periods are explained", async ({ page }) => {
  await open(page, "?light=day");
  const chip = page.locator(".chip");
  await expect(chip.locator(".chip-mode")).toHaveText("Now");
  const shown = (await chip.locator(".chip-time").textContent())!;
  const [h, m] = shown.split(":").map(Number);
  expect(Math.abs(h! * 60 + m! - aucklandNow().minutes) % 1439, "chip shows the Auckland clock").toBeLessThanOrEqual(1);

  await chip.click();
  const panel = page.locator(".time-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Preview" }).click();
  await expect(chip.locator(".chip-mode")).toHaveText("Preview");
  expect(params(page).get("time")).toBe("preview");
  // Preview starts on a teaching day.
  await expect(panel.locator(".status-line")).toContainText("teaching week");

  // Any date and time can be chosen.
  await panel.locator("#preview-date").fill("2026-08-12");
  await panel.locator("#preview-time").fill("14:05");
  await expect(panel.locator(".status-line")).toContainText("Semester Two 2026 · teaching week 4");
  await expect(panel.locator(".big-time b")).toHaveText("14:05");
  expect(params(page).get("date")).toBe("2026-08-12");
  expect(params(page).get("t")).toBe("14:05");
  // Weekday buttons move within the same week.
  await panel.getByRole("button", { name: "Fri", exact: true }).click();
  expect(params(page).get("date")).toBe("2026-08-14");

  // Outside teaching: a reason, not a blank.
  await panel.locator("#preview-date").fill("2026-09-02");
  await expect(panel.locator(".status-line")).toContainText("Mid-semester break");
  await expect(panel.locator(".hint.warn").first()).toContainText("Classes resume on");
  await panel.locator("#preview-date").fill("2026-10-26");
  await expect(panel.locator(".status-line")).toContainText("Labour Day");
  await panel.locator("#preview-date").fill("2026-11-03");
  await expect(panel.locator(".hint.warn").first()).toContainText("examination period");
  await shot(page, "04-time-exams");
  await panel.locator("#preview-teaching-day").click();
  await expect(panel.locator(".status-line")).toContainText("teaching week");

  // Back to Now.
  await panel.getByRole("button", { name: "Now" }).click();
  await expect(chip.locator(".chip-mode")).toHaveText("Now");
  expect(params(page).get("time")).toBeNull();
});

test("4b. Now mode outside teaching says why on the campus view", async ({ page }) => {
  // Freeze the clock inside the examination period: Tue 3 Nov 2026, 10:00 in Auckland.
  await page.clock.setFixedTime(new Date("2026-11-02T21:00:00Z"));
  await withFixtureSchedule(page);
  await open(page, "?light=day");
  await expect(page.locator(".chip-time")).toHaveText("10:00");
  const strip = page.locator("#status-strip");
  await expect(strip).toContainText("Semester Two 2026 · examinations");
  await expect(strip).toContainText("examination period");
  await strip.getByRole("button", { name: "Preview a teaching day" }).click();
  await expect(page.locator(".chip-mode")).toHaveText("Preview");
  await expect(strip).toContainText("teaching week");
});

test("5. a copied URL restores the same building, floor, room and time", async ({ page, context }) => {
  await open(page, "?building=260&floor=0&room=260-098&time=preview&date=2026-08-12&t=14:05&light=day");
  await expect(page.locator("#room-card")).toContainText("260-098");
  await expect(page.locator(".floor.on")).toHaveAttribute("data-floor", "0");
  await expect(page.locator(".chip-time")).toHaveText("14:05");
  const url = page.url();
  for (const [k, v] of Object.entries({ building: "260", floor: "0", room: "260-098", time: "preview", date: "2026-08-12", t: "14:05" })) {
    expect(new URL(url).searchParams.get(k), k).toBe(v);
  }

  const copy = await context.newPage();
  await copy.goto(url);
  await settle(copy);
  await expect(copy.locator("#building-bar")).toContainText("Sir Owen G Glenn Building");
  await expect(copy.locator(".floor.on")).toHaveAttribute("data-floor", "0");
  await expect(copy.locator("#room-card")).toContainText("260-098");
  await expect(copy.locator(".chip-mode")).toHaveText("Preview");
  await expect(copy.locator(".chip-time")).toHaveText("14:05");
  await expect(copy.locator('[data-label="room:260-098"]')).toHaveClass(/sel/);
  expect(copy.url()).toBe(url);
  const a = await page.evaluate(() => window.__scene!.cameraState());
  const b = await copy.evaluate(() => window.__scene!.cameraState());
  expect(Math.hypot(a.target[0] - b.target[0], a.target[2] - b.target[2])).toBeLessThan(2);
  await expectRealRender(copy);
});

test("7. About carries the unofficial notice, every source with link and snapshot date, attribution and limitations", async ({ page }) => {
  await open(page, "?light=day");
  await page.getByRole("button", { name: "About", exact: true }).click();
  const about = page.locator(".about-panel");
  await expect(about.locator("#unofficial-notice")).toContainText("not affiliated with");

  const sources = about.locator("#data-sources > li");
  expect(await sources.count()).toBeGreaterThanOrEqual(3);
  for (const li of await sources.all()) {
    await expect(li.locator("a")).toHaveAttribute("href", /^https:\/\//);
    await expect(li.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  }
  await expect(about.locator("#data-sources")).toContainText("OpenStreetMap");
  await expect(about.locator("#data-sources")).toContainText("maps.auckland.ac.nz");
  await expect(about.locator("#osm-attribution")).toContainText("© OpenStreetMap contributors");
  await expect(about.locator("#osm-attribution a")).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  await expect(about.locator("#limitations")).toContainText("No class times yet");
  await expect(about.locator("#limitations")).toContainText("not surveyed");
  await expect(about.locator("#coverage")).toContainText("Learning spaces with an outline");
  await shot(page, "07-about");

  // The short attribution is always on the map.
  await page.keyboard.press("Escape");
  await expect(about).toHaveCount(0);
  await expect(page.locator("#attribution")).toContainText("© OpenStreetMap");
});

test("8. ?lang= is honoured and unknown languages fall back to English", async ({ page }) => {
  await open(page, "?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await open(page, "?lang=zz");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".brand-name")).toHaveText("UoA World Model");
});

test("timetable features work end to end when a schedule is present (fixture schedule, never published)", async ({ page }) => {
  // Tuesday 13 Oct 2026, 10:15 in Auckland: the fixture has a class in 303-G23 from 10:00 to 11:00.
  await page.clock.setFixedTime(new Date("2026-10-12T21:15:00Z"));
  await withFixtureSchedule(page);
  await open(page, "?light=day");

  const strip = page.locator("#status-strip");
  await expect(strip).toContainText("Semester Two 2026 · teaching week 11");
  await expect(strip).toContainText("1 class scheduled at this time");
  await expect(page.locator('[data-label="b:303"] i')).toHaveText("1");

  // Course search lists the sessions; choosing one opens the room at a time when it runs.
  await page.locator("#search-button").click();
  await page.locator("#search-input").fill("TESTFIX 202");
  const course = page.locator(".result.type-course").first();
  await expect(course).toContainText("Fixture Course Two");
  await course.locator(".result-main").click();
  await expect(course.locator(".session")).toHaveCount(2);
  await course.locator(".session").first().click();
  await settle(page);
  expect(params(page).get("room")).toBe("303-G20");
  expect(params(page).get("t")).toBe("10:30");
  const card = page.locator("#room-card");
  await expect(card.locator(".class-row.live")).toContainText("TESTFIX 202");
  await expect(card).toContainText("timetabled, not whether people are actually in the room");
  await expect(page.locator('[data-label="room:303-G20"]')).toHaveClass(/busy/);
  await shot(page, "09-fixture-class");

  // Later the same day the other room has a tutorial; before it starts it is listed as upcoming.
  await page.locator("#room-select").selectOption("303-G23");
  await expect(card.locator(".class-row.live")).toContainText("TESTFIX 101");
  await expect(card).toContainText("Later that day");
  await expect(card.locator(".class-row").nth(1)).toContainText("14:00");

  // In the mid-semester break the same room shows the reason instead of a class.
  await page.locator(".chip").click();
  await page.locator("#preview-date").fill("2026-09-01");
  await expect(card.locator(".empty")).toContainText("Mid-semester break");
});
