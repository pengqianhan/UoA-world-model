// Snapshot the University's public campus map dataset (maps.auckland.ac.nz, served by MapsIndoors).
// These are the same anonymous requests the public map page makes. Raw responses stay in
// data/raw/mapsindoors (gitignored); only derived room/building facts are published.
import { snapshot } from "./lib/snapshot.ts";

const refresh = process.argv.includes("--refresh");
const base = "https://api.mapsindoors.com";
const q = "solutionId=auckland&v=5";

for (const name of ["venues", "buildings", "categories", "locations"]) {
  const buf = await snapshot({
    source: "mapsindoors",
    file: `mapsindoors/${name}.json`,
    url: `${base}/sync/${name}?${q}`,
    refresh,
  });
  console.log(name, buf.length, "bytes");
}
