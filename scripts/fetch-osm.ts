// Snapshot OpenStreetMap context geometry (surrounding buildings, streets, parks, trees)
// for the City / Grafton / Newmarket area with a single Overpass query.
// OSM data is © OpenStreetMap contributors, ODbL 1.0, so this snapshot is committed.
import { snapshot } from "./lib/snapshot.ts";

// south, west, north, east: the three central campuses plus roughly 150 m of margin.
export const OSM_BBOX = [-36.8689, 174.7608, -36.8441, 174.7797] as const;

const query = `
[out:json][timeout:180][bbox:${OSM_BBOX.join(",")}];
(
  way["building"];
  relation["building"];
  way["building:part"];
  way["highway"];
  way["railway"="rail"];
  way["leisure"~"^(park|garden|pitch|playground|sports_centre|track)$"];
  relation["leisure"~"^(park|garden)$"];
  way["landuse"~"^(grass|forest|recreation_ground|cemetery|meadow|village_green)$"];
  way["natural"~"^(wood|water|scrub|grassland|tree_row)$"];
  relation["natural"~"^(wood|water)$"];
  way["waterway"];
  node["natural"="tree"];
);
out body geom qt;
`;

// Public Overpass instances, tried in order; the main one is often busy and answers 504.
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

let buf: Buffer | undefined;
for (const url of ENDPOINTS) {
  try {
    buf = await snapshot({
      source: "osm",
      file: "osm/context.json",
      url,
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      refresh: process.argv.includes("--refresh"),
    });
    break;
  } catch (e) {
    console.warn(String(e));
    await new Promise((r) => setTimeout(r, 5000));
  }
}
if (!buf) throw new Error("all Overpass endpoints failed");
const data = JSON.parse(buf.toString("utf8")) as { elements: { type: string; tags?: Record<string, string> }[] };
const count: Record<string, number> = {};
for (const e of data.elements) {
  const t = e.tags ?? {};
  const k = t.building ? "building" : t["building:part"] ? "building:part" : t.highway ? "highway" : t.natural === "tree" ? "tree" : t.leisure ? "leisure" : t.landuse ? "landuse" : t.natural ? "natural" : t.railway ? "railway" : t.waterway ? "waterway" : "other";
  count[`${e.type}:${k}`] = (count[`${e.type}:${k}`] ?? 0) + 1;
}
console.log(buf.length, "bytes", data.elements.length, "elements", count);
