// Where the Curriculum Catalogue snapshot lives: written by scripts/fetch-catalogue.ts, read by
// scripts/build-data.ts.

/** The catalogue year taken. */
export const CATALOGUE_YEAR = "2026";
export const CATALOGUE_DIR = `uoa-catalogue/${CATALOGUE_YEAR}`;

/** The file for the courses passing one filter value, named with letters, digits and dashes. */
export const facetFile = (facet: "terms" | "campuses", value: string) => `${CATALOGUE_DIR}/${facet}/${value.replace(/[^A-Za-z0-9]+/g, "-")}.json`;
