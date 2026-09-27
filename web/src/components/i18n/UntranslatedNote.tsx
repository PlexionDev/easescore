"use client";

// On pages that are not translated, a visitor who chose Spanish sees a small Spanish note that the
// page is still in English (the page itself stays fully English). Hidden in print and on the report,
// which carries its own note under its Spanish summary.

import { useState } from "react";
import { usePathname } from "next/navigation";
import { isReportPath, isTranslatedPath } from "@/lib/i18n";
import { usePreferredLocale } from "@/lib/i18n/client";

export default function UntranslatedNote() {
  const preferred = usePreferredLocale();
  const path = usePathname();
  const [hidden, setHidden] = useState<string | null>(null);
  if (preferred !== "es" || isTranslatedPath(path) || isReportPath(path) || hidden === path) return null;
  return (
    <div lang="es" role="note"
      className="fixed bottom-3 left-3 z-[60] flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-lg border border-slate-300 bg-white/95 px-3 py-1.5 text-[13px] text-slate-800 shadow-md print:hidden">
      <span>Esta sección aún está en inglés.</span>
      <button type="button" onClick={() => setHidden(path)} aria-label="Cerrar este aviso"
        className="min-h-[24px] min-w-[24px] rounded px-1 text-slate-500 hover:bg-slate-100">✕</button>
    </div>
  );
}
