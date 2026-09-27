// Lightweight i18n: two dictionaries (en, es) and a t() helper that works in server and client
// components. The language comes from a cookie (set by the top-right language menu, mirrored in
// localStorage); server components read it with getLocale() from "./server", client components with
// useT() from "./client". Spanish was drafted with AI; legal and disclaimer strings are listed in
// .planning/I18N-REVIEW.md for human review. The English version governs.

import { en, type Key } from "./en";
import { es } from "./es";

export type Locale = "en" | "es";
export type { Key };
export const LOCALES: Locale[] = ["en", "es"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "easescore_lang";
/** Request header set by src/proxy.ts with the path, so the root layout can tell translated pages apart. */
export const PATH_HEADER = "x-easescore-path";

const DICTS: Record<Locale, Record<Key, string>> = { en, es };

export function isLocale(x: unknown): x is Locale {
  return x === "en" || x === "es";
}

export type Vars = Record<string, string | number>;
export type T = (key: Key, vars?: Vars) => string;

/** A translator for one locale. `{name}` placeholders are filled from `vars`. */
export function translator(locale: Locale): T {
  const d = DICTS[locale] ?? en;
  return (key, vars) => {
    const s = d[key] ?? en[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}

/**
 * Pages whose visible strings are fully in Spanish. Every other page stays in English (with lang="en"
 * on <html>) and shows a small Spanish note that it is still in English.
 */
export function isTranslatedPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/limitations") return true;
  // The parcel pane (not its report, which translates only its summary section).
  return /^\/parcel\/[^/]+$/.test(p);
}

/** The report translates its summary section only (the rest of the document says it is in English). */
export function isReportPath(path: string | null | undefined): boolean {
  return !!path && /^\/parcel\/[^/]+\/report\/?$/.test(path);
}
