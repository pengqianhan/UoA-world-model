// Snapshot the elevation tiles under every area the map draws (scripts/lib/areas.ts), from the
// AWS Open Data "Terrain Tiles" (https://registry.opendata.aws/terrain-tiles/, no key, no account).
// Over New Zealand they hold the LINZ 8 m DEM (Crown copyright, CC BY 3.0 NZ), so these
// snapshots are committed. About 25 tiles of 50-90 KB at zoom 14.
import { AREAS } from "./lib/areas.ts";
import { snapshot } from "./lib/snapshot.ts";
import { TERRAIN_URL, TERRAIN_ZOOM, terrainBox, terrainFile, tilesFor } from "./lib/terrain.ts";

const refresh = process.argv.includes("--refresh");
const seen = new Set<string>();
for (const area of AREAS) {
  const tiles = tilesFor(terrainBox(area), TERRAIN_ZOOM);
  for (const [x, y] of tiles) {
    const file = terrainFile(TERRAIN_ZOOM, x, y);
    if (seen.has(file)) continue;
    seen.add(file);
    await snapshot({ source: "terrain", file, url: TERRAIN_URL(TERRAIN_ZOOM, x, y), refresh });
  }
  console.log(area.id, tiles.length, "tiles");
}
console.log(seen.size, "tiles in all");
