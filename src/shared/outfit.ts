// What a walker wears: colours and a few choices, as plain data. An outfit can be written by
// hand or by an agent and passed to the site, so it is checked strictly: known keys only, colours
// as #rrggbb, choices from fixed lists, and nothing that runs. The outfits are made up; none is
// a University uniform, and none uses the University's logo or brand colours.

export const HATS = ["none", "cap", "beanie", "witch", "pumpkin"] as const;
export const HAIR = ["short", "long", "bun", "none"] as const;
export const UMBRELLA = ["auto", "always", "never"] as const;
export const SLEEVES = ["short", "long"] as const;

export interface Outfit {
  name: string;
  skin: string;
  hair: string;
  hairStyle: (typeof HAIR)[number];
  top: string;
  /** Short sleeves show the arms; long ones are the colour of the top to the wrists. */
  sleeves: (typeof SLEEVES)[number];
  bottom: string;
  shoes: string;
  hat: (typeof HATS)[number];
  hatColour: string;
  /** A backpack in this colour, or none. */
  backpack: string | null;
  /** A cape in this colour, or none. */
  cape: string | null;
  /** "auto" opens the umbrella while it rains in Auckland, as Open-Meteo reports it now. */
  umbrella: (typeof UMBRELLA)[number];
  umbrellaColour: string;
}

export const OUTFITS: Record<string, Outfit> = {
  student: {
    name: "Student",
    skin: "#c98f5e",
    hair: "#33241a",
    hairStyle: "short",
    top: "#e2763c",
    sleeves: "short",
    bottom: "#2f3a4a",
    shoes: "#ecebe6",
    hat: "none",
    hatColour: "#2f3a4a",
    backpack: "#3f7f6f",
    cape: null,
    umbrella: "auto",
    umbrellaColour: "#2c6aa8",
  },
  raincoat: {
    name: "Raincoat",
    skin: "#8d5a3c",
    hair: "#1d1612",
    hairStyle: "bun",
    top: "#f2c230",
    sleeves: "long",
    bottom: "#38424d",
    shoes: "#2b2b2b",
    hat: "none",
    hatColour: "#f2c230",
    backpack: null,
    cape: null,
    umbrella: "always",
    umbrellaColour: "#d64545",
  },
  explorer: {
    name: "Explorer",
    skin: "#e5b88f",
    hair: "#8a5a2e",
    hairStyle: "long",
    top: "#6f8f4e",
    sleeves: "long",
    bottom: "#5b4a3a",
    shoes: "#3a2c22",
    hat: "cap",
    hatColour: "#4d6a35",
    backpack: "#8a5a2b",
    cape: null,
    umbrella: "auto",
    umbrellaColour: "#4d6a35",
  },
  halloween: {
    name: "Pumpkin head",
    skin: "#f1c89a",
    hair: "#000000",
    hairStyle: "none",
    top: "#f08a24",
    sleeves: "long",
    bottom: "#26262c",
    shoes: "#141416",
    hat: "pumpkin",
    hatColour: "#f07f1a",
    backpack: null,
    cape: "#1b1b24",
    umbrella: "never",
    umbrellaColour: "#26262c",
  },
  witch: {
    name: "Witch",
    skin: "#b77b4f",
    hair: "#2a1c3a",
    hairStyle: "long",
    top: "#4b2a6b",
    sleeves: "long",
    bottom: "#1f1a2a",
    shoes: "#141416",
    hat: "witch",
    hatColour: "#1d1a24",
    backpack: null,
    cape: "#5e2a83",
    umbrella: "never",
    umbrellaColour: "#1d1a24",
  },
};

export const DEFAULT_OUTFIT = "student";

const COLOUR = /^#[0-9a-f]{6}$/i;
const COLOURS = ["skin", "hair", "top", "bottom", "shoes", "hatColour", "umbrellaColour"] as const;
const OPTIONAL_COLOURS = ["backpack", "cape"] as const;
const KEYS = new Set<string>(["name", "base", "hairStyle", "hat", "umbrella", "sleeves", ...COLOURS, ...OPTIONAL_COLOURS]);

/**
 * Reads an outfit from untrusted data: a preset's name, or an object of the keys above. An object
 * may name a preset as its `base` and change only some keys. Returns the outfit, or the problems.
 */
export function parseOutfit(input: unknown): { outfit?: Outfit; errors: string[] } {
  if (typeof input === "string") {
    const preset = OUTFITS[input.trim().toLowerCase()];
    return preset ? { outfit: { ...preset }, errors: [] } : { errors: [`No outfit called "${input}". Presets: ${Object.keys(OUTFITS).join(", ")}.`] };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: ["An outfit is a preset's name or an object."] };
  const o = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(o)) if (!KEYS.has(k)) errors.push(`Unknown key "${k}".`);
  const baseName = o.base === undefined ? DEFAULT_OUTFIT : String(o.base).toLowerCase();
  const base = OUTFITS[baseName];
  if (!base) errors.push(`No outfit called "${String(o.base)}" to start from.`);
  const out: Outfit = { ...(base ?? OUTFITS[DEFAULT_OUTFIT]!) };
  if (o.name !== undefined) {
    if (typeof o.name !== "string" || !o.name.trim() || o.name.length > 40) errors.push("name: up to 40 characters.");
    else out.name = o.name.trim();
  } else if (!base || o.base === undefined) out.name = "Custom";
  for (const k of COLOURS) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== "string" || !COLOUR.test(o[k] as string)) errors.push(`${k}: a colour as #rrggbb.`);
    else out[k] = (o[k] as string).toLowerCase();
  }
  for (const k of OPTIONAL_COLOURS) {
    if (o[k] === undefined) continue;
    if (o[k] === null || o[k] === false) out[k] = null;
    else if (typeof o[k] !== "string" || !COLOUR.test(o[k] as string)) errors.push(`${k}: a colour as #rrggbb, or null.`);
    else out[k] = (o[k] as string).toLowerCase();
  }
  const choose = <T extends string>(k: "hairStyle" | "hat" | "umbrella" | "sleeves", options: readonly T[]) => {
    if (o[k] === undefined) return;
    if (typeof o[k] !== "string" || !options.includes(o[k] as T)) errors.push(`${k}: one of ${options.join(", ")}.`);
    else (out as unknown as Record<string, string>)[k] = o[k] as string;
  };
  choose("hairStyle", HAIR);
  choose("hat", HATS);
  choose("umbrella", UMBRELLA);
  choose("sleeves", SLEEVES);
  return errors.length ? { errors } : { outfit: out, errors: [] };
}
