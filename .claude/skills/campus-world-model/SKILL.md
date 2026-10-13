---
name: campus-world-model
description: "Port this 3D campus world model to another university: recon its public data, rebuild the data pipeline, ship and verify live. Use to start a port for a new school, or to resume one recorded in PROGRESS.md."
argument-hint: "[university, campus]"
---

# Port the campus world model

This repo is a working world model of one university: a static site that draws the campus in 3D and
answers two questions a student has, "which building and floor is my room in" and "what is timetabled
in this room now". A **port** makes it another school's.

The **contract** is `src/shared/types.ts`, the shape of every file under `public/data/`. Everything
downstream of it carries over: scene, interface, URL state, tests. Everything upstream is rebuilt for
the new school: sources, `scripts/fetch-*.ts`, `scripts/build-data.ts`. What the school publishes
without a login decides how much of the contract can be filled, so recon comes before code.

## Rules of a port

The "Rules" section of [AGENTS.md](../../../AGENTS.md) binds a port as it binds this site; read it
before recon. Two of the rules carry more in a port:

- **Real or absent.** A layer with no public source ships absent, and `schedule.available: false`
  already drives the notes that say so.
- **Closed is a verdict.** Recon looks at a route once. Whatever needs a login, a credential, a
  payment, or a message to the school or to anyone else goes under "Needs the user" in the handover,
  and the port continues with the rest.

## Handover

`PROGRESS.md` is the handover, written for a reader who remembers nothing, because the next session
will be that reader. Keep its headings and replace Auckland's content. It always shows the piece in
progress with its exact next step, what is done with its evidence, decisions with their reasons,
routes that were tried and failed, and "Needs the user".

Write the plan for a piece before starting it and the result after. Commit and push each verified
piece straight to `main`: an interrupted session keeps only what was pushed, and a port has no
reviewer to wait for, so "How a change lands" in AGENTS.md starts to apply once the port is live.

A choice that comes up mid-port is yours. Take the option that keeps the site real and live, record
it under Decisions, continue.

If the brief says the person will be away, schedule a recurring wake-up that invokes this skill to
resume from `PROGRESS.md`, and delete it after the final report.

## Steps

1. **Brief.** Write the brief at the top of `PROGRESS.md`: the school; which campuses go in 3D; the
   time zone; the site's name; the repository to create (public, which free GitHub Pages requires) and
   its public URL; the interface languages; whether the person stays reachable. Take each from the
   invocation, look up what can be looked up, ask once for the rest.
   Done when every field has a value.

2. **Recon.** Follow [RECON.md](RECON.md).
   Done when all five layers have a verdict in `PROGRESS.md`: a usable one names the requests that
   return its data, and any other is backed by every route RECON.md lists for that layer, each
   recorded with its URL and what came back.

3. **Pipeline.** Rebuild everything upstream of the contract along the data seams in
   [SEAMS.md](SEAMS.md): one fetch script per usable source, then `scripts/build-data.ts`.
   Done when `npm run data:fetch && npm run data:build` writes every file of the contract from the
   new school's snapshots; with a usable timetable, every class meeting in the snapshot is a session
   with a precision or an exclusion with a reason, and the two counts add up to the meetings in the
   snapshot; `npm run typecheck && npm test` pass with every assertion that names an Auckland place
   or count rewritten from the new data (SEAMS.md, "Tests"); and the coverage block of
   `public/data/meta.json` is copied into `PROGRESS.md`.

4. **Identity.** Make the repo the new school's along the identity seams in [SEAMS.md](SEAMS.md).
   Done when `git grep -il -e auckland -e uoa -- . ':!.claude'` lists only `README.md`, for its
   credit line, and a screenshot of the local site, opened and read, shows the new campus in 3D
   under the new name.

5. **Live.** Create the repository named in the brief (`gh repo create`), turn on Pages with the
   workflow as its source (`gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`; a fork
   needs Actions enabled first), and push `main`. From here every push improves a site that is
   already public.
   Done when the CI run is green and a screenshot of the public URL, opened and read, shows the
   campus.

6. **Acceptance.** The numbered tests in `e2e/` are the acceptance criteria; each title says what it
   proves. Re-point them at real places of this school (SEAMS.md, "Tests"), keeping the numbers and
   what each proves. With the timetable absent, tests 2 and 3 prove rooms and buildings and the
   fixture test proves the class display. A test without a number proves one behaviour on one real
   place; re-point those the same way.
   Done when every test passes three ways: on the local build, in CI, and with
   `E2E_BASE_URL=<public URL> npm run e2e`; and you have opened the desktop and phone screenshots
   taken from the public URL. A green run over a black canvas is a failure.

7. **Report.** Rewrite `README.md` for the new school (what it is, sources and licences, limitations,
   how to add an absent layer) and retake `docs/*.jpg` from the public URL. Then give the final
   report, as the last message and under "Final report" in `PROGRESS.md`, leading with what was not
   achieved: public URL and repository; each acceptance criterion as met, partly met or not met, with
   its evidence; coverage numbers and snapshot dates from `meta.json`; each absent layer with the
   routes tried; "Needs the user".
   Done when every numbered criterion has a status and its evidence, and every absent layer names
   what would fill it: what the person would have to obtain and from whom, or that nothing is
   published.
