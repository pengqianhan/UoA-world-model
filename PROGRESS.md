# PROGRESS

Handover notes for whoever (probably a future session of the same agent) picks this up next.
Read `GOAL.md` (local only, not committed) first, then this file, then `git status` / `git log`.

Last updated: 2026-10-13 (session 1)

## Now working on

Step 1 of GOAL §10: repo, remote, CI, GitHub Pages and a live placeholder page.

**Next concrete step:** data feasibility research (GOAL §5) — find public, no-login sources for
(a) the UoA class timetable with times and rooms, (b) building/room lists, (c) building footprints.
Save raw snapshots under `data/raw/` (gitignored) and record URL + date + sha256 in `data/sources.json`.

## Done (with evidence)

- Local toolchain: Vite 8 + TypeScript 7 + Preact 11 + three 0.186 + Vitest 5 + Playwright 1.64.
  `npm run typecheck`, `npm test`, `npm run build` all pass locally (2026-10-13).
- Cron job `17 */5 * * *` created in session 1 (id 233af833). It is session-only; re-check with
  CronList on every wake-up and recreate if missing or older than 6 days.

## Decisions (and why) — do not re-litigate without new information

- **GOAL.md is gitignored.** It contains the local working-directory path (with a username), and
  GOAL §8 forbids committing personal info from local paths. It stays in the working folder.
- **Stack: Vite + TypeScript + three.js + Preact (+ signals) for UI.** Static only, small runtime,
  matches the reference site's architecture (three.js + Vite). Data pipeline is Node/TS scripts run
  with `tsx`; unit tests with Vitest; e2e with Playwright.
- **Vite `base` is `/UoA-world-model/`** (override with `BASE_PATH`). Needed for GitHub Pages subpath.
- **Line endings:** `.gitattributes` forces LF; local `core.autocrlf=false`.

## Tried and did not work

(nothing yet)

## Needs the user

(nothing yet)
