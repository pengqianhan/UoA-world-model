// Text matching for the search box: case-insensitive, macron-insensitive, punctuation-tolerant.

/**
 * Folds text for comparison: lower case, diacritics removed (so "Maori" matches "Māori"),
 * typographic apostrophes and ʻokina dropped, everything else that is not a letter or digit
 * turned into a single space.
 */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʻʼ'`]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Folded text with all separators removed: "COMPSCI 101" and "compsci101" both become "compsci101". */
export function compact(text: string): string {
  return fold(text).replace(/ /g, "");
}

export interface SearchEntry<T> {
  item: T;
  /** Identifier people type exactly, e.g. a room code or course code. Compared in compact form. */
  code?: string;
  /** Free text: names, aliases. */
  text: string[];
  /** Tie-breaker added to the score; use it to rank kinds of result against each other. */
  boost?: number;
}

export interface IndexedEntry<T> {
  item: T;
  code: string;
  words: string[];
  joined: string;
  boost: number;
}

export function buildIndex<T>(entries: readonly SearchEntry<T>[]): IndexedEntry<T>[] {
  return entries.map((e) => {
    const folded = e.text.map(fold).filter(Boolean);
    return {
      item: e.item,
      code: e.code ? compact(e.code) : "",
      words: folded.flatMap((t) => t.split(" ")),
      joined: folded.join(" | "),
      boost: e.boost ?? 0,
    };
  });
}

export interface SearchHit<T> {
  item: T;
  score: number;
}

/** Scores one entry against a folded query; 0 means no match. */
function score<T>(e: IndexedEntry<T>, q: string, qCompact: string, tokens: string[]): number {
  let best = 0;
  if (e.code) {
    if (e.code === qCompact) best = 1000;
    else if (e.code.startsWith(qCompact)) best = 700 - Math.min(100, e.code.length - qCompact.length);
    else if (qCompact.length >= 3 && e.code.includes(qCompact)) best = 400;
  }
  if (tokens.length) {
    let all = true;
    let prefixHits = 0;
    for (const tok of tokens) {
      let found = false;
      for (const w of e.words) {
        if (w === tok) {
          found = true;
          prefixHits += 2;
          break;
        }
        if (w.startsWith(tok)) {
          found = true;
          prefixHits += 1;
          break;
        }
      }
      if (!found && tok.length >= 3 && (e.joined.includes(tok) || (e.code && e.code.includes(tok)))) found = true;
      if (!found) {
        all = false;
        break;
      }
    }
    if (all) {
      let s = 300 + prefixHits * 20;
      if (e.joined.startsWith(q)) s += 60;
      else if (e.joined.includes(q)) s += 30;
      best = Math.max(best, s);
    }
  }
  return best ? best + e.boost : 0;
}

export function search<T>(index: readonly IndexedEntry<T>[], query: string, limit = 30): SearchHit<T>[] {
  const q = fold(query);
  if (!q) return [];
  const qCompact = q.replace(/ /g, "");
  const tokens = q.split(" ");
  const hits: SearchHit<T>[] = [];
  for (const e of index) {
    const s = score(e, q, qCompact, tokens);
    if (s > 0) hits.push({ item: e.item, score: s });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
