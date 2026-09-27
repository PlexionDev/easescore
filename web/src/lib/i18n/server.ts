import "server-only";

import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, PATH_HEADER, isLocale, isTranslatedPath, translator, type Locale, type T } from "./index";

/** The language the visitor chose in the menu (cookie), English when unset. */
export async function getPreferredLocale(): Promise<Locale> {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/** Path of the current request (set by src/proxy.ts), or null. */
export async function requestPath(): Promise<string | null> {
  return (await headers()).get(PATH_HEADER);
}

/**
 * The language this page renders in: Spanish only when chosen and the page is fully translated,
 * otherwise English (a page is never half translated).
 */
export async function getLocale(): Promise<Locale> {
  const preferred = await getPreferredLocale();
  if (preferred === "en") return "en";
  return isTranslatedPath(await requestPath()) ? preferred : "en";
}

/** Translator for this page's language, plus the language itself. */
export async function getT(): Promise<{ t: T; locale: Locale }> {
  const locale = await getLocale();
  return { t: translator(locale), locale };
}
