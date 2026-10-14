// The parts of the world the 3D map draws, each with the OpenStreetMap snapshot of what surrounds
// it. A University building is on the map when its centre lies in one of them.

export interface SceneArea {
  id: string;
  /** South, west, north, east, degrees. */
  bbox: readonly [number, number, number, number];
  /** Snapshot file under data/raw. */
  osm: string;
}

/** The City, Grafton and Newmarket campuses, with roughly 150 m of margin. */
export const CENTRAL: SceneArea = { id: "central", bbox: [-36.8689, 174.7608, -36.8441, 174.7797], osm: "osm/context.json" };

const remote = (id: string, bbox: SceneArea["bbox"]): SceneArea => ({ id, bbox, osm: `osm/context-${id}.json` });

/**
 * Campuses and buildings away from the centre: the extent of their buildings on the campus map
 * of 2026-10-13 with 400 m of margin. "carrick-place" is building 581 of Grafton Campus, 3 km
 * from the rest of it.
 */
export const REMOTE: SceneArea[] = [
  remote("tai-tokerau", [-35.7258, 174.3131, -35.7176, 174.3231]),
  remote("ardmore", [-37.0391, 174.9793, -37.0292, 174.9913]),
  remote("leigh", [-36.2735, 174.7931, -36.2653, 174.8035]),
  remote("waiheke", [-36.8044, 175.0276, -36.7926, 175.0406]),
  remote("tai-tonga", [-36.9959, 174.8744, -36.9883, 174.8838]),
  remote("carrick-place", [-36.8793, 174.748, -36.8718, 174.7573]),
];

export const AREAS: SceneArea[] = [CENTRAL, ...REMOTE];
