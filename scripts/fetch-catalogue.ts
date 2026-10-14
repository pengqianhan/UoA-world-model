// Snapshot the course list of the University of Auckland Curriculum Catalogue
// (https://study.auckland.ac.nz, public, no sign-in): every course's code and title for a year,
// and the terms and the campuses it is offered in. Only facts are kept from it; the
// prescriptions, which are prose, are not published.
//
// The catalogue is an Oracle APEX app that serves its lists only inside a session. One GET of the
// browse page for the award type "Course" (which holds every course) opens one: a cookie and the
// form's tokens. Each list is then one POST to wwv_flow.ajax for the whole list at once; a filter
// on term or campus is an item value in the same POST. robots.txt answers 404 (2026-10-15).
// Requests: 1 GET + 1 POST for the filter values + 1 for all courses + one per term and campus
// value (11 + 15 on 2026-10-15), about 30 in all, paced by scripts/lib/snapshot.ts.
import { CATALOGUE_DIR, CATALOGUE_YEAR, facetFile } from "./lib/catalogue.ts";
import { hasSnapshot, politeFetch, readSnapshot, snapshot } from "./lib/snapshot.ts";

const BASE = "https://study.auckland.ac.nz";
const PAGE = `${BASE}/ords/r/uoa/catalogue/browse2?p4_browse_id=01`;
const refresh = process.argv.includes("--refresh");

const unentity = (s: string) =>
  s.replace(/&#x2F;/g, "/").replace(/&#x20;/g, " ").replace(/&#x3A;/g, ":").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function find(re: RegExp, text: string, what: string): string {
  const m = re.exec(text);
  if (!m) throw new Error(`catalogue page: no ${what}; the app may have changed`);
  return m[1]!;
}

/** The current value of a page item in the browse page's HTML. */
function itemValue(html: string, name: string): string {
  const i = html.indexOf(`id="${name}"`);
  if (i < 0) return "";
  const tag = html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
  if (tag.startsWith("<select")) {
    const m = /<option value="([^"]*)" selected=/.exec(html.slice(i, html.indexOf("</select>", i)));
    return m ? unentity(m[1]!) : "";
  }
  const m = / value="([^"]*)"/.exec(tag);
  return m ? unentity(m[1]!) : "";
}

interface Session {
  cookie: string;
  instance: string;
  step: string;
  context: string;
  salt: string;
  protected: string;
  region: string;
  cardsAjax: string;
  facetsAjax: string;
  items: { n: string; v: string; ck?: string }[];
}

async function openSession(): Promise<Session> {
  const res = await politeFetch(PAGE);
  const html = await res.text();
  if (res.status !== 200) throw new Error(`${PAGE} -> HTTP ${res.status}`);
  const init = find(/templateReportRegionInit\((\{"regionId":"\d+"[^\n]*?"itemsToSubmit":"[^"]*")/, html, "list region");
  const names = find(/"itemsToSubmit":"([^"]*)"/, init, "items").split(",").map((s) => s.replace(/^#/, ""));
  return {
    cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
    instance: find(/name="p_instance" value="(\d+)"/, html, "session"),
    step: find(/name="p_flow_step_id" value="(\d+)"/, html, "page"),
    context: unentity(find(/value="([^"]+)" id="pContext"/, html, "context")),
    salt: find(/value="(\d+)" id="pSalt"/, html, "salt"),
    protected: unentity(find(/id="pPageItemsProtected" value="([^"]*)"/, html, "protected items")),
    region: find(/"regionId":"(\d+)"/, init, "region id"),
    cardsAjax: JSON.parse(`"${find(/"ajaxIdentifier":"([^"]+)"/, init, "list call")}"`) as string,
    facetsAjax: JSON.parse(`"${find(/\.facets\(\{"regionStaticId":"[^"]+","ajaxIdentifier":"([^"]+)"/, html, "filter call")}"`) as string,
    items: names
      .filter((n) => !n.endsWith("_ORDER_BY"))
      .map((n) => {
        const ck = new RegExp(`data-for="${n}" value="([^"]*)"`).exec(html);
        return { n, v: itemValue(html, n), ...(ck ? { ck: ck[1] } : {}) };
      }),
  };
}

/** One POST of the session, kept as a snapshot under `file`. */
function post(s: Session, file: string, fields: Record<string, string>, values: Record<string, string>): Promise<Buffer> {
  const pageItems = {
    itemsToSubmit: s.items.map((it) => (it.n in values ? { n: it.n, v: values[it.n]! } : it)),
    protected: s.protected,
    rowVersion: "",
    formRegionChecksums: [],
  };
  const body = new URLSearchParams({ p_flow_id: "1200", p_flow_step_id: s.step, p_instance: s.instance, p_debug: "", ...fields });
  body.set("p_json", JSON.stringify({ ...JSON.parse(fields.p_json ?? "{}"), pageItems, salt: s.salt }));
  return snapshot({
    source: "uoa-catalogue",
    file,
    url: `${BASE}/ords/wwv_flow.ajax?p_context=${s.context}`,
    method: "POST",
    body: body.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: s.cookie,
    },
    refresh,
  });
}

/** Every course on the list, or those passing one filter. */
const list = (s: Session, file: string, values: Record<string, string>) =>
  post(s, file, { p_json: JSON.stringify({ regions: [{ id: s.region, ajaxIdentifier: s.cardsAjax, fetchData: { version: 1, firstRow: 1, maxRows: 9000 } }] }) }, values);

const year = { P0_CATALOGUE_YEAR: CATALOGUE_YEAR };
const facetsFile = `${CATALOGUE_DIR}/filters.json`;

// Everything on disk already: nothing to ask.
const needed = (): string[] => {
  if (!hasSnapshot(facetsFile) || !hasSnapshot(`${CATALOGUE_DIR}/courses.json`)) return ["all"];
  const counts = JSON.parse(readSnapshot(facetsFile).toString("utf8")) as { counts: Record<string, Record<string, number>> };
  const files = [
    ...Object.keys(counts.counts.P4_SEMESTER ?? {}).map((v) => facetFile("terms", v)),
    ...Object.keys(counts.counts.P4_CAMPUS ?? {}).map((v) => facetFile("campuses", v)),
  ];
  return files.filter((f) => !hasSnapshot(f));
};

if (!refresh && needed().length === 0) {
  console.log("catalogue snapshot complete; pass --refresh to fetch it again");
} else {
  const s = await openSession();
  const counts = JSON.parse(
    (await post(s, facetsFile, { p_request: `PLUGIN=${s.facetsAjax}`, x01: "FETCH_COUNTS", x02: "", x03: "", p_json: "{}" }, year)).toString("utf8"),
  ) as { counts?: Record<string, Record<string, number>> };
  if (!counts.counts?.P4_SEMESTER || !counts.counts.P4_CAMPUS) throw new Error("catalogue: no term or campus filters in the answer");
  const all = JSON.parse((await list(s, `${CATALOGUE_DIR}/courses.json`, year)).toString("utf8")) as { regions?: { fetchedData?: { values?: unknown[]; moreData?: boolean } }[] };
  const rows = all.regions?.[0]?.fetchedData;
  if (!rows?.values?.length || rows.moreData) throw new Error("catalogue: the course list is empty or incomplete");
  for (const term of Object.keys(counts.counts.P4_SEMESTER)) await list(s, facetFile("terms", term), { ...year, P4_SEMESTER: term });
  for (const campus of Object.keys(counts.counts.P4_CAMPUS)) await list(s, facetFile("campuses", campus), { ...year, P4_CAMPUS: campus });
  console.log(rows.values.length, "courses;", Object.keys(counts.counts.P4_SEMESTER).length, "terms;", Object.keys(counts.counts.P4_CAMPUS).length, "campuses");
}
