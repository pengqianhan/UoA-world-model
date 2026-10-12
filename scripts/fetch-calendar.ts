// Snapshot the official University Calendar pages we transcribe by hand or parse:
//  - the key dates PDF (semester dates, breaks, holidays) -> data/academic-calendar.json (hand-checked)
//  - the "course codes by faculty" page -> subject list
import { snapshot } from "./lib/snapshot.ts";

const refresh = process.argv.includes("--refresh");
const base =
  "https://www.auckland.ac.nz/en/about-us/about-the-university/the-university/official-publications/university-calendar/current-calendar";
const assets =
  "https://www.auckland.ac.nz/assets/about-us/about-the-university/the-university/official-publications/university-calendar/current-calendar";

await snapshot({
  source: "uoa-calendar",
  file: "uoa-calendar/2026-key-dates.pdf",
  url: `${assets}/2026-calendar-parts/2026-calendar-key-dates.pdf`,
  refresh,
});
await snapshot({ source: "uoa-calendar", file: "uoa-calendar/courses.html", url: `${base}/courses.html`, refresh });
await snapshot({ source: "uoa-calendar", file: "uoa-calendar/key-university-dates.html", url: `${base}/key-university-dates.html`, refresh });
