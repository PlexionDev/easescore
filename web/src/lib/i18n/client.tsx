"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DEFAULT_LOCALE, isTranslatedPath, translator, type Locale, type T } from "./index";

const Ctx = createContext<{ preferred: Locale; locale: Locale }>({ preferred: DEFAULT_LOCALE, locale: DEFAULT_LOCALE });

/**
 * Set once in the root layout with the visitor's chosen language (cookie). The language actually used
 * follows the path, because the layout is not re-rendered on client navigation: Spanish only on the
 * fully translated pages, English elsewhere (never a half-translated screen). Keeps <html lang> in step.
 */
export function LocaleProvider({ preferred, children }: { preferred: Locale; children: ReactNode }) {
  const path = usePathname();
  const locale: Locale = preferred === "es" && isTranslatedPath(path) ? "es" : "en";
  useEffect(() => {
    if (document.documentElement.lang !== locale) document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(() => ({ preferred, locale }), [preferred, locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The language this page renders in. */
export function useLocale(): Locale {
  return useContext(Ctx).locale;
}

/** The language the visitor chose in the menu (may differ from the page's on untranslated pages). */
export function usePreferredLocale(): Locale {
  return useContext(Ctx).preferred;
}

export function useT(): T {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
