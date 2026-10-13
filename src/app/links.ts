// Addresses outside this site that the interface links to.
export const REPO = "https://github.com/pengqianhan/campus-world-model";

/** A campus map of another university, made by someone else, that this site links to. */
export interface World {
  /** Its name and place are under `travel.worlds.<id>` in the locale files. */
  id: string;
  url: string;
  /** Where that campus is, for the distance counted on the way there. */
  lat: number;
  lon: number;
}

/** The project this one was inspired by. The address is its campus view with live classes. */
export const INSPIRED_BY: World = { id: "tsinghua", url: "https://tsinghua-world-model.pages.dev/?campus=1&classMode=live", lat: 40.0, lon: 116.327 };

export const WORLDS: World[] = [INSPIRED_BY];
