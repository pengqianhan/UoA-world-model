# Contributing

This is an unofficial, student-made project. Reports and fixes are welcome.

## Report a problem

Open an issue with the form that fits, and paste the address from your browser's address bar into
it. The address records the building, floor, room, time and language, so the link shows exactly
what you saw.

If something on the map does not match the real campus, say what is right and how you know: you
were in the room, there is a sign on the door, or a page on the university's website says so.

## Propose a change

Open a pull request against `main`. Its form asks how the change was checked; the checks are in
[docs/standards.md](docs/standards.md). The maintainer merges, and a merge goes live within minutes.
A change to what the site does or shows also adds a line to [CHANGELOG.md](CHANGELOG.md) and to
"What's new" in the README. The line carries the pull request's number, so open the pull request
first and add the line after.

The data the site shows is rebuilt by the maintainer, who holds the snapshots of the campus map; a
fresh clone cannot rebuild it. If your change needs `public/data/` rebuilt, change the pipeline's
code, leave `public/data/` as it is, and say on the first line of the pull request that it needs a
rebuild.

Every change keeps the rules in [AGENTS.md](AGENTS.md). The two that surprise people most: the site
only publishes data that anyone can open without signing in, and it never publishes staff names.

Some kinds of change wait for the maintainer's decision however well they are checked: a new data
source, anything about deployment or secrets, a new dependency, and the rules themselves. Say so at
the top of the pull request if yours is one of them.

Working with a coding agent is fine. `AGENTS.md` is written for it, and the same checks apply.
Every pull request says how it was made: the model, the harness with its version and the thinking
effort, or `none` for a change written by hand. The form asks for them and CI checks they are there.

## Another university

The site is meant to grow to more schools. Ask for one, or offer to do one, with the "Another
university" issue form. To port the project in a repository of your own, see "Porting to another
university" in the [README](README.md).

## Licence

Code you contribute is under the repository's MIT licence. That licence does not cover the data;
see "Data sources and licences" in the README.
