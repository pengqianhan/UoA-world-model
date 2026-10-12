// Interface text. Every string shown to the user comes from a locale file in src/i18n/locales.
// Adding a language means adding one JSON file there (copy en.json, translate the values, set
// _meta.name); it is picked up automatically and offered in the language menu and via ?lang=.
import { signal } from "@preact/signals";
import type { LocalizedText } from "../shared/types.ts";

type Dict = { [key: string]: string | Dict };

const modules = import.meta.glob<{ default: Dict }>("../i18n/locales/*.json", { eager: true });

export const locales: Record<string, Dict> = {};
for (const [path, mod] of Object.entries(modules)) {
  const code = /([^/]+)\.json$/.exec(path)?.[1];
  if (code) locales[code] = mod.default;
}

export const DEFAULT_LANG = "en";

export const languages: { code: string; name: string }[] = Object.entries(locales)
  .map(([code, dict]) => ({ code, name: String((dict._meta as Dict | undefined)?.name ?? code) }))
  .sort((a, b) => (a.code === DEFAULT_LANG ? -1 : b.code === DEFAULT_LANG ? 1 : a.name.localeCompare(b.name)));

/** Current interface language. Components that call t() re-render when it changes. */
export const lang = signal(DEFAULT_LANG);

export function setLang(code: string | null | undefined): void {
  const next = code && locales[code] ? code : DEFAULT_LANG;
  lang.value = next;
  document.documentElement.lang = next;
  document.documentElement.dir = String((locales[next]?._meta as Dict | undefined)?.dir ?? "ltr");
}

function lookup(dict: Dict | undefined, key: string): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

export type Params = Record<string, string | number>;

function fill(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Translates a key such as "about.title". Falls back to English, then to the key itself. */
export function t(key: string, params?: Params): string {
  const text = lookup(locales[lang.value], key) ?? lookup(locales[DEFAULT_LANG], key) ?? key;
  return fill(text, params);
}

/** True when the key exists in the current language or in English. */
export function has(key: string): boolean {
  return (lookup(locales[lang.value], key) ?? lookup(locales[DEFAULT_LANG], key)) !== undefined;
}

/** Plural-aware translation: picks key_one / key_other (and other CLDR categories if present). */
export function tn(key: string, count: number, params?: Params): string {
  const category = new Intl.PluralRules(lang.value).select(count);
  const p = { count, ...params };
  for (const k of [`${key}_${category}`, `${key}_other`, key]) {
    if (has(k)) return t(k, p);
  }
  return t(key, p);
}

/** Picks the current language from a data field, falling back to English. */
export function pick(text: LocalizedText | undefined): string {
  if (!text) return "";
  return text[lang.value] ?? text.en;
}

/**
 * The locale to hand to Intl for dates and numbers. A locale file can name a regional variant in
 * _meta.intl (English uses en-NZ so dates read "Tue 13 Oct", not "Tue, Oct 13").
 */
export function intlLocale(): string {
  return String((locales[lang.value]?._meta as Dict | undefined)?.intl ?? lang.value);
}

/** Formats an ISO date for display in the current language, without time-zone shifts. */
export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Intl.DateTimeFormat(intlLocale(), { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
