// Snapshot OpenStreetMap context geometry (surrounding buildings, streets, parks, trees) with one
// Overpass query for each area the map draws (scripts/lib/areas.ts): the City / Grafton /
// Newmarket area, and each campus or building away from it.
// OSM data is © OpenStreetMap contributors, ODbL 1.0, so these snapshots are committed.
import { AREAS, type SceneArea } from "./lib/areas.ts";
import { snapshot } from "./lib/snapshot.ts";

const query = (area: SceneArea) => `
[out:json][timeout:180][bbox:${area.bbox.join(",")}];
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

for (const area of AREAS) {
  let buf: Buffer | undefined;
  // A busy instance answers 504; go round them all up to three times, a minute apart.
  for (let round = 0; round < 3 && !buf; round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, 60_000));
    for (const url of ENDPOINTS) {
      try {
        buf = await snapshot({
          source: "osm",
          file: area.osm,
          url,
          method: "POST",
          body: "data=" + encodeURIComponent(query(area)),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          refresh: process.argv.includes("--refresh"),
        });
        break;
      } catch (e) {
        console.warn(String(e));
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
  if (!buf) throw new Error(`all Overpass endpoints failed for ${area.id}`);
  const data = JSON.parse(buf.toString("utf8")) as { elements: { type: string; tags?: Record<string, string> }[] };
  const count: Record<string, number> = {};
  for (const e of data.elements) {
    const t = e.tags ?? {};
    const k = t.building ? "building" : t["building:part"] ? "building:part" : t.highway ? "highway" : t.natural === "tree" ? "tree" : t.leisure ? "leisure" : t.landuse ? "landuse" : t.natural ? "natural" : t.railway ? "railway" : t.waterway ? "waterway" : "other";
    count[`${e.type}:${k}`] = (count[`${e.type}:${k}`] ?? 0) + 1;
  }
  console.log(area.id, buf.length, "bytes", data.elements.length, "elements", count);
}
