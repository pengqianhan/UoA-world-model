// Looking at a site counts as fetching from it (AGENTS.md, "Snapshot once"; the porting skill's
// RECON.md). A headless browser opened for research goes through this: only the hosts being
// studied, at most one request every PACE_MS, no service workers, and every request logged,
// sent or blocked. Anything else is aborted before it leaves the machine.
export const PACE_MS = 1100;

/**
 * A page in a fresh context of `browser` that keeps to the rules above. `url` names the host being
 * studied; `allow` adds more hosts; `types`, if given, lets only those resource types through
 * (["document"] to read one page and nothing it loads). Returns the page, its context and the log.
 */
export async function politePage(browser, { url, allow = [], types, viewport } = {}) {
  const hosts = new Set([new URL(url).host, ...allow]);
  const context = await browser.newContext({ serviceWorkers: "block", ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  const log = [];
  let next = 0;
  await page.route("**/*", async (route) => {
    const req = route.request();
    const row = { type: req.resourceType(), method: req.method(), url: req.url() };
    let host = "";
    try {
      host = new URL(req.url()).host;
    } catch {}
    if (!hosts.has(host) || (types && !types.includes(row.type))) {
      log.push({ at: new Date().toISOString(), ...row, sent: false });
      return route.abort("blockedbyclient");
    }
    const wait = next - Date.now();
    next = Math.max(next, Date.now()) + PACE_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    // The time it was let through.
    log.push({ at: new Date().toISOString(), ...row, sent: true });
    return route.continue();
  });
  return { page, context, log };
}

/** The hosts given as `--allow=a.example,b.example` among the arguments, and the arguments left. */
export function allowArg(args) {
  const flag = args.find((a) => a.startsWith("--allow="));
  return {
    allow: flag ? flag.slice("--allow=".length).split(",").filter(Boolean) : [],
    rest: args.filter((a) => a !== flag),
  };
}
