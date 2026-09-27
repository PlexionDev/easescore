"use client";

import { useState } from "react";
import { useLocale, useT } from "@/lib/i18n/client";

/**
 * "Download Feasibility Study (PDF)" button.
 *
 * - `query`: the parcel page's scenario query string (same keys the report reads: type, units,
 *   stories, strategy, goal, tenure, affordable, ...). Pass `useSearchParams().toString()`.
 * - `getImages`: optional; returns data URLs from the map's "Capture view" for the figure slots.
 *   When given, the PDF is requested with POST so the images travel in the body, not the URL.
 */
export default function DownloadReport({
  parid,
  query = "",
  getImages,
  className,
  label = "Download Feasibility Study (PDF)",
  hint = "About 35 pages. Takes a few seconds.",
  variant = "primary",
}: {
  parid: string;
  query?: string;
  getImages?: () => Promise<{ context?: string; terrain?: string; analysis?: string }>;
  className?: string;
  label?: string;
  hint?: string | null;
  variant?: "primary" | "secondary";
}) {
  const [busy, setBusy] = useState(false);
  const t = useT();
  const lang = useLocale();
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      // Spanish: the report's summary section is written in Spanish (lang=es); the rest stays English.
      const q0 = query.replace(/^\?/, "");
      const q = lang === "es" ? `${q0}${q0 ? "&" : ""}lang=es` : q0;
      const url = `/api/report/${encodeURIComponent(parid)}${q ? `?${q}` : ""}`;
      const images = getImages ? await getImages() : undefined;
      const res = images
        ? await fetch(`/api/report/${encodeURIComponent(parid)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q, images }),
          })
        : await fetch(url);
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `EaseScore-Feasibility-${parid}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        aria-busy={busy}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-70 ${variant === "primary" ? "bg-slate-900 text-white hover:bg-slate-800" : "border border-slate-300 bg-white text-slate-800 hover:border-slate-500"}`}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
          <path d="M10 2a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L9 11.6V3a1 1 0 0 1 1-1Zm-7 13a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />
        </svg>
        {busy ? t("dl.preparing") : label}
      </button>
      {(error || hint) && (
        <p className="mt-1 text-[11px] text-slate-500">
          {error ? <span className="text-red-700">{t("dl.error", { error })}</span> : hint}
        </p>
      )}
    </div>
  );
}
