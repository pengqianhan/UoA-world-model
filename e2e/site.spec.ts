// End-to-end checks of the acceptance criteria, numbered as in the project brief.
// They run against a local build by default and against the deployed site when E2E_BASE_URL is set.
import { expect, test } from "@playwright/test";
import { expectRealRender, open, openStrip, params, settle, shot, withFixtureSchedule } from "./helpers.ts";

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

  // A room the campus map knows but that is not named on the floor: found and pinned.
  await input.fill("104-G53");
  const marker = page.locator(".result.type-marker");
  await expect(marker).toContainText("104-G53");
  await expect(marker).toContainText("shown as a pin");
  await marker.locator(".result-main").click();
  await settle(page);
  expect(params(page).get("building")).toBe("104");
  expect(params(page).get("room")).toBe("104-G53");
  await expect(page.locator('[data-label="pin"]')).toBeVisible();
  // The pin stands on the room as the campus map draws it: that shape is outlined, and the card
  // gives its type.
  await page.waitForFunction(() => !!window.__scene!.pinOutline());
  const outlined = (await page.evaluate(() => window.__scene!.pinOutline()))!;
  await expect(page.locator("#precision-note")).toContainText("Position and outline from the official campus map");
  await expect(page.locator("#room-card .room-facts span").first()).toHaveAttribute("title", `Campus map type: ${outlined.text}`);
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
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
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
  await panel.getByRole("button", { name: "Now", exact: true }).click();
  await expect(chip.locator(".chip-mode")).toHaveText("Now");
  expect(params(page).get("time")).toBeNull();
});

test("4b. Now mode outside teaching says why on the campus view", async ({ page }) => {
  // Freeze the clock inside the examination period: Tue 3 Nov 2026, 10:00 in Auckland.
  await page.clock.setFixedTime(new Date("2026-11-02T21:00:00Z"));
  await withFixtureSchedule(page);
  await open(page, "?light=day");
  await expect(page.locator(".chip-time")).toHaveText("10:00");
  await openStrip(page);
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
  // The ground's heights, with the Crown copyright and licence its source asks for.
  await expect(about.locator("#data-sources")).toContainText("Land Information New Zealand");
  await expect(about.locator("#data-sources")).toContainText("CC BY 3.0 NZ");
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
  await expect(page.locator("#attribution")).toContainText("LINZ");
});

test("8. ?lang= is honoured and unknown languages fall back to English", async ({ page }) => {
  await open(page, "?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await open(page, "?lang=zz");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".brand-name")).toHaveText("UoA World Model");
});

test("the top bar links straight to the source code on GitHub, beside About", async ({ page }) => {
  await open(page, "?light=day");
  const link = page.locator(".topbar").getByRole("link", { name: "Source code on GitHub" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://github.com/pengqianhan/campus-world-model");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  // The mark is drawn, not an empty box.
  const markWidth = await link.locator("svg path").evaluate((el) => (el as SVGPathElement).getBBox().width);
  expect(markWidth).toBeGreaterThan(20);
  const here = (await link.boundingBox())!;
  const about = (await page.getByRole("button", { name: "About", exact: true }).boundingBox())!;
  expect(Math.abs(here.y - about.y)).toBeLessThan(2);
  expect(about.x - (here.x + here.width)).toBeGreaterThanOrEqual(0);
  expect(about.x - (here.x + here.width)).toBeLessThan(16);

  // It is still there inside a building.
  await open(page, "?light=day&building=260");
  await expect(link).toBeVisible();
});

test("the campus panel starts shut, as a small button with the campus's name, and opens and shuts from there or with Escape", async ({ page }) => {
  await open(page, "?light=day");
  const toggle = page.locator("#status-toggle");
  const strip = page.locator("#status-strip");
  await expect(toggle).toBeVisible();
  await expect(toggle).toContainText("City Campus");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(strip).toBeHidden();
  // Small, and in the corner the panel opens from, so the map has the screen.
  const box = (await toggle.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.width).toBeLessThan(220);
  expect(box.height).toBeLessThanOrEqual(44);
  expect(box.x).toBeLessThan(30);
  expect(view.height - (box.y + box.height)).toBeLessThan(30);
  await shot(page, "01-campus-panel-shut");

  await toggle.click();
  await expect(strip).toBeVisible();
  await expect(strip.locator(".status-term")).not.toBeEmpty();
  for (const part of [".campus-tabs", "#walk-start", 'a[data-world="tsinghua"]']) await expect(strip.locator(part)).toBeVisible();
  // Focus goes into the panel and back to its button, for whoever is using the keyboard.
  await expect(page.locator("#status-hide")).toBeFocused();
  await shot(page, "01-campus-panel-open");
  await page.locator("#status-hide").click();
  await expect(strip).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.press("Enter");
  await expect(strip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(strip).toBeHidden();
  await expect(toggle).toBeFocused();

  // Left open for a building: back on the campus it is shut again.
  await toggle.click();
  await expect(strip).toBeVisible();
  const pt = (await page.evaluate(() => window.__scene!.screenPoint("building", "303")))!;
  await page.mouse.click(pt.x, pt.y);
  await settle(page);
  expect(params(page).get("building")).toBe("303");
  await expect(toggle).toHaveCount(0);
  await page.locator(".btn.back").click();
  await settle(page);
  await expect(toggle).toBeVisible();
  await expect(strip).toBeHidden();
});

test("timetable features work end to end when a schedule is present (fixture schedule, never published)", async ({ page }) => {
  // Tuesday 13 Oct 2026, 10:15 in Auckland: the fixture has a class in 303-G23 from 10:00 to 11:00.
  await page.clock.setFixedTime(new Date("2026-10-12T21:15:00Z"));
  await withFixtureSchedule(page);
  await open(page, "?light=day");

  // Shut, the campus panel's button counts the classes timetabled now, as the building labels do.
  await expect(page.locator("#status-toggle .status-toggle-count")).toHaveText("1");
  await openStrip(page);
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

test("other campuses: Grafton and Newmarket beside the City Campus, and the campuses further away each in a place of their own", async ({ page }) => {
  await open(page, "?light=day");
  const city = await page.evaluate(() => window.__scene!.cameraState());

  await openStrip(page);
  await page.locator('.campus-tabs [data-campus="grafton"]').click();
  await settle(page);
  expect(params(page).get("campus")).toBe("grafton");
  // The panel shuts so that the campus can be seen, and its button names the campus now shown.
  await expect(page.locator("#status-strip")).toBeHidden();
  await expect(page.locator("#status-toggle")).toContainText("Grafton Campus");
  const grafton = await page.evaluate(() => window.__scene!.cameraState());
  // Grafton is about a kilometre south of the City Campus (south is +z in the scene).
  expect(grafton.target[2] - city.target[2]).toBeGreaterThan(600);
  await expectRealRender(page);
  await shot(page, "10-grafton");

  // A Grafton lecture theatre is drawn like any other room.
  await page.locator("#search-button").click();
  const input = page.locator("#search-input");
  await input.fill("505-011");
  await page.locator(".result-main").first().click();
  await settle(page);
  await expect(page.locator("#building-bar")).toContainText("Grafton Campus");
  await expect(page.locator("#room-card")).toContainText("505-011");

  // A campus far from the centre is chosen from the list, and the map goes there with its own
  // surroundings: Leigh is about 65 km north of the City Campus.
  await open(page, "?light=day");
  await openStrip(page);
  await page.locator("#campus-more").selectOption("leigh");
  await settle(page);
  expect(params(page).get("campus")).toBe("leigh");
  const leigh = await page.evaluate(() => window.__scene!.cameraState());
  expect(city.target[2] - leigh.target[2]).toBeGreaterThan(60_000);
  await expect(page.locator('[data-label="b:604"]')).toBeVisible();
  await expectRealRender(page);
  await shot(page, "10-leigh");

  // A room on a campus of its own is found, opened and drawn like any other.
  await page.locator("#search-button").click();
  await input.fill("654-G01");
  const room = page.locator(".result.type-room").first();
  await expect(room).toContainText("654-G01");
  await expect(room).not.toContainText("Not on the 3D map yet");
  await room.locator(".result-main").click();
  await settle(page);
  await expect(page.locator("#building-bar")).toContainText("Tai Tonga Campus");
  await expect(page.locator("#building-bar")).not.toContainText("outside the 3D map");
  await expect(page.locator("#room-card")).toContainText("654-G01");
  await expectRealRender(page);
  await shot(page, "10-tai-tonga-room");
});

test("a floor whose outline the campus map puts under another building is drawn over its own, and says so", async ({ page }) => {
  // In the source, floor 1 of building 114 carries the outline of a basement 300 m away.
  await open(page, "?building=114&floor=1&light=day");
  const centre = await page.evaluate(async () => {
    const campus = (await (await fetch("data/campus.json")).json()) as { buildings: { id: string; center: [number, number] }[] };
    return campus.buildings.find((b) => b.id === "114")!.center;
  });
  const cam = await page.evaluate(() => window.__scene!.cameraState());
  // Scene axes: x is east and z is south.
  expect(Math.hypot(cam.target[0] - centre[0], cam.target[2] + centre[1])).toBeLessThan(40);
  await expect(page.locator("#floor-outline-note")).toContainText("building's footprint");
  await expectRealRender(page);
  await shot(page, "11-floor-outline-footprint");
});

test("the rest of a floor is drawn as unnamed shapes that carry the campus map's type and cannot be selected, and floors where people live or children are cared for stay blank", async ({ page }) => {
  await open(page, "?building=405&floor=4&light=day");
  expect(await page.evaluate(() => window.__scene!.planShapes)).toBeGreaterThan(30);
  await expect(page.locator("#legend-spaces")).toContainText("by their type on the campus map");
  await expectRealRender(page);
  await shot(page, "12-floor-plan");

  // A click on one of the shapes selects nothing and leaves the building open; it says what the
  // campus map calls the space, in the map's own words.
  const pt = (await page.evaluate(() => window.__scene!.planPoint()))!;
  const type = (await page.evaluate(({ x, y }) => window.__scene!.spaceAt(x, y), pt))!;
  expect(type.text.length).toBeGreaterThan(0);
  await page.mouse.click(pt.x, pt.y);
  await settle(page);
  expect(params(page).get("room")).toBeNull();
  expect(params(page).get("building")).toBe("405");
  await expect(page.locator("#room-card")).toHaveCount(0);
  await expect(page.locator("#space-tip")).toContainText(`Campus map type: ${type.text}`);

  // A floor with no learning space at all still reads: offices, labs, toilets, stairs and lifts,
  // each group with a floor colour of its own and a line in the legend.
  await open(page, "?building=405&floor=8&light=day");
  await expect(page.locator("#building-bar")).toContainText("No learning spaces are listed on this floor");
  const floors = await page.evaluate(() => window.__scene!.spaceFloors());
  const kinds = floors.map((f) => f.kind);
  for (const k of ["office", "lab", "toilet", "stairs"]) expect(kinds).toContain(k);
  expect(new Set(floors.map((f) => f.colour)).size).toBe(floors.length);
  for (const label of ["Office", "Other lab", "Toilet or shower", "Stairs or lift"]) {
    await expect(page.locator("#legend-spaces")).toContainText(label);
  }
  // Stairs, lifts and toilets carry signs, which give way to room labels and pass the pointer on.
  await expect(page.locator(".lbl-sign.on").first()).toBeVisible();
  expect(await page.locator(".lbl-sign.sign-stairs.on, .lbl-sign.sign-lift.on").count()).toBeGreaterThan(1);
  expect(await page.locator(".lbl-sign.sign-toilet.on, .lbl-sign.sign-accessible.on").count()).toBeGreaterThan(0);
  await expect(page.locator(".lbl-sign.sign-lift").first()).toHaveAttribute("title", "Lift");
  const at = (await page.evaluate(() => window.__scene!.planPoint()))!;
  await page.mouse.move(at.x, at.y);
  await expect(page.locator("#space-tip")).toContainText("Campus map type:");
  await shot(page, "12-floor-types");
  await page.mouse.move(5, 300);
  await expect(page.locator("#space-tip")).toHaveCount(0);

  // A hall of residence: the floor is there, its rooms are not, and the page says why.
  await open(page, "?building=440&floor=3&light=day");
  expect(await page.evaluate(() => window.__scene!.planShapes)).toBe(0);
  await expect(page.locator("#floor-no-plan-note")).toContainText("People live on this floor");
  await shot(page, "12-floor-residential");

  // A childcare centre likewise.
  await open(page, "?building=410&light=day");
  expect(await page.evaluate(() => window.__scene!.planShapes)).toBe(0);
  await expect(page.locator("#floor-no-plan-note")).toContainText("childcare centre");
});

test("a floor the campus map leaves bare, or nearly bare, is marked in the floor list and explained", async ({ page }) => {
  // O'Rorke Hall: the source maps the building and its floors, and no rooms on floors 2 to 13.
  await open(page, "?building=614&floor=5&light=day");
  expect(await page.evaluate(() => window.__scene!.planShapes)).toBe(0);
  await expect(page.locator("#floor-no-plan-note")).toContainText("The campus map has no rooms on this floor");
  await expect(page.locator('.floor[data-floor="5"] .floor-mark.blank')).toHaveCount(1);
  await expect(page.locator("#floors-legend")).toContainText("Not drawn");
  await expectRealRender(page);
  await shot(page, "14-floor-unmapped");

  // George Mason Biology Building, floor 2: the labs are on the mezzanines; the map draws stairs
  // and little else here.
  await open(page, "?building=106&floor=2&light=day");
  expect(await page.evaluate(() => window.__scene!.planShapes)).toBeGreaterThan(0);
  await expect(page.locator("#floor-partial-note")).toContainText("only a few spaces on this floor");
  await expect(page.locator('.floor[data-floor="2"] .floor-mark.partial')).toHaveCount(1);
  await expect(page.locator('.floor[data-floor="M2"] .floor-mark')).toHaveCount(0);
  await expect(page.locator("#floors-legend")).toContainText("Partly mapped");
  await shot(page, "14-floor-partial");

  // A floor drawn in full carries no mark and no note.
  await open(page, "?building=405&floor=4&light=day");
  await expect(page.locator("#floor-partial-note")).toHaveCount(0);
  await expect(page.locator("#floor-no-plan-note")).toHaveCount(0);
});

test("rooms on the open floor stand as walls on their outlines, the named ones round a floor in their colour", async ({ page }) => {
  await open(page, "?building=303&floor=G&light=day");
  const walls = await page.evaluate(() => window.__scene!.floorWalls());
  // Every edge of every unnamed shape is walled, and the learning spaces are open rooms, not blocks.
  expect(walls.planWallFaces).toBeGreaterThan(300);
  expect(walls.rooms).toBe(12);
  expect(walls.walledRooms).toBeGreaterThanOrEqual(10);
  await expectRealRender(page);

  // A room is still picked by a click inside its walls.
  const pt = (await page.evaluate(() => window.__scene!.screenPoint("room", "303-G20")))!;
  await page.mouse.click(pt.x, pt.y);
  await settle(page);
  expect(params(page).get("room")).toBe("303-G20");
  await shot(page, "15-floor-walls");
});

test("an open building fills the screen beside the panels, keeps its windows below the cut and its outer walls on the open floor", async ({ page }) => {
  await open(page, "?building=106&floor=M1&light=day");
  const walls = await page.evaluate(() => window.__scene!.floorWalls());
  expect(walls.outerWalls).toBe(true);
  expect(walls.windowsBelow).toBe(true);

  // The open floor takes up a good part of the width, and none of it is under the floor list.
  const box = (await page.evaluate(() => window.__scene!.openFloorBox()))!;
  const view = page.viewportSize()!;
  expect(box.right - box.left).toBeGreaterThan(view.width * 0.45);
  expect(box.top).toBeGreaterThan(0);
  expect(box.bottom).toBeLessThan(view.height);
  const list = (await page.locator(".floors").boundingBox())!;
  expect(box.right).toBeLessThan(list.x);
  await expectRealRender(page);
  await shot(page, "16-building-facade");
});

test("a building opens on the floor at street level, and the floors under the ground lie below it, seen through the ground", async ({ page }) => {
  // The HIWA Recreation Centre has two floors under its floor 0; its one learning space is on B2.
  await open(page, "?building=310&light=day&time=preview&date=2026-03-20&t=12:00");
  await expect(page.locator(".floor.on")).toHaveAttribute("data-floor", "0");
  // In the floor list the ground runs under floor 0, over B2 and B1.
  await expect(page.locator(".floors-ground")).toHaveCount(1);
  await expect(page.locator(".floors-ground + li .floor")).toHaveAttribute("data-floor", "0");
  await expect(page.locator('.floor[data-floor="B2"]')).toHaveAttribute("title", /below ground/);
  await page.waitForFunction(() => window.__scene!.groundState(0, 0).terrain && !window.__scene!.animating);
  const { base } = await page.evaluate(() => window.__scene!.groundState(0, 0, "310"));
  // Floor 0 is framed on the ground the building stands on, not lifted by the floors under it.
  expect((await page.evaluate(() => window.__scene!.cameraState())).target[1]).toBeCloseTo(base!, 1);
  await expectRealRender(page);
  await shot(page, "19-street-level");

  await page.locator('.floor[data-floor="B2"]').click();
  await page.waitForFunction(() => !window.__scene!.animating);
  expect((await page.evaluate(() => window.__scene!.cameraState())).target[1]).toBeCloseTo(base! - 3.6, 1);
  await expect(page.locator('[data-label^="room:310-"]').first()).toBeVisible();
  await expectRealRender(page);
  await shot(page, "19-below-ground");
});
