# Standards for a change

The checks a change passes before it merges. Write to them and review against them. The pull
request gives each check with its result and the commit it was run on.

## Reports

**Reproduce the reporter's case before changing anything.** Open the link they gave, on the kind of
screen they used, and see what they saw. The address holds the building, floor, room, time and
language, so the same link shows the same view. A report without a link gets a request for one.

A report that the map is wrong is a claim about the campus. Find what it contradicts: the snapshot,
or what the pipeline made of the snapshot. A pipeline fault is fixed in the pipeline. A fault in the
source stays an open issue labelled `source-data`: the pipeline cannot yet override a source, and a
hand edit to `public/data/` disappears at the next build.

The report is answered when the reporter's own link shows the right thing on the public site.

## Checks

1. **Red check.** A bug fix comes with a test that fails on the old code. Put the old code back,
   run the test and watch it fail on the behaviour that was reported. A compile error or a skipped
   test is not a red check.
2. **Siblings.** A fault found in one building, room code, campus or screen size is looked for in
   the others, and the change says how many places or records it touched.
3. **Data through the pipeline.** A change to `public/data/` comes from `npm run data:build`. Give
   the `coverage` block of `public/data/meta.json` before and after, and account for every count
   that fell. Only the maintainer holds the campus map's snapshots: a contributor's change that
   needs a rebuild says so in its first line, leaves `public/data/` alone, and the maintainer
   rebuilds it and gives the counts.
4. **Real use.** Look at the built site. `npm run e2e` saves screenshots to `e2e/screenshots/`; open
   the ones the change affects, desktop and phone. A green run over a black canvas is a failure.
5. **Green on the commit.** `npm run typecheck`, `npm test` and `npm run e2e` pass, and the CI run
   for the exact commit being merged finished green. A cancelled or superseded run is not green.
6. **Changelog.** A change to what the site does or shows adds its line to `CHANGELOG.md`, under the
   day's date in New Zealand time and with its pull-request number, and says it in a few words in
   the README's "What's new", which keeps the three latest days. A change only to documents, tests
   or the pipeline's insides may add a line but need not.
7. **How it was made.** The pull request names what wrote the change: the model, as the tool names
   it; the harness that ran it, with its version; and the thinking effort it was set to, in that
   tool's words. Where one changed during the work, or a helper ran on another model, each gets a
   line saying what it did. A change written by hand says `none`. Whoever started the work fills
   these in. An agent cannot always see its own effort (a level given at launch is saved nowhere),
   and it leaves that to them rather than guess. What cannot be known is written `not known`, with
   the reason. CI checks that the three are given (`scripts/check-pr-form.ts`), and `main` takes no
   pull request without that check passing. It cannot check that they are true.
8. **Not run.** A check that was not run is listed as not run, with the reason.

The numbered tests in `e2e/` are the product's acceptance criteria. Each keeps its number and what
it proves; behaviour that is new gets a test of its own.
