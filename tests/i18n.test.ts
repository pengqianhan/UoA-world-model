import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { has, lang, languages, locales, pick, t, tn } from "../src/app/i18n.ts";

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

const files = sourceFiles("src").filter((f) => !f.includes(`${path.sep}shared${path.sep}`));
const sources = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

describe("locale files", () => {
  it("are discovered from src/i18n/locales, English first", () => {
    expect(languages[0]).toEqual({ code: "en", name: "English" });
    expect(Object.keys(locales)).toContain("en");
  });

  it("every literal key used in the code exists in en.json", () => {
    const missing: string[] = [];
    for (const [file, text] of sources) {
      for (const m of text.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) {
        if (!has(m[1]!)) missing.push(`${file}: ${m[1]}`);
      }
      for (const m of text.matchAll(/\btn\(\s*"([a-zA-Z0-9_.]+)"/g)) {
        if (!has(`${m[1]}_one`) || !has(`${m[1]}_other`)) missing.push(`${file}: ${m[1]}_one/_other`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every key group built with a template literal exists", () => {
    const missing: string[] = [];
    for (const [file, text] of sources) {
      for (const m of text.matchAll(/\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{/g)) {
        const group = m[1]!.split(".").reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], locales.en);
        if (typeof group !== "object" || group === null) missing.push(`${file}: ${m[1]}.*`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has no unused top-level sections (so translators are not asked to translate dead text)", () => {
    const all = [...sources.values()].join("\n");
    for (const section of Object.keys(locales.en!)) {
      if (section === "_meta") continue;
      expect(all.includes(`"${section}.`) || all.includes(`\`${section}.`), section).toBe(true);
    }
  });
});

describe("no interface text is hard-coded in components", () => {
  it("JSX contains no literal words outside translation calls", () => {
    const offenders: string[] = [];
    for (const [file, text] of sources) {
      if (!file.endsWith(".tsx")) continue;
      text.split("\n").forEach((line, i) => {
        // Text between tags, e.g. <p>Hello</p> or a bare word on its own JSX line.
        const between = />\s*([A-Za-z][A-Za-z ,.'!?-]{2,})\s*</.exec(line);
        const bare = /^\s+([A-Z][a-z]+(?: [a-z]+)+)[.!?]?\s*$/.exec(line);
        const attr = /\b(?:placeholder|aria-label|title|alt)="[^"{]*[A-Za-z]{3,}[^"]*"/.exec(line);
        if (between || bare || attr) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("translation helpers", () => {
  it("fills parameters and falls back to the key", () => {
    expect(t("building.number", { id: "303" })).toBe("Building 303");
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
  it("chooses plural forms", () => {
    expect(tn("search.resultsCount", 1)).toBe("1 result");
    expect(tn("search.resultsCount", 4)).toBe("4 results");
  });
  it("falls back to English for a language without a translation, in both UI text and data names", () => {
    lang.value = "mi";
    try {
      expect(t("nav.search")).toBe("Search");
      expect(pick({ en: "Semester Two 2026", mi: "Wehenga Rua 2026" })).toBe("Wehenga Rua 2026");
      expect(pick({ en: "General Library" })).toBe("General Library");
    } finally {
      lang.value = "en";
    }
  });
});
