// University of Auckland room codes look like "<building>-<room>": 303-G23, 260-098, 105S-039.
// The building part is three digits with an optional wing letter. The room part usually starts
// with the floor: a letter for ground/basement levels (G, B, SB, LG) or the leading digit(s).
//
// The campus map gives the true floor for every room it knows. The inference in this file is the
// fallback for codes the map does not know, and its results are labelled "inferred" in the UI.

export interface ParsedRoomCode {
  building: string;
  room: string;
  /** Canonical "<building>-<room>". */
  code: string;
}

const ROOM_PART = /^[A-Z]{0,3}\d{1,4}[A-Z0-9]{0,3}$/;
/** Letters that start a room part because they name a floor, so "303G23" is 303 + G23, not 303G + 23. */
const FLOOR_LETTERS = new Set(["G", "B", "M", "L", "P"]);

function normalise(text: string): string {
  return text
    .toUpperCase()
    .replace(/[‐-―−]/g, "-")
    .trim();
}

/**
 * Parses free text such as "303-G23", "303 g23", "303.G23" or "303G23".
 * `knownBuildings` (building ids) resolves the wing-letter ambiguity in unseparated input.
 */
export function parseRoomCode(text: string, knownBuildings?: ReadonlySet<string>): ParsedRoomCode | null {
  const t = normalise(text);
  if (!t) return null;

  const sep = /^(\d{3}[A-Z]?)\s*[-._/\s]\s*([A-Z0-9][A-Z0-9.\s]*)$/.exec(t);
  if (sep) {
    const building = sep[1]!;
    const room = sep[2]!.replace(/[\s.]/g, "");
    if (!ROOM_PART.test(room)) return null;
    return { building, room, code: `${building}-${room}` };
  }

  const joined = /^(\d{3})([A-Z]?)([A-Z0-9]+)$/.exec(t);
  if (!joined) return null;
  const digits = joined[1]!;
  const letter = joined[2]!;
  const rest = joined[3]!;
  const candidates: [string, string][] = [];
  if (letter) {
    const wing: [string, string] = [digits + letter, rest];
    const plain: [string, string] = [digits, letter + rest];
    const wingKnown = knownBuildings?.has(wing[0]) ?? false;
    const plainKnown = knownBuildings?.has(plain[0]) ?? false;
    if (wingKnown && !FLOOR_LETTERS.has(letter)) candidates.push(wing, plain);
    else if (plainKnown || !wingKnown) candidates.push(plain, wing);
    else candidates.push(wing, plain);
  } else {
    candidates.push([digits, rest]);
  }
  for (const [building, room] of candidates) {
    if (ROOM_PART.test(room)) return { building, room, code: `${building}-${room}` };
  }
  return null;
}

/** Finds the first room-code-looking token inside longer text, e.g. a timetable location field. */
export function findRoomCode(text: string, knownBuildings?: ReadonlySet<string>): ParsedRoomCode | null {
  const t = normalise(text);
  const re = /(\d{3}[A-Z]?)\s*[-._/]\s*([A-Z]{0,3}\d{1,4}[A-Z0-9]{0,3})\b/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const parsed = parseRoomCode(`${m[1]}-${m[2]}`, knownBuildings);
    if (parsed && (!knownBuildings || knownBuildings.has(parsed.building))) return parsed;
  }
  const whole = parseRoomCode(t, knownBuildings);
  return whole;
}

/**
 * Candidate floor names for a room part, most likely first.
 * "G23" -> ["G"], "B11" -> ["B"], "423" -> ["4"], "098" -> ["0"], "1012" -> ["10", "1"].
 */
export function floorCandidates(room: string): string[] {
  const m = /^([A-Z]*)(\d*)/.exec(room.toUpperCase());
  if (!m) return [];
  const letters = m[1]!;
  const digits = m[2]!;
  if (letters) return [letters];
  if (!digits) return [];
  if (digits.length <= 2) return ["0"];
  const strip = (s: string) => s.replace(/^0+(?=\d)/, "");
  const out = [strip(digits.slice(0, -2))];
  if (digits.length >= 4) out.push(strip(digits.slice(0, -3)));
  return out;
}

/** Floor names that mean the same level in different buildings' numbering styles. */
const EQUIVALENT: string[][] = [
  ["G", "0"],
  ["B", "B1", "-1"],
  ["SB", "B2", "-2"],
  ["LG", "M-1"],
];

export interface FloorLike {
  i: number;
  name: string;
}

/** Matches a floor-name token against a building's floors, allowing the equivalences above. */
export function matchFloor<T extends FloorLike>(floors: readonly T[], token: string): T | null {
  const want = token.toUpperCase();
  const exact = floors.find((f) => f.name.toUpperCase() === want);
  if (exact) return exact;
  for (const group of EQUIVALENT) {
    if (!group.includes(want)) continue;
    for (const alt of group) {
      const f = floors.find((x) => x.name.toUpperCase() === alt);
      if (f) return f;
    }
  }
  return null;
}

/** Infers the floor of a room from its number alone. Returns null when nothing plausible matches. */
export function inferFloor<T extends FloorLike>(floors: readonly T[], room: string): T | null {
  for (const token of floorCandidates(room)) {
    const f = matchFloor(floors, token);
    if (f) return f;
  }
  return null;
}

/**
 * Comparison key for a room part that ignores zero padding: "G010" and "G10" give the same key,
 * as do "098" and "98". Timetables and door signs do not always pad the same way as the map.
 */
export function roomKey(room: string): string {
  const m = /^([A-Z]*)(\d*)(.*)$/.exec(room.toUpperCase());
  if (!m) return room.toUpperCase();
  return `${m[1]}${m[2]!.replace(/^0+(?=\d)/, "")}${m[3]}`;
}

/** Comparison key for a whole code, e.g. "114-G010" -> "114-G10". */
export function codeKey(code: string): string {
  const i = code.indexOf("-");
  return i < 0 ? code.toUpperCase() : `${code.slice(0, i).toUpperCase()}-${roomKey(code.slice(i + 1))}`;
}
