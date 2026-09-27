"use client";

// Top-right language menu (English / Español). The choice is kept in a cookie (so the server renders
// the right language and <html lang>) and mirrored in localStorage (restores the cookie if it was
// cleared). Shows the AI-translation note in both languages.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, isLocale, type Locale } from "@/lib/i18n";
import { usePreferredLocale } from "@/lib/i18n/client";

const NOTE_EN = "Translated with AI and reviewed for key terms. If something is unclear, the English version governs.";
const NOTE_ES = "Traducido con IA y revisado en sus términos clave. Si algo no está claro, la versión en inglés prevalece.";
const SCOPE_EN = "Spanish covers the homepage, the parcel pane and its summary, Limitations and the report summary. Other pages stay in English.";
const SCOPE_ES = "El español cubre la página de inicio, el panel de la parcela y su resumen, Limitaciones y el resumen del informe. Las demás páginas siguen en inglés.";

function hasCookie(): boolean {
  return document.cookie.split("; ").some((c) => c.startsWith(`${LOCALE_COOKIE}=`));
}

export function setLocale(l: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
  try { localStorage.setItem(LOCALE_COOKIE, l); } catch { /* storage blocked: the cookie still works */ }
}

export default function LanguageMenu({ className = "" }: { className?: string }) {
  const preferred = usePreferredLocale();
  const router = useRouter();
  const ref = useRef<HTMLDetailsElement>(null);

  // localStorage restores a cleared cookie; otherwise it just mirrors the cookie.
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(LOCALE_COOKIE); } catch { return; }
    if (!hasCookie() && isLocale(stored) && stored !== preferred) {
      setLocale(stored);
      router.refresh();
    } else if (hasCookie() && stored !== preferred) {
      try { localStorage.setItem(LOCALE_COOKIE, preferred); } catch { /* ignore */ }
    }
  }, [preferred, router]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const d = ref.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      const d = ref.current;
      if (e.key === "Escape" && d?.open) {
        d.open = false;
        d.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);

  const choose = (l: Locale) => {
    if (ref.current) ref.current.open = false;
    if (l === preferred) return;
    setLocale(l);
    router.refresh();
  };

  const es = preferred === "es";
  return (
    <details ref={ref} className={`lang-menu relative ${className}`}>
      <summary
        className="flex min-h-[32px] cursor-pointer list-none items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[13px] font-semibold text-slate-800 hover:border-slate-500 [&::-webkit-details-marker]:hidden"
        aria-label={es ? "Idioma: Español. Language: Spanish" : "Language: English. Idioma: inglés"}
      >
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="7.5" /><path d="M2.5 10h15M10 2.5c2.2 2.3 2.2 12.7 0 15M10 2.5c-2.2 2.3-2.2 12.7 0 15" />
        </svg>
        <span>{es ? "ES" : "EN"}</span>
        <span aria-hidden="true" className="text-[10px] opacity-60">▾</span>
      </summary>
      <div className="absolute right-0 z-50 mt-1.5 w-[min(300px,calc(100vw-32px))] rounded-lg border border-slate-200 bg-white p-3 text-left text-[13px] leading-snug text-slate-800 shadow-lg">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><span lang="en">Language</span> / <span lang="es">Idioma</span></p>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Language / Idioma">
          <button type="button" lang="en" aria-pressed={!es} onClick={() => choose("en")}
            className={`min-h-[32px] rounded-md border px-2 py-1 font-semibold ${!es ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:border-slate-500"}`}>English</button>
          <button type="button" lang="es" aria-pressed={es} onClick={() => choose("es")}
            className={`min-h-[32px] rounded-md border px-2 py-1 font-semibold ${es ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:border-slate-500"}`}>Español</button>
        </div>
        <p lang="en" className="mt-2.5 text-[12px] text-slate-700">{NOTE_EN}</p>
        <p lang="es" className="mt-1.5 text-[12px] text-slate-700">{NOTE_ES}</p>
        <p lang={es ? "es" : "en"} className="mt-2 text-[11px] text-slate-500">{es ? SCOPE_ES : SCOPE_EN}</p>
      </div>
    </details>
  );
}
